import type { PokerHistoryEntry } from "@/lib/types";
import type { RoomStore, StoredRoom } from "@/server/roomStore";

/**
 * Thrown by `RoomStore.saveRoom` when the stored room is no longer at the
 * version the caller read (someone else saved in between), or no longer
 * exists. Nothing is written. Handled by `updateRoom`, which re-reads and
 * retries — callers normally never see it.
 */
export class RoomConflictError extends Error {
  constructor(code: string) {
    super(`Room ${code} was changed or removed since it was read.`);
    this.name = "RoomConflictError";
  }
}

/** `updateRoom` gave up after repeated conflicts — the room is under heavy concurrent writes. */
export class RoomBusyError extends Error {
  constructor(code: string) {
    super(`Room ${code} is too busy to update right now.`);
    this.name = "RoomBusyError";
  }
}

/** Return from an `updateRoom` change to abort without saving (nothing to do). */
export const SKIP = Symbol("skip");

/**
 * What a change can return: nothing (save the room), SKIP, `{ error }`, or
 * `{ addPokerHistory }` — save the room *and* add that history round, as one
 * atomic write (see RoomStore.saveRoom).
 */
export type RoomChange = (
  room: StoredRoom
) => void | typeof SKIP | { error: string } | { addPokerHistory: PokerHistoryEntry };

export type UpdateResult =
  | { status: "saved"; room: StoredRoom }
  | { status: "skipped" }
  | { status: "rejected"; error: string }
  | { status: "missing" };

const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 20;
const BACKOFF_CAP_MS = 500;

/**
 * Read-modify-write a room without losing concurrent updates: reads the
 * latest room, applies `change`, and saves only if nobody else saved in the
 * meantime (`saveRoom`'s version check); on a conflict, re-reads and applies
 * `change` again to the newer room.
 *
 * Because it can run more than once, `change` must derive everything from the
 * room it's given (ids, timestamps, random picks are fine — each attempt just
 * makes fresh ones) and must not have side effects like emitting to sockets;
 * do those after, using the returned room. `change` can mutate the room and
 * return nothing to save, return `SKIP` to save nothing, return `{ error }`
 * to reject the action (also saves nothing), or return `{ addPokerHistory }`
 * to save along with a new history round.
 */
export async function updateRoom(store: RoomStore, code: string, change: RoomChange): Promise<UpdateResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const room = await store.getRoom(code);
    if (!room) return { status: "missing" };

    const outcome = change(room);
    if (outcome === SKIP) return { status: "skipped" };
    if (outcome && "error" in outcome) return { status: "rejected", error: outcome.error };

    try {
      await store.saveRoom(room, outcome?.addPokerHistory);
      return { status: "saved", room };
    } catch (err) {
      if (!(err instanceof RoomConflictError)) throw err;
      // Exponential backoff with full jitter, so writers that collided spread
      // out instead of colliding again in lockstep. Sized against a store
      // round trip (tens of ms for DynamoDB), not just the in-memory store.
      const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, Math.random() * ceiling));
    }
  }
  throw new RoomBusyError(code);
}

/**
 * Runs `task` after every earlier task queued under the same `key` has
 * settled (whether it succeeded or failed), so tasks for one key run one at a
 * time, in order. Used per room code by the socket layer: updates to a room
 * from this process then never conflict with each other, which leaves
 * updateRoom's version check to catch only writes from *other* instances.
 * Without it, a burst like everyone voting at once turns into a pile of
 * conflicting retries, some of which give up.
 */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const run = (tails.get(key) ?? Promise.resolve()).then(task, task);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    tails.set(key, tail);
    // Drop the entry once this is the last task for the key, so the map
    // doesn't grow with every room ever touched.
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}
