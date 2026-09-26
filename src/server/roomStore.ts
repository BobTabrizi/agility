import { customAlphabet } from "nanoid";
import { DEFAULT_POKER_DECK, type RoomState } from "@/lib/types";
import { DynamoRoomStore } from "@/server/dynamoRoomStore";
import { RoomConflictError } from "@/server/roomUpdates";

const roomCodeAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const tokenAlphabet = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 24);

export interface StoredRoom extends RoomState {
  // The creator's token, minted with the room.
  adminToken: string;
  // participantId -> token for admins appointed by another admin. Per-person
  // (rather than handing out adminToken) so one can be revoked on its own.
  appointedAdminTokens: Record<string, string>;
  lastActivityAt: number;
  // Optimistic-concurrency counter: bumped on every successful saveRoom, which
  // refuses to save over a newer version. Server-only (never sent to clients).
  version: number;
}

/**
 * Storage abstraction so the in-memory implementation below can be swapped
 * for a DynamoDB-backed store later without touching the socket layer.
 *
 * Reads return an independent copy; writes are optimistic. Don't call
 * getRoom + saveRoom directly for a change — use `updateRoom`
 * (roomUpdates.ts), which retries on conflict so concurrent changes to the
 * same room (two people voting at once) can't overwrite each other.
 */
export interface RoomStore {
  createRoom(name: string): Promise<StoredRoom>;
  getRoom(code: string): Promise<StoredRoom | undefined>;
  /**
   * Saves `room` only if the stored room is still at `room.version` (i.e.
   * nobody saved since it was read), then bumps `room.version`. Otherwise
   * throws RoomConflictError and writes nothing — including when the room
   * no longer exists.
   */
  saveRoom(room: StoredRoom): Promise<void>;
  /**
   * Records one participant's poker vote (or clears it, with `null`) as a
   * single-field write: no read first, so voters never conflict with each
   * other or wait on one another. Only applies if poker is the active
   * activity, the round isn't revealed, and `value` is a card in the current
   * deck — checked atomically with the write. Bumps `version`, so a
   * concurrent whole-room save that read before this still conflicts and
   * retries instead of dropping the vote. Returns the updated room, or
   * undefined if the room doesn't exist or the conditions don't hold.
   */
  setVote(code: string, participantId: string, value: string | null): Promise<StoredRoom | undefined>;
  touchRoom(code: string): Promise<void>;
  deleteRoom(code: string): Promise<void>;
}

const ROOM_TTL_MS = 60 * 24 * 60 * 60 * 1000; // rooms with no activity for 60 days are swept

export class InMemoryRoomStore implements RoomStore {
  private rooms = new Map<string, StoredRoom>();

  constructor() {
    const sweep = setInterval(() => this.sweep(), 15 * 60 * 1000);
    sweep.unref?.();
  }

  private sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivityAt > ROOM_TTL_MS) {
        this.rooms.delete(code);
      }
    }
  }

  async createRoom(name: string): Promise<StoredRoom> {
    let code = roomCodeAlphabet();
    while (this.rooms.has(code)) {
      code = roomCodeAlphabet();
    }
    const now = Date.now();
    const room: StoredRoom = {
      code,
      name: name.trim() || `Room ${code}`,
      createdAt: now,
      lastActivityAt: now,
      adminToken: tokenAlphabet(),
      appointedAdminTokens: {},
      version: 1,
      activeActivity: "poker",
      participants: [],
      poker: { topic: "", votes: {}, revealed: false, deck: [...DEFAULT_POKER_DECK], anonymous: false },
      pokerHistory: [],
      feedback: { items: [], submissionCount: 0 },
      plinko: { options: [], isRunning: false, winner: null, seed: null },
      teams: { names: [], teamCount: 2, teams: [] },
    };
    this.rooms.set(code, structuredClone(room));
    return room;
  }

  // Copies in and out (rather than handing out the stored object) so this
  // store behaves like DynamoDB: a change isn't visible until it's saved, and
  // two readers get separate copies that can conflict — otherwise the version
  // check would be comparing an object with itself and could never fail.
  async getRoom(code: string): Promise<StoredRoom | undefined> {
    const room = this.rooms.get(code.toUpperCase());
    return room && structuredClone(room);
  }

  async saveRoom(room: StoredRoom): Promise<void> {
    const stored = this.rooms.get(room.code);
    if (!stored || stored.version !== room.version) throw new RoomConflictError(room.code);
    room.version += 1;
    this.rooms.set(room.code, structuredClone(room));
  }

  async setVote(code: string, participantId: string, value: string | null): Promise<StoredRoom | undefined> {
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.activeActivity !== "poker" || room.poker.revealed) return undefined;
    if (value === null) {
      delete room.poker.votes[participantId];
    } else {
      if (!room.poker.deck.includes(value)) return undefined;
      room.poker.votes[participantId] = value;
    }
    room.version += 1;
    room.lastActivityAt = Date.now();
    return structuredClone(room);
  }

  async touchRoom(code: string): Promise<void> {
    const room = this.rooms.get(code.toUpperCase());
    if (room) room.lastActivityAt = Date.now();
  }

  async deleteRoom(code: string): Promise<void> {
    this.rooms.delete(code);
  }
}

// A single shared instance across the process (custom server keeps one Node process alive).
declare global {
  var __agilityRoomStore: RoomStore | undefined;
}

function createRoomStore(): RoomStore {
  // Opt-in only — unset, this behaves exactly as before. Set ROOM_STORE=dynamodb
  // (plus DYNAMODB_TABLE_NAME and AWS credentials, e.g. in .env.local) to try
  // the DynamoDB-backed store locally without committing to it everywhere.
  if (process.env.ROOM_STORE === "dynamodb") {
    const tableName = process.env.DYNAMODB_TABLE_NAME;
    if (!tableName) {
      throw new Error("ROOM_STORE=dynamodb requires DYNAMODB_TABLE_NAME to be set.");
    }
    return new DynamoRoomStore(tableName);
  }
  return new InMemoryRoomStore();
}

export const roomStore: RoomStore = globalThis.__agilityRoomStore ?? createRoomStore();
globalThis.__agilityRoomStore = roomStore;
