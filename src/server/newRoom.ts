import { customAlphabet } from "nanoid";
import { DEFAULT_POKER_DECK } from "@/lib/types";
import type { StoredRoom } from "@/server/roomStore";

export const generateRoomCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const generateAdminToken = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 24);

/** A brand-new room's starting state — shared by every RoomStore so their defaults can't drift. */
export function newRoom(code: string, name: string): StoredRoom {
  const now = Date.now();
  return {
    code,
    name: name.trim() || `Room ${code}`,
    createdAt: now,
    lastActivityAt: now,
    adminToken: generateAdminToken(),
    appointedAdminTokens: {},
    version: 1,
    activeActivity: "poker",
    participants: [],
    poker: { topic: "", votes: {}, revealed: false, deck: [...DEFAULT_POKER_DECK], anonymous: false },
    pokerHistorySummary: { count: 0, latestRevealedAt: null },
    feedback: { submissionCount: 0 },
    plinko: { options: [], isRunning: false, winner: null, seed: null },
    teams: { names: [], teamCount: 2, teams: [] },
  };
}
