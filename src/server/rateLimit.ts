/**
 * A small in-memory rate limiter: at most `limit` recorded uses per key (e.g.
 * per client IP) in any rolling `windowMs`. In-memory is enough while the app
 * runs as a single instance; several instances would each count separately
 * (see the scaling caveat in CLAUDE.md), so they'd need a shared store.
 *
 * `allowed` and `record` are separate so a caller can count only what
 * succeeded (a failed room creation shouldn't use up an allowance).
 */
export interface RateLimiter {
  /** Whether `key` has uses left in the current window. */
  allowed(key: string): boolean;
  /** Counts one use for `key`. */
  record(key: string): void;
}

// Past this many keys, a record() also drops keys with no recent uses, so a
// stream of one-off visitors can't grow the map forever.
const SWEEP_THRESHOLD = 10_000;

export function createRateLimiter(options: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const { limit, windowMs, now = Date.now } = options;
  const uses = new Map<string, number[]>();

  function recent(key: string): number[] {
    const cutoff = now() - windowMs;
    const kept = (uses.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length > 0) uses.set(key, kept);
    else uses.delete(key);
    return kept;
  }

  return {
    allowed: (key) => recent(key).length < limit,
    record(key) {
      uses.set(key, [...recent(key), now()]);
      if (uses.size > SWEEP_THRESHOLD) for (const k of [...uses.keys()]) recent(k);
    },
  };
}

/**
 * A token bucket: holds up to `capacity` tokens, refilled continuously at
 * `refillPerSecond`; each `take()` spends one if there is one. So short bursts
 * (up to `capacity` at once) are fine, but the sustained rate is capped at
 * `refillPerSecond`.
 */
export function createTokenBucket(options: { capacity: number; refillPerSecond: number; now?: () => number }) {
  const { capacity, refillPerSecond, now = Date.now } = options;
  let tokens = capacity;
  let last = now();
  return {
    take(): boolean {
      const t = now();
      tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSecond);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

declare global {
  var __agilityRoomCreationLimiter: RateLimiter | undefined;
}

/** Rooms one client IP can create per rolling day. */
export const MAX_ROOMS_PER_IP_PER_DAY = 10;

/**
 * Shared across the process, like roomStore: stashed on globalThis so a hot
 * reload of the API route in dev doesn't reset everyone's allowance.
 */
export const roomCreationLimiter: RateLimiter = (globalThis.__agilityRoomCreationLimiter ??= createRateLimiter({
  limit: MAX_ROOMS_PER_IP_PER_DAY,
  windowMs: 24 * 60 * 60 * 1000,
}));
