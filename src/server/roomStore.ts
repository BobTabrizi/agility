import { customAlphabet } from "nanoid";
import { DEFAULT_POKER_DECK, type RoomState } from "@/lib/types";

const roomCodeAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const tokenAlphabet = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 24);

export interface StoredRoom extends RoomState {
  adminToken: string;
  lastActivityAt: number;
}

/**
 * Storage abstraction so the in-memory implementation below can be swapped
 * for a DynamoDB-backed store later without touching the socket layer.
 */
export interface RoomStore {
  createRoom(name: string): Promise<StoredRoom>;
  getRoom(code: string): Promise<StoredRoom | undefined>;
  saveRoom(room: StoredRoom): Promise<void>;
  touchRoom(code: string): Promise<void>;
  deleteRoom(code: string): Promise<void>;
}

const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // rooms with no activity for 6h are swept

class InMemoryRoomStore implements RoomStore {
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
      activeActivity: "poker",
      participants: [],
      poker: { topic: "", votes: {}, revealed: false, deck: [...DEFAULT_POKER_DECK], anonymous: false },
      feedback: { items: [], submissionCount: 0 },
      plinko: { options: [], isRunning: false, winner: null, seed: null },
    };
    this.rooms.set(code, room);
    return room;
  }

  async getRoom(code: string): Promise<StoredRoom | undefined> {
    return this.rooms.get(code.toUpperCase());
  }

  async saveRoom(room: StoredRoom): Promise<void> {
    this.rooms.set(room.code, room);
  }

  async touchRoom(code: string): Promise<void> {
    const room = this.rooms.get(code);
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

export const roomStore: RoomStore = globalThis.__agilityRoomStore ?? new InMemoryRoomStore();
globalThis.__agilityRoomStore = roomStore;
