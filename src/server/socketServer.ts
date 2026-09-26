import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { nanoid } from "nanoid";
import { roomStore, type StoredRoom } from "@/server/roomStore";
import { createVersionedThrottle } from "@/server/roomThrottle";
import {
  RoomBusyError,
  SKIP,
  createKeyedQueue,
  updateRoom,
  type RoomChange,
  type UpdateResult,
} from "@/server/roomUpdates";
import {
  ACTIVITIES,
  MAX_POKER_CARD_LENGTH,
  MAX_TEAM_COUNT,
  MAX_TEAM_NAME_LENGTH,
  type ActivityType,
  type FeedbackItem,
  type JoinAck,
  type PokerHistoryEntry,
  type PokerHistoryResponse,
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

const BUSY_MESSAGE = "The room is busy right now — please try that again.";

// Room broadcasts are grouped per room: see broadcastRoomState.
const BROADCAST_WINDOW_MS = 50;

let io: SocketIOServer | undefined;

// Serializes this process's updates per room (see createKeyedQueue).
const enqueueRoomUpdate = createKeyedQueue();

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
    pokerHistorySummary: {
      count: room.pokerHistory.length,
      latestRevealedAt: room.pokerHistory[0]?.revealedAt ?? null,
    },
    plinko: room.plinko,
    teams: room.teams,
    feedback: {
      submissionCount: room.feedback.submissionCount,
      items: isAdmin ? room.feedback.items : null,
    },
    viewerIsAdmin: isAdmin,
    appointedAdminIds: Object.keys(room.appointedAdminTokens),
    version: room.version,
  };
}

/** Sends each socket in the room its own view of `room` (admins get feedback items). */
async function sendRoomState(room: StoredRoom) {
  const sockets = await io!.in(roomChannel(room.code)).fetchSockets();
  for (const s of sockets) {
    const data = s.data as SocketData;
    s.emit("room:state", toPublicState(room, isRoomAdmin(room, data)));
  }
}

const throttleRoomState = createVersionedThrottle<StoredRoom>(BROADCAST_WINDOW_MS, (_code, room) => {
  sendRoomState(room).catch((err) => console.error(`Broadcast to room ${room.code} failed`, err));
});

/**
 * Pushes the room (as a write just returned it) to everyone in it — grouped
 * per room: a lone change goes out immediately, and further changes within
 * BROADCAST_WINDOW_MS collapse into one send of the newest, so a burst of 40
 * votes is a handful of broadcasts rather than 40 × everyone. Clients still
 * end on the latest state. Broadcasts from different instances (or late
 * ones) can reach clients out of order; clients keep the highest `version`
 * they've seen (useRoomConnection).
 */
function broadcastRoomState(room: StoredRoom) {
  throttleRoomState(room.code, room);
}


function roomChannel(code: string) {
  return `room:${code.toUpperCase()}`;
}

/**
 * updateRoom, queued behind this process's other updates to the same room,
 * and reporting "gave up after repeated conflicts" as a result instead of
 * throwing.
 */
async function tryUpdateRoom(code: string, change: RoomChange): Promise<UpdateResult | { status: "busy" }> {
  try {
    return await enqueueRoomUpdate(code, () => updateRoom(roomStore, code, change));
  } catch (err) {
    if (err instanceof RoomBusyError) return { status: "busy" };
    throw err;
  }
}

/**
 * The shape of every room-changing socket handler: apply `change` to this
 * socket's room via updateRoom — so concurrent changes (two people voting at
 * once) can't overwrite each other — then broadcast the new state.
 *
 * `change` follows updateRoom's rules: it may run more than once, so it must
 * only read and modify the room it's given; socket side effects go in
 * `afterSave`, which runs once, after the save and before the broadcast.
 * With `adminOnly`, the admin check runs inside the change too, so it's made
 * against the same (latest) room that gets saved. A rejected change (`{
 * error }`) goes back to this socket as room:error. `lastActivityAt` is
 * bumped automatically on save.
 */
async function changeRoom(
  socket: Socket,
  options: { adminOnly?: boolean; afterSave?: (room: StoredRoom) => Promise<void> },
  change: RoomChange
): Promise<void> {
  const data = socket.data as SocketData;
  if (!data.code) return;
  const result = await tryUpdateRoom(data.code, (room) => {
    if (options.adminOnly && !isRoomAdmin(room, data)) return { error: "Only a room admin can do that." };
    const outcome = change(room);
    if (outcome === undefined) room.lastActivityAt = Date.now();
    return outcome;
  });
  if (result.status === "busy") socket.emit("room:error", { message: BUSY_MESSAGE });
  if (result.status === "rejected") socket.emit("room:error", { message: result.error });
  if (result.status !== "saved") return;
  await options.afterSave?.(result.room);
  broadcastRoomState(result.room);
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

        const joining: SocketData = { code, participantId: clientId, adminToken: payload.adminToken || undefined };
        const result = await tryUpdateRoom(code, (room) => {
          // The roster flag says whether this person is an admin of the room, so
          // an appointed admin stays listed as one even if this particular
          // connection didn't present their token (that socket still gets no
          // admin powers — isRoomAdmin is what's checked for those). Without
          // this the roster would contradict appointedAdminIds.
          const isAdmin = isRoomAdmin(room, joining) || clientId in room.appointedAdminTokens;

          // clientId is a per-browser, per-room identity stored client-side (see
          // src/lib/storage.ts) so a refresh/reconnect reactivates the same
          // roster entry instead of appearing as a new person.
          const existing = room.participants.find((p) => p.id === clientId);
          if (existing) {
            existing.name = name;
            existing.isAdmin = isAdmin;
            existing.connected = true;
          } else {
            room.participants.push({ id: clientId, name, isAdmin, joinedAt: Date.now(), connected: true });
          }
          room.lastActivityAt = Date.now();
        });
        if (result.status === "busy") {
          ack?.({ ok: false, error: BUSY_MESSAGE });
          return;
        }
        if (result.status !== "saved") {
          ack?.({ ok: false, error: "That room doesn't exist or has expired." });
          return;
        }

        Object.assign(socket.data as SocketData, joining);
        await socket.join(roomChannel(code));
        ack?.({ ok: true, participantId: clientId });
        broadcastRoomState(result.room);
      }
    );

    // Not changeRoom: votes are the burstiest write (everyone votes at once),
    // so each is a single-field store write (setVote) that doesn't read the
    // room first, conflict with other voters, or queue behind them. It still
    // bumps the room version, so it coexists safely with whole-room writes.
    socket.on("poker:vote", async (payload: { value?: string | null }) => {
      const { code, participantId } = socket.data as SocketData;
      if (!code || !participantId) return;
      const value = payload?.value;
      if (value !== null && typeof value !== "string") return;
      const room = await roomStore.setVote(code, participantId, value);
      // undefined: not allowed right now (revealed, not poker, not a card in
      // the current deck) — e.g. a click that raced a reveal. Nothing to report.
      if (room) broadcastRoomState(room);
    });

    socket.on("poker:reveal", () =>
      changeRoom(socket, { adminOnly: true }, (room) => {
        room.poker.revealed = true;

        const voteEntries = Object.entries(room.poker.votes);
        if (voteEntries.length === 0) return;
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
      })
    );

    // History isn't pushed with room:state (see PublicRoomState) — anyone in
    // the room fetches it when they open the history dialog. Not admin-only:
    // anonymous rounds were already stored without names.
    socket.on("poker:getHistory", async (ack?: (res: PokerHistoryResponse) => void) => {
      if (typeof ack !== "function") return;
      const { code } = socket.data as SocketData;
      const room = code ? await roomStore.getRoom(code) : undefined;
      ack(room ? { ok: true, entries: room.pokerHistory } : { ok: false, error: "You're not in a room." });
    });

    socket.on("poker:reset", () =>
      changeRoom(socket, { adminOnly: true }, (room) => {
        room.poker.votes = {};
        room.poker.revealed = false;
      })
    );

    socket.on("poker:setTopic", (payload: { topic?: string }) => {
      const topic = (payload?.topic || "").slice(0, MAX_TOPIC_LENGTH);
      return changeRoom(socket, { adminOnly: true }, (room) => {
        room.poker.topic = topic;
      });
    });

    socket.on("poker:setDeck", (payload: { deck?: string[] }) => {
      const deck = [
        ...new Set(
          (payload?.deck || [])
            .map((c) => c.trim().slice(0, MAX_POKER_CARD_LENGTH))
            .filter(Boolean)
        ),
      ].slice(0, MAX_POKER_DECK_SIZE);
      return changeRoom(socket, { adminOnly: true }, (room) => {
        if (deck.length === 0) return { error: "The deck needs at least one card." };
        room.poker.deck = deck;
        room.poker.votes = {};
        room.poker.revealed = false;
      });
    });

    socket.on("poker:setAnonymous", (payload: { anonymous?: boolean }) =>
      changeRoom(socket, { adminOnly: true }, (room) => {
        room.poker.anonymous = Boolean(payload?.anonymous);
        // Reset the round: otherwise toggling anonymous off after a reveal
        // would immediately expose votes that were shown as hidden moments ago.
        room.poker.votes = {};
        room.poker.revealed = false;
      })
    );

    socket.on("feedback:submit", (payload: { text?: string }) => {
      const text = (payload?.text || "").trim().slice(0, MAX_FEEDBACK_LENGTH);
      if (!text) return;
      return changeRoom(socket, {}, (room) => {
        const item: FeedbackItem = { id: nanoid(10), text, createdAt: Date.now() };
        room.feedback.items.unshift(item);
        room.feedback.submissionCount += 1;
      });
    });

    socket.on("plinko:setOptions", (payload: { options?: string[] }) => {
      const options = (payload?.options || [])
        .map((o) => o.trim().slice(0, MAX_PLINKO_OPTION_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_PLINKO_OPTIONS);
      return changeRoom(socket, { adminOnly: true }, (room) => {
        room.plinko.options = options;
        room.plinko.winner = null;
        room.plinko.isRunning = false;
      });
    });

    socket.on("plinko:spin", () =>
      changeRoom(socket, { adminOnly: true }, (room) => {
        if (room.plinko.options.length < 2) return { error: "Add at least two options before spinning." };
        room.plinko.winner = room.plinko.options[Math.floor(Math.random() * room.plinko.options.length)];
        room.plinko.isRunning = true;
        room.plinko.seed = Date.now();
      })
    );

    // One atomic action rather than separate setNames/setCount/randomize events:
    // the UI only ever calls this as a single "Generate teams" click, and folding
    // it into one handler avoids any ordering risk between chained emits.
    socket.on("teams:generate", (payload: { names?: string[]; count?: number }) => {
      const names = (payload?.names || [])
        .map((n) => n.trim().slice(0, MAX_TEAM_NAME_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_TEAM_NAMES);
      const rawCount = Math.round(Number(payload?.count));
      const teamCount = Math.min(Math.max(Number.isFinite(rawCount) ? rawCount : 1, 1), MAX_TEAM_COUNT);

      return changeRoom(socket, { adminOnly: true }, (room) => {
        if (names.length === 0) return { error: "Add at least one name before generating teams." };
        const shuffled = [...names];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const teams: string[][] = Array.from({ length: teamCount }, () => []);
        shuffled.forEach((name, i) => teams[i % teamCount].push(name));
        room.teams = { names, teamCount, teams };
      });
    });

    socket.on("activity:set", (payload: { activity?: ActivityType }) => {
      const activity = payload?.activity;
      if (!activity || !ACTIVITIES.some((a) => a.id === activity)) return;
      return changeRoom(socket, { adminOnly: true }, (room) => {
        room.activeActivity = activity;
      });
    });

    // Appointing only works for someone connected right now: their new token
    // is handed to their live socket(s) via admin:granted. There's no safe way
    // to deliver it later — the only thing identifying an Away participant on
    // rejoin is their participant id, which every client can see.
    socket.on("admin:appoint", (payload: { participantId?: string }) => {
      let granted: { participantId: string; token: string } | undefined;
      return changeRoom(
        socket,
        {
          adminOnly: true,
          // The target client stores the token and echoes it back via room:auth
          // (below) — rather than this handler setting their socket.data directly,
          // which isn't possible for a socket connected to another instance.
          afterSave: async (room) => {
            const sockets = await io!.in(roomChannel(room.code)).fetchSockets();
            for (const s of sockets) {
              if ((s.data as SocketData).participantId === granted!.participantId) {
                s.emit("admin:granted", { code: room.code, token: granted!.token });
              }
            }
          },
        },
        (room) => {
          const target = room.participants.find((p) => p.id === payload?.participantId);
          if (!target || target.isAdmin) return SKIP;
          if (!target.connected) return { error: "Only people currently in the room can be made admin." };
          granted = { participantId: target.id, token: nanoid(24) };
          room.appointedAdminTokens[target.id] = granted.token;
          target.isAdmin = true;
        }
      );
    });

    // Only appointed admins can be removed — the room creator can't, so a
    // room always keeps at least one admin. No need to touch the target's
    // sockets: their stored token simply stops matching in isRoomAdmin, and
    // the broadcast sends them viewerIsAdmin: false.
    socket.on("admin:revoke", (payload: { participantId?: string }) =>
      changeRoom(socket, { adminOnly: true }, (room) => {
        const participantId = payload?.participantId;
        if (!participantId || !(participantId in room.appointedAdminTokens)) {
          return { error: "The room creator can't be removed as admin." };
        }
        delete room.appointedAdminTokens[participantId];
        const target = room.participants.find((p) => p.id === participantId);
        if (target) target.isAdmin = false;
      })
    );

    // Removes someone from the roster entirely (not just marking them Away) and
    // disconnects them. Deliberately not a ban: they can rejoin with the
    // invite link and come back as a fresh participant — without their vote
    // or any appointed admin rights, which are cleared here. Also works on an
    // Away participant, which is how stale roster entries get pruned.
    socket.on("participant:kick", (payload: { participantId?: string }) => {
      const selfId = (socket.data as SocketData).participantId;
      let kickedId: string | undefined;
      return changeRoom(
        socket,
        {
          adminOnly: true,
          // A server-side disconnect (unlike a dropped connection) stops the
          // Socket.IO client from auto-reconnecting, so the kicked tab stays out
          // until the person chooses to rejoin. Every tab sharing that identity
          // goes. The disconnect handler (markDisconnected) runs as usual but
          // finds no roster entry left to mark Away.
          afterSave: async (room) => {
            const sockets = await io!.in(roomChannel(room.code)).fetchSockets();
            for (const s of sockets) {
              if ((s.data as SocketData).participantId === kickedId) {
                s.emit("room:kicked", { code: room.code });
                s.disconnect();
              }
            }
          },
        },
        (room) => {
          const target = room.participants.find((p) => p.id === payload?.participantId);
          if (!target) return SKIP;
          if (target.id === selfId) return { error: "You can't kick yourself." };
          // Same rule as admin:revoke — the creator is the one admin that can't be
          // taken out of the room.
          if (target.isAdmin && !(target.id in room.appointedAdminTokens)) {
            return { error: "The room creator can't be kicked." };
          }
          kickedId = target.id;
          room.participants = room.participants.filter((p) => p.id !== target.id);
          delete room.poker.votes[target.id];
          delete room.appointedAdminTokens[target.id];
        }
      );
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
      data.code = undefined;
      data.participantId = undefined;
      data.adminToken = undefined;
      // Not changeRoom: this socket's data is already cleared, and there's no
      // one to report a failure to. If it gives up ("busy"), the participant
      // just stays shown as connected until their next join/leave.
      const result = await tryUpdateRoom(code, (room) => {
        // Kept in the roster (grayed out client-side) rather than removed, so
        // it stays clear who has joined the room versus who's currently here.
        const participant = room.participants.find((p) => p.id === participantId);
        // Nothing to update if they were kicked (roster entry already gone).
        if (!participant && !(participantId in room.poker.votes)) return SKIP;
        if (participant) participant.connected = false;
        delete room.poker.votes[participantId];
        room.lastActivityAt = Date.now();
      });
      if (result.status === "saved") broadcastRoomState(result.room);
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
