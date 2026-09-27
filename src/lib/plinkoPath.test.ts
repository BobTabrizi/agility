import { describe, expect, it } from "vitest";
import { plinkoPath, plinkoPositions, plinkoRowCount } from "@/lib/plinkoPath";

/** Deterministic PRNG so failures are reproducible. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("plinkoRowCount", () => {
  it("has at least 14 rows, enough to reach the edges, and an even count", () => {
    for (let slots = 2; slots <= 12; slots++) {
      const rows = plinkoRowCount(slots);
      expect(rows).toBeGreaterThanOrEqual(14);
      expect(rows).toBeGreaterThanOrEqual(2 * (slots - 1));
      expect(rows % 2).toBe(0);
    }
  });
});

describe("plinkoPath", () => {
  it("always ends in the winning slot and never leaves the board", () => {
    const random = seeded(42);
    for (let slots = 2; slots <= 12; slots++) {
      for (let winner = 0; winner < slots; winner++) {
        for (let trial = 0; trial < 50; trial++) {
          const path = plinkoPath(slots, winner, random);
          expect(path).toHaveLength(plinkoRowCount(slots));
          expect(path.every((step) => step === 1 || step === -1)).toBe(true);
          const positions = plinkoPositions(slots, path);
          expect(positions[positions.length - 1]).toBe(winner);
          expect(positions.every((p) => p >= 0 && p <= slots - 1)).toBe(true);
        }
      }
    }
  });

  it("varies the route to the same slot (it's a random bounce, not a fixed track)", () => {
    const random = seeded(7);
    const routes = new Set(Array.from({ length: 40 }, () => plinkoPath(8, 3, random).join(",")));
    expect(routes.size).toBeGreaterThan(10);
  });

  // The fairness guarantee lives in the server picking the winner uniformly;
  // this just confirms the path doesn't bias anything once it has.
  it("with a uniformly chosen winner, every slot comes up about equally often", () => {
    const random = seeded(99);
    const slots = 12;
    const counts = new Array(slots).fill(0);
    const drops = 12_000;
    for (let i = 0; i < drops; i++) {
      const winner = Math.floor(random() * slots);
      const positions = plinkoPositions(slots, plinkoPath(slots, winner, random));
      counts[positions[positions.length - 1]]++;
    }
    for (const count of counts) expect(count / drops).toBeCloseTo(1 / slots, 1);
  });

  it("rejects a slot that doesn't exist", () => {
    expect(() => plinkoPath(5, 5)).toThrow();
    expect(() => plinkoPath(1, 0)).toThrow();
  });
});
