import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVersionedThrottle } from "@/server/roomThrottle";

describe("createVersionedThrottle", () => {
  let sent: string[];
  let schedule: (key: string, snapshot: { version: number }) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    schedule = createVersionedThrottle(50, (key, snapshot) => sent.push(`${key}@${snapshot.version}`));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a lone change immediately", () => {
    schedule("ROOM", { version: 1 });
    expect(sent).toEqual(["ROOM@1"]);
  });

  it("collapses a burst into the first change plus one send of the newest", () => {
    for (let v = 1; v <= 40; v++) schedule("ROOM", { version: v });
    expect(sent).toEqual(["ROOM@1"]);

    vi.advanceTimersByTime(50);
    expect(sent).toEqual(["ROOM@1", "ROOM@40"]);

    vi.advanceTimersByTime(50);
    expect(sent).toEqual(["ROOM@1", "ROOM@40"]);
  });

  it("keeps sending at most once per window during a sustained burst", () => {
    let v = 0;
    for (let ms = 0; ms < 200; ms += 10) {
      schedule("ROOM", { version: ++v });
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(100);
    // 20 changes over 200ms with a 50ms window: a handful of sends, ending on the newest.
    expect(sent.length).toBeLessThanOrEqual(6);
    expect(sent.at(-1)).toBe("ROOM@20");
  });

  it("never lets an older snapshot that arrives late replace a newer one", () => {
    schedule("ROOM", { version: 1 });
    schedule("ROOM", { version: 5 });
    schedule("ROOM", { version: 3 });
    vi.advanceTimersByTime(50);
    expect(sent).toEqual(["ROOM@1", "ROOM@5"]);
  });

  it("doesn't resend when nothing newer arrived during the window", () => {
    schedule("ROOM", { version: 1 });
    vi.advanceTimersByTime(50);
    schedule("ROOM", { version: 2 });
    expect(sent).toEqual(["ROOM@1", "ROOM@2"]);
  });

  it("throttles each key independently", () => {
    schedule("A", { version: 1 });
    schedule("B", { version: 1 });
    schedule("A", { version: 2 });
    expect(sent).toEqual(["A@1", "B@1"]);
    vi.advanceTimersByTime(50);
    expect(sent).toEqual(["A@1", "B@1", "A@2"]);
  });
});
