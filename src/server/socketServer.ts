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
  // Whatever token this socket presented (on join, or later via room:auth).
  // Deliberately not cached as an isAdmin boolean: it's re-checked against
  // the room on every use (isRoomAdmin), so revoking an appointed admin takes
  // effect immediately — and it only relies on reading socket.data, which
  // also works for remote sockets once there's more than one instance.
  adminToken?: string;
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

/**
 * Admin is the room creator's token, or a token minted for this participant
 * when another admin appointed them. Appointed tokens are bound to the
 * participant they were issued to: participant ids are broadcast to everyone,
 * so the id alone can never be what grants admin.
 */
function isRoomAdmin(room: StoredRoom, data: SocketData): boolean {
  const { adminToken, participantId } = data;
  if (!adminToken) return false;
  if (adminToken === room.adminToken) return true;
  return Boolean(participantId) && room.appointedAdminTokens[participantId!] === adminToken;
}

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
    viewerIsAdmin: isAdmin,
    appointedAdminIds: Object.keys(room.appointedAdminTokens),
  };
}

async function broadcastRoomState(server: SocketIOServer, code: string) {
  const room = await roomStore.getRoom(code);
  if (!room) return;
  const sockets = await server.in(roomChannel(code)).fetchSockets();
  for (const s of sockets) {
    const data = s.data as SocketData;
    s.emit("room:state", toPublicState(room, isRoomAdmin(room, data)));
  }
}

function roomChannel(code: string) {
  return `room:${code.toUpperCase()}`;
}

/**
 * Loads the socket's room for an admin-only handler. Emits an error and
 * returns undefined if the socket isn't (or is no longer) an admin of it.
 */
async function loadRoomAsAdmin(socket: Socket): Promise<StoredRoom | undefined> {
  const data = socket.data as SocketData;
  if (!data.code) return undefined;
  const room = await roomStore.getRoom(data.code);
  if (!room) return undefined;
  if (!isRoomAdmin(room, data)) {
    socket.emit("room:error", { message: "Only a room admin can do that." });
    return undefined;
  }
  return room;
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

        const data = socket.data as SocketData;
        data.code = code;
        data.participantId = clientId;
        data.adminToken = payload.adminToken || undefined;
        // The roster flag says whether this person is an admin of the room, so
        // an appointed admin stays listed as one even if this particular
        // connection didn't present their token (that socket still gets no
        // admin powers — isRoomAdmin is what's checked for those). Without
        // this the roster would contradict appointedAdminIds.
        const isAdmin = isRoomAdmin(room, data) || clientId in room.appointedAdminTokens;

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

        await socket.join(roomChannel(code));
        ack?.({ ok: true, participantId: clientId });
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
      const room = await loadRoomAsAdmin(socket);
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
      await broadcastRoomState(io!, room.code);
    });

    socket.on("poker:reset", async () => {
      const room = await loadRoomAsAdmin(socket);
      if (!room) return;
      room.poker.votes = {};
      room.poker.revealed = false;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, room.code);
    });

    socket.on("poker:setTopic", async (payload: { topic?: string }) => {
      const room = await loadRoomAsAdmin(socket);
      if (!room) return;
      room.poker.topic = (payload?.topic || "").slice(0, MAX_TOPIC_LENGTH);
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, room.code);
    });

    socket.on("poker:setDeck", async (payload: { deck?: string[] }) => {
      const room = await loadRoomAsAdmin(socket);
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
      await broadcastRoomState(io!, room.code);
    });

    socket.on("poker:setAnonymous", async (payload: { anonymous?: boolean }) => {
      const room = await loadRoomAsAdmin(socket);
      if (!room) return;
      room.poker.anonymous = Boolean(payload?.anonymous);
      // Reset the round: otherwise toggling anonymous off after a reveal
      // would immediately expose votes that were shown as hidden moments ago.
      room.poker.votes = {};
      room.poker.revealed = false;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, room.code);
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
      const room = await loadRoomAsAdmin(socket);
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
      await broadcastRoomState(io!, room.code);
    });

    socket.on("plinko:spin", async () => {
      const room = await loadRoomAsAdmin(socket);
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
      await broadcastRoomState(io!, room.code);
    });

    // One atomic action rather than separate setNames/setCount/randomize events:
    // the UI only ever calls this as a single "Generate teams" click, and folding
    // it into one handler avoids any ordering risk between chained emits.
    socket.on("teams:generate", async (payload: { names?: string[]; count?: number }) => {
      const room = await loadRoomAsAdmin(socket);
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
      await broadcastRoomState(io!, room.code);
    });

    socket.on("activity:set", async (payload: { activity?: ActivityType }) => {
      const activity = payload?.activity;
      if (!activity || !ACTIVITIES.some((a) => a.id === activity)) return;
      const room = await loadRoomAsAdmin(socket);
      if (!room) return;
      room.activeActivity = activity;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      await broadcastRoomState(io!, room.code);
    });

    // Appointing only works for someone connected right now: their new token
    // is handed to their live socket(s) via admin:granted. There's no safe way
    // to deliver it later — the only thing identifying an Away participant on
    // rejoin is their participant id, which every client can see.
    socket.on("admin:appoint", async (payload: { participantId?: string }) => {
      const room = await loadRoomAsAdmin(socket);
      if (!room) return;
      const target = room.participants.find((p) => p.id === payload?.participantId);
      if (!target || target.isAdmin) return;
      if (!target.connected) {
        socket.emit("room:error", { message: "Only people currently in the room can be made admin." });
        return;
      }
      const token = nanoid(24);
      room.appointedAdminTokens[target.id] = token;
      target.isAdmin = true;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);

      // The target client stores the token and echoes it back via room:auth
      // (below) — rather than this handler setting their socket.data directly,
      // which isn't possible for a socket connected to another instance.
      const sockets = await io!.in(roomChannel(room.code)).fetchSockets();
      for (const s of sockets) {
        if ((s.data as SocketData).participantId === target.id) {
          s.emit("admin:granted", { code: room.code, token });
        }
      }
      await broadcastRoomState(io!, room.code);
    });

    // Only appointed admins can be removed — the room creator can't, so a
    // room always keeps at least one admin.
    socket.on("admin:revoke", async (payload: { participantId?: string }) => {
      const room = await loadRoomAsAdmin(socket);
      if (!room) return;
      const participantId = payload?.participantId;
      if (!participantId || !(participantId in room.appointedAdminTokens)) {
        socket.emit("room:error", { message: "The room creator can't be removed as admin." });
        return;
      }
      delete room.appointedAdminTokens[participantId];
      const target = room.participants.find((p) => p.id === participantId);
      if (target) target.isAdmin = false;
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);
      // No need to touch the target's sockets: their stored token simply stops
      // matching in isRoomAdmin, and this broadcast sends them viewerIsAdmin: false.
      await broadcastRoomState(io!, room.code);
    });

    // Removes someone from the roster entirely (not just marking them Away) and
    // disconnects them. Deliberately not a ban: they can rejoin with the
    // invite link and come back as a fresh participant — without their vote
    // or any appointed admin rights, which are cleared here. Also works on an
    // Away participant, which is how stale roster entries get pruned.
    socket.on("participant:kick", async (payload: { participantId?: string }) => {
      const room = await loadRoomAsAdmin(socket);
      if (!room) return;
      const target = room.participants.find((p) => p.id === payload?.participantId);
      if (!target) return;
      if (target.id === (socket.data as SocketData).participantId) {
        socket.emit("room:error", { message: "You can't kick yourself." });
        return;
      }
      // Same rule as admin:revoke — the creator is the one admin that can't be
      // taken out of the room.
      if (target.isAdmin && !(target.id in room.appointedAdminTokens)) {
        socket.emit("room:error", { message: "The room creator can't be kicked." });
        return;
      }
      room.participants = room.participants.filter((p) => p.id !== target.id);
      delete room.poker.votes[target.id];
      delete room.appointedAdminTokens[target.id];
      room.lastActivityAt = Date.now();
      await roomStore.saveRoom(room);

      // A server-side disconnect (unlike a dropped connection) stops the
      // Socket.IO client from auto-reconnecting, so the kicked tab stays out
      // until the person chooses to rejoin. Every tab sharing that identity
      // goes. The disconnect handler (markDisconnected) runs as usual but finds
      // no roster entry left to mark Away.
      const sockets = await io!.in(roomChannel(room.code)).fetchSockets();
      for (const s of sockets) {
        if ((s.data as SocketData).participantId === target.id) {
          s.emit("room:kicked", { code: room.code });
          s.disconnect();
        }
      }
      await broadcastRoomState(io!, room.code);
    });

    // Adopts a newly granted admin token on an already-joined socket, so being
    // appointed doesn't require a leave/rejoin (which would clear a poker vote).
    socket.on("room:auth", async (payload: { token?: string }) => {
      const data = socket.data as SocketData;
      if (!data.code || !payload?.token) return;
      const room = await roomStore.getRoom(data.code);
      if (!room) return;
      data.adminToken = payload.token;
      socket.emit("room:state", toPublicState(room, isRoomAdmin(room, data)));
    });

    async function markDisconnected() {
      const data = socket.data as SocketData;
      const { code, participantId } = data;
      if (!code || !participantId) return;
      const room = await roomStore.getRoom(code);
      data.code = undefined;
      data.participantId = undefined;
      data.adminToken = undefined;
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
