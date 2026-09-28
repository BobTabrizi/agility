import type { DeleteTarget, FeedbackItem, PokerHistoryEntry, PollHistoryEntry, RoomState } from "@/lib/types";
import { DynamoRoomStore } from "@/server/dynamoRoomStore";
import { generateRoomCode, newRoom } from "@/server/newRoom";
import { RoomConflictError } from "@/server/roomUpdates";

export interface StoredRoom extends RoomState {
  // The creator's token, minted with the room.
  adminToken: string;
  // participantId -> token for admins appointed by another admin. Per-person
  // (rather than handing out adminToken) so one can be revoked on its own.
  appointedAdminTokens: Record<string, string>;
  lastActivityAt: number;
  // Optimistic-concurrency counter: bumped on every successful write, and
  // saveRoom refuses to save over a newer version. Server-only (never sent
  // to clients).
  version: number;
}

/**
 * History to store alongside a room save, atomically with it (see saveRoom):
 * a revealed poker round, and/or a finished poll's results.
 */
export interface HistoryAppend {
  pokerRound?: PokerHistoryEntry;
  // Keyed by poll id: recording the same poll again (closed, reopened,
  // closed again) replaces its entry rather than adding a second one.
  pollResult?: PollHistoryEntry;
}

/** Which of a room's history lists: revealed poker rounds, or finished polls. */
export type HistoryKind = "poker" | "poll";

export type { DeleteTarget };

/**
 * Storage abstraction so the socket layer never depends on which backend is
 * active.
 *
 * A room is its main record (StoredRoom — settings, current round, roster,
 * counts) plus lists stored *alongside* it rather than inside it: poker
 * history rounds, poll history, and feedback submissions. Keeping those out of the room keeps
 * every room write small (DynamoDB bills a write by the whole item's size) and
 * keeps the room far from DynamoDB's 400 KB item limit however much feedback
 * comes in.
 *
 * Reads return an independent copy; room writes are optimistic. Don't call
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
   * no longer exists. With `append`, also stores that history (a poker
   * round, a poll result) atomically with the room: all of it is written or
   * none of it is.
   */
  saveRoom(room: StoredRoom, append?: HistoryAppend): Promise<void>;
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
  /**
   * setVote's counterpart for polls: records one participant's choices (or
   * clears them, with an empty list) as a single-field write. Only applies
   * if the poll is the active activity, is still poll `pollId` (not since
   * replaced), isn't closed, every id is one of its options, and more than
   * one id is only accepted for a multiple-choice poll — all checked
   * atomically with the write. Bumps `version`. Returns the updated room, or
   * undefined if the room doesn't exist or the conditions don't hold.
   */
  setPollVote(
    code: string,
    participantId: string,
    pollId: string,
    optionIds: string[]
  ): Promise<StoredRoom | undefined>;
  /**
   * Stores a feedback submission and bumps the room's submission count (and
   * version), atomically, without reading the room first — like setVote, so
   * a burst of submissions doesn't conflict. Returns the updated room;
   * "full" (storing nothing) if the room already has `maxSubmissions`; or
   * undefined (storing nothing) if the room doesn't exist.
   */
  addFeedback(code: string, item: FeedbackItem, maxSubmissions: number): Promise<StoredRoom | "full" | undefined>;
  /**
   * Deletes one feedback submission, or all of them, and lowers the room's
   * submission count to match (to 0 for all) — atomically with other
   * submissions, like addFeedback. Returns the updated room, or undefined
   * (changing nothing) if nothing was deleted or the room doesn't exist.
   */
  deleteFeedback(code: string, target: DeleteTarget): Promise<StoredRoom | undefined>;
  /**
   * Deletes one history entry (by id), or all of them, from the room's poker
   * or poll history. Only the list: the room's summary count is the caller's
   * to update (it's a whole-room field). Returns the ids actually deleted.
   */
  deleteHistory(code: string, kind: HistoryKind, target: DeleteTarget): Promise<string[]>;
  /** Deletes all but the newest `keep` entries of the room's poker or poll history. */
  trimHistory(code: string, kind: HistoryKind, keep: number): Promise<void>;
  /** The room's poker history, newest first, at most `limit` rounds. */
  listPokerHistory(code: string, limit: number): Promise<PokerHistoryEntry[]>;
  /** The room's finished polls, newest (by when the poll started) first, at most `limit`. */
  listPollHistory(code: string, limit: number): Promise<PollHistoryEntry[]>;
  /** The room's feedback submissions, newest first. */
  listFeedback(code: string): Promise<FeedbackItem[]>;
  touchRoom(code: string): Promise<void>;
  /** Removes the room along with its poker history, poll history and feedback. */
  deleteRoom(code: string): Promise<void>;
}

const ROOM_TTL_MS = 60 * 24 * 60 * 60 * 1000; // rooms with no activity for 60 days are swept

interface InMemoryRecord {
  room: StoredRoom;
  history: PokerHistoryEntry[]; // newest first
  pollHistory: PollHistoryEntry[]; // newest (by createdAt) first
  feedback: FeedbackItem[]; // newest first
}

export class InMemoryRoomStore implements RoomStore {
  private records = new Map<string, InMemoryRecord>();

  constructor() {
    const sweep = setInterval(() => this.sweep(), 15 * 60 * 1000);
    sweep.unref?.();
  }

  private sweep() {
    const now = Date.now();
    for (const [code, { room }] of this.records) {
      if (now - room.lastActivityAt > ROOM_TTL_MS) {
        this.records.delete(code);
      }
    }
  }

  async createRoom(name: string): Promise<StoredRoom> {
    let code = generateRoomCode();
    while (this.records.has(code)) {
      code = generateRoomCode();
    }
    const room = newRoom(code, name);
    this.records.set(code, { room: structuredClone(room), history: [], pollHistory: [], feedback: [] });
    return room;
  }

  // Copies in and out (rather than handing out the stored object) so this
  // store behaves like DynamoDB: a change isn't visible until it's saved, and
  // two readers get separate copies that can conflict — otherwise the version
  // check would be comparing an object with itself and could never fail.
  async getRoom(code: string): Promise<StoredRoom | undefined> {
    const record = this.records.get(code.toUpperCase());
    return record && structuredClone(record.room);
  }

  async saveRoom(room: StoredRoom, append?: HistoryAppend): Promise<void> {
    const record = this.records.get(room.code);
    if (!record || record.room.version !== room.version) throw new RoomConflictError(room.code);
    room.version += 1;
    record.room = structuredClone(room);
    if (append?.pokerRound) record.history.unshift(structuredClone(append.pokerRound));
    if (append?.pollResult) {
      const result = append.pollResult;
      record.pollHistory = [structuredClone(result), ...record.pollHistory.filter((e) => e.id !== result.id)].sort(
        (a, b) => b.createdAt - a.createdAt
      );
    }
  }

  async setVote(code: string, participantId: string, value: string | null): Promise<StoredRoom | undefined> {
    const room = this.records.get(code.toUpperCase())?.room;
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

  async setPollVote(
    code: string,
    participantId: string,
    pollId: string,
    optionIds: string[]
  ): Promise<StoredRoom | undefined> {
    const room = this.records.get(code.toUpperCase())?.room;
    if (!room || room.activeActivity !== "poll") return undefined;
    const poll = room.poll;
    if (poll.id !== pollId || poll.closed) return undefined;
    if (!optionIds.every((id) => poll.optionIds.includes(id))) return undefined;
    if (optionIds.length > 1 && !poll.multiple) return undefined;
    if (optionIds.length === 0) {
      delete poll.votes[participantId];
    } else {
      poll.votes[participantId] = [...optionIds];
    }
    room.version += 1;
    room.lastActivityAt = Date.now();
    return structuredClone(room);
  }

  async addFeedback(code: string, item: FeedbackItem, maxSubmissions: number): Promise<StoredRoom | "full" | undefined> {
    const record = this.records.get(code.toUpperCase());
    if (!record) return undefined;
    if (record.room.feedback.submissionCount >= maxSubmissions) return "full";
    record.feedback.unshift(structuredClone(item));
    record.room.feedback.submissionCount += 1;
    record.room.version += 1;
    record.room.lastActivityAt = Date.now();
    return structuredClone(record.room);
  }

  async deleteFeedback(code: string, target: DeleteTarget): Promise<StoredRoom | undefined> {
    const record = this.records.get(code.toUpperCase());
    if (!record) return undefined;
    const before = record.feedback.length;
    record.feedback = "all" in target ? [] : record.feedback.filter((item) => item.id !== target.id);
    const deleted = before - record.feedback.length;
    if (deleted === 0) return undefined;
    const { feedback } = record.room;
    feedback.submissionCount = "all" in target ? 0 : Math.max(0, feedback.submissionCount - deleted);
    record.room.version += 1;
    record.room.lastActivityAt = Date.now();
    return structuredClone(record.room);
  }

  async deleteHistory(code: string, kind: HistoryKind, target: DeleteTarget): Promise<string[]> {
    const record = this.records.get(code.toUpperCase());
    if (!record) return [];
    const list: { id: string }[] = kind === "poker" ? record.history : record.pollHistory;
    const deleted = list.filter((entry) => "all" in target || entry.id === target.id).map((entry) => entry.id);
    if (kind === "poker") record.history = record.history.filter((e) => !deleted.includes(e.id));
    else record.pollHistory = record.pollHistory.filter((e) => !deleted.includes(e.id));
    return deleted;
  }

  async trimHistory(code: string, kind: HistoryKind, keep: number): Promise<void> {
    const record = this.records.get(code.toUpperCase());
    if (!record) return;
    if (kind === "poker") record.history = record.history.slice(0, keep);
    else record.pollHistory = record.pollHistory.slice(0, keep);
  }

  async listPokerHistory(code: string, limit: number): Promise<PokerHistoryEntry[]> {
    return structuredClone(this.records.get(code.toUpperCase())?.history.slice(0, limit) ?? []);
  }

  async listPollHistory(code: string, limit: number): Promise<PollHistoryEntry[]> {
    return structuredClone(this.records.get(code.toUpperCase())?.pollHistory.slice(0, limit) ?? []);
  }

  async listFeedback(code: string): Promise<FeedbackItem[]> {
    return structuredClone(this.records.get(code.toUpperCase())?.feedback ?? []);
  }

  async touchRoom(code: string): Promise<void> {
    const record = this.records.get(code.toUpperCase());
    if (record) record.room.lastActivityAt = Date.now();
  }

  async deleteRoom(code: string): Promise<void> {
    this.records.delete(code.toUpperCase());
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
