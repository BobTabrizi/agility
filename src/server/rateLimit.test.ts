import { describe, expect, it } from "vitest";
import { createRateLimiter, createTokenBucket } from "@/server/rateLimit";

describe("createRateLimiter", () => {
  function setup() {
    let time = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => time });
    return { limiter, advance: (ms: number) => (time += ms) };
  }

  it("allows up to the limit, then refuses", () => {
    const { limiter } = setup();
    expect(limiter.allowed("a")).toBe(true);
    limiter.record("a");
    limiter.record("a");
    expect(limiter.allowed("a")).toBe(false);
  });

  it("counts each key separately", () => {
    const { limiter } = setup();
    limiter.record("a");
    limiter.record("a");
    expect(limiter.allowed("b")).toBe(true);
  });

  it("only checking doesn't use anything up", () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) limiter.allowed("a");
    expect(limiter.allowed("a")).toBe(true);
  });

  it("frees a use once it's older than the window (rolling, not a fixed reset)", () => {
    const { limiter, advance } = setup();
    limiter.record("a"); // t=0
    advance(600);
    limiter.record("a"); // t=600
    expect(limiter.allowed("a")).toBe(false);
    advance(401); // t=1001: the first use has aged out, the second hasn't
    expect(limiter.allowed("a")).toBe(true);
    limiter.record("a");
    expect(limiter.allowed("a")).toBe(false);
  });
});

describe("createTokenBucket", () => {
  it("allows a burst up to capacity, then refills at the given rate", () => {
    let time = 0;
    const bucket = createTokenBucket({ capacity: 3, refillPerSecond: 2, now: () => time });
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
    time += 499; // just under one token's worth (0.5s at 2/s)
    expect(bucket.take()).toBe(false);
    time += 1;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  it("never stores more than capacity, however long it sits idle", () => {
    let time = 0;
    const bucket = createTokenBucket({ capacity: 2, refillPerSecond: 10, now: () => time });
    time += 60_000;
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
  });
});
