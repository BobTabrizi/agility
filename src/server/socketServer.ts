import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { nanoid } from "nanoid";
import { roomStore, type StoredRoom } from "@/server/roomStore";
import {
  ACTIVITIES,
  MAX_POKER_CARD_LENGTH,
  MAX_TEAM_COUNT,
  MAX_TEAM_NAME_LENGTH,
  type ActivityType,
  type FeedbackItem,
  type JoinAck,
  type PokerHistoryEntry,
  type PublicRoomState,
} from "@/lib/types";

interface SocketData {
  code?: string;
  participantId?: string;
  isAdmin?: boolean;
}

const MAX_NAME_LENGTH = 40;
const MAX_CLIENT_ID_LENGTH = 100;
const MAX_FEEDBACK_LENGTH = 2000;
const MAX_TOPIC_LENGTH = 200;
const MAX_PLINKO_OPTIONS = 100;
const MAX_PLINKO_OPTION_LENGTH = 200;
const MAX_POKER_DECK_SIZE = 30;
const MAX_TEAM_NAMES = 200;
const MAX_POKER_HISTORY = 50;

let io: SocketIOServer | undefined;

function toPublicState(room: StoredRoom, isAdmin: boolean): PublicRoomState {
  return {
    code: room.code,
    name: room.name,
    createdAt: room.createdAt,
    activeActivity: room.activeActivity,
    participants: room.participants,
    poker: room.poker,
    pokerHistory: room.pokerHistory,
    plinko: room.plinko,
    teams: room.teams,
    feedback: {
      submissionCount: room.feedback.submissionCount,
      items: isAdmin ? room.feedback.items : null,
    },
  };
}

async function broadcastRoomState(server: SocketIOServer, code: string) {
  const room = await roomStore.getRoom(code);
  if (!room) return;
  const sockets = await server.in(roomChannel(code)).fetchSockets();
  for (const s of sockets) {
    const data = s.data as SocketData;
    s.emit("room:state", toPublicState(room, Boolean(data.isAdmin)));
  }
}

function roomChannel(code: string) {
  return `room:${code.toUpperCase()}`;
}

function requireAdmin(socket: Socket): boolean {
  const data = socket.data as SocketData;
  if (!data.isAdmin) {
    socket.emit("room:error", { message: "Only the room admin can do that." });
    return false;
  }
  return true;
}

export function initSocketServer(httpServer: HTTPServer): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    path: "/api/socket",
    cors: { origin: "*" },
  });

  io.on("connection", (socket: Socket) => {
    socket.on(
      "room:join",
      async (
        payload: { code?: string; name?: string; adminToken?: string; clientId?: string },
        ack?: (res: JoinAck) => void
      ) => {
        const code = (payload?.code || "").trim().toUpperCase();
        const name = (payload?.name || "").trim().slice(0, MAX_NAME_LENGTH);
        const clientId = (payload?.clientId || "").trim().slice(0, MAX_CLIENT_ID_LENGTH);

        if (!code || !name || !clientId) {
          ack?.({ ok: false, error: "A room code and display name are required." });
          return;
        }

        const room = await roomStore.getRoom(code);
        if (!room) {
          ack?.({ ok: false, error: "That room doesn't exist or has expired." });
          return;
        }

        const isAdmin = Boolean(payload.adminToken) && payload.adminToken === room.adminToken;

        // clientId is a per-browser, per-room identity stored client-side (see
        // src/lib/storage.ts) so a refresh/reconnect reactivates the same
        // roster entry instead of appearing as a new person.
        const existing = room.participants.find((p) => p.id === clientId);
        if (existing) {
          existing.name = name;
          existing.isAdmin = isAdmin;
          existing.connected = true;
        } else {
          room.participants.push({
            id: clientId,
            name,
            isAdmin,
            joinedAt: Date.now(),
            connected: true,
          });
        }
        room.lastActivityAt = Date.now();
        await roomStore.saveRoom(room);

        const data = socket.data as SocketData;
        data.code = code;
        data.participantId = clientId;
        data.isAdmin = isAdmin;

        await socket.join(roomChannel(code));
        ack?.({ ok: true, participantId: clientId, isAdmin });
        await broadcastRoomState(io!, code);
      }
    );

    socket.on("poker:vote", async (payload: { value: string | null }) => {
      const { code, participantId } = socket.data as SocketData;
      if (!code || !participantId) return;
      const room = await roomStore.getRoom(code);
      if (!room || room.activeActivity !== "poker" || room.poker.revealed) return;
      if (payload.value === null) {
        delete room.poker.votes[participantId];
      } else {
        room.poker.votes[participantId] = payload.value;
      }
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    socket.on("poker:reveal", async () => {
      if (!requireAdmin(socket)) return;
      const { code } = socket.data as SocketData;
      if (!code) return;
      const room = await roomStore.getRoom(code);
      if (!room) return;
      room.poker.revealed = true;

      const voteEntries = Object.entries(room.poker.votes);
      if (voteEntries.length > 0) {
        const votes = voteEntries.map(([participantId, value]) => ({
          // Recorded as null (not just hidden in the UI) for an anonymous
          // round, so the history stays anonymous even if the toggle is
          // switched off later.
          name: room.poker.anonymous
            ? null
            : room.participants.find((p) => p.id === participantId)?.name ?? "Unknown",
          value,
        }));
        const numericVotes = voteEntries.map(([, value]) => Number(value)).filter((n) => !Number.isNaN(n));
        const average =
          numericVotes.length > 0 ? numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length : null;

        const entry: PokerHistoryEntry = {
          id: nanoid(10),
          topic: room.poker.topic,
          revealedAt: Date.now(),
          anonymous: room.poker.anonymous,
          votes,
          average,
        };
        room.pokerHistory = [entry, ...room.pokerHistory].slice(0, MAX_POKER_HISTORY);
      }

      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    socket.on("poker:reset", async () => {
      if (!requireAdmin(socket)) return;
      const { code } = socket.data as SocketData;
      if (!code) return;
      const room = await roomStore.getRoom(code);
      if (!room) return;
      room.poker.votes = {};
      room.poker.revealed = false;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    socket.on("poker:setTopic", async (payload: { topic?: string }) => {
      if (!requireAdmin(socket)) return;
      const { code } = socket.data as SocketData;
      if (!code) return;
      const room = await roomStore.getRoom(code);
      if (!room) return;
      room.poker.topic = (payload?.topic || "").slice(0, MAX_TOPIC_LENGTH);
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    socket.on("poker:setDeck", async (payload: { deck?: string[] }) => {
      if (!requireAdmin(socket)) return;
      const { code } = socket.data as SocketData;
      if (!code) return;
      const room = await roomStore.getRoom(code);
      if (!room) return;
      const deck = [
        ...new Set(
          (payload?.deck || [])
            .map((c) => c.trim().slice(0, MAX_POKER_CARD_LENGTH))
            .filter(Boolean)
        ),
      ].slice(0, MAX_POKER_DECK_SIZE);
      if (deck.length === 0) {
        socket.emit("room:error", { message: "The deck needs at least one card." });
        return;
      }
      room.poker.deck = deck;
      room.poker.votes = {};
      room.poker.revealed = false;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    socket.on("poker:setAnonymous", async (payload: { anonymous?: boolean }) => {
      if (!requireAdmin(socket)) return;
      const { code } = socket.data as SocketData;
      if (!code) return;
      const room = await roomStore.getRoom(code);
      if (!room) return;
      room.poker.anonymous = Boolean(payload?.anonymous);
      // Reset the round: otherwise toggling anonymous off after a reveal
      // would immediately expose votes that were shown as hidden moments ago.
      room.poker.votes = {};
      room.poker.revealed = false;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    socket.on("feedback:submit", async (payload: { text?: string }) => {
      const { code } = socket.data as SocketData;
      if (!code) return;
      const text = (payload?.text || "").trim().slice(0, MAX_FEEDBACK_LENGTH);
      if (!text) return;
      const room = await roomStore.getRoom(code);
      if (!room) return;
      const item: FeedbackItem = { id: nanoid(10), text, createdAt: Date.now() };
      room.feedback.items.unshift(item);
      room.feedback.submissionCount += 1;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    socket.on("plinko:setOptions", async (payload: { options?: string[] }) => {
      if (!requireAdmin(socket)) return;
      const { code } = socket.data as SocketData;
      if (!code) return;
      const room = await roomStore.getRoom(code);
      if (!room) return;
      const options = (payload?.options || [])
        .map((o) => o.trim().slice(0, MAX_PLINKO_OPTION_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_PLINKO_OPTIONS);
      room.plinko.options = options;
      room.plinko.winner = null;
      room.plinko.isRunning = false;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    socket.on("plinko:spin", async () => {
      if (!requireAdmin(socket)) return;
      const { code } = socket.data as SocketData;
      if (!code) return;
      const room = await roomStore.getRoom(code);
      if (!room) return;
      if (room.plinko.options.length < 2) {
        socket.emit("room:error", { message: "Add at least two options before spinning." });
        return;
      }
      const winner = room.plinko.options[Math.floor(Math.random() * room.plinko.options.length)];
      room.plinko.winner = winner;
      room.plinko.isRunning = true;
      room.plinko.seed = Date.now();
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    // One atomic action rather than separate setNames/setCount/randomize events:
    // the UI only ever calls this as a single "Generate teams" click, and folding
    // it into one handler avoids any ordering risk between chained emits.
    socket.on("teams:generate", async (payload: { names?: string[]; count?: number }) => {
      if (!requireAdmin(socket)) return;
      const { code } = socket.data as SocketData;
      if (!code) return;
      const room = await roomStore.getRoom(code);
      if (!room) return;
      const names = (payload?.names || [])
        .map((n) => n.trim().slice(0, MAX_TEAM_NAME_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_TEAM_NAMES);
      if (names.length === 0) {
        socket.emit("room:error", { message: "Add at least one name before generating teams." });
        return;
      }
      const rawCount = Math.round(Number(payload?.count));
      const teamCount = Math.min(Math.max(Number.isFinite(rawCount) ? rawCount : 1, 1), MAX_TEAM_COUNT);

      const shuffled = [...names];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const teams: string[][] = Array.from({ length: teamCount }, () => []);
      shuffled.forEach((name, i) => teams[i % teamCount].push(name));

      room.teams = { names, teamCount, teams };
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    socket.on("activity:set", async (payload: { activity?: ActivityType }) => {
      if (!requireAdmin(socket)) return;
      const { code } = socket.data as SocketData;
      if (!code) return;
      const activity = payload?.activity;
      if (!activity || !ACTIVITIES.some((a) => a.id === activity)) return;
      const room = await roomStore.getRoom(code);
      if (!room) return;
      room.activeActivity = activity;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    });

    async function markDisconnected() {
      const data = socket.data as SocketData;
      const { code, participantId } = data;
      if (!code || !participantId) return;
      const room = await roomStore.getRoom(code);
      data.code = undefined;
      data.participantId = undefined;
      data.isAdmin = undefined;
      if (!room) return;
      // Kept in the roster (grayed out client-side) rather than removed, so
      // it stays clear who has joined the room versus who's currently here.
      const participant = room.participants.find((p) => p.id === participantId);
      if (participant) participant.connected = false;
      delete room.poker.votes[participantId];
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, code);
    }

    socket.on("room:leave", async () => {
      const { code } = socket.data as SocketData;
      await markDisconnected();
      if (code) await socket.leave(roomChannel(code));
    });

    socket.on("disconnect", markDisconnected);
  });

  return io;
}
