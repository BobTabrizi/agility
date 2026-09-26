import { describe, expect, it } from "vitest";
import { createKeyedQueue } from "@/server/roomUpdates";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createKeyedQueue", () => {
  it("runs tasks for the same key one at a time, in order", async () => {
    const enqueue = createKeyedQueue();
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`start ${name}`);
      await tick(ms);
      events.push(`end ${name}`);
      return name;
    };

    // The first task is the slowest: without the queue, b and c would finish first.
    const results = await Promise.all([
      enqueue("ROOM", task("a", 30)),
      enqueue("ROOM", task("b", 10)),
      enqueue("ROOM", task("c", 1)),
    ]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("keeps going after a task fails, and still reports that failure to its caller", async () => {
    const enqueue = createKeyedQueue();
    const failing = enqueue("ROOM", async () => {
      throw new Error("boom");
    });
    const next = enqueue("ROOM", async () => "ran");

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });

  it("doesn't make different keys wait for each other", async () => {
    const enqueue = createKeyedQueue();
    const events: string[] = [];
    await Promise.all([
      enqueue("SLOW", async () => {
        await tick(30);
        events.push("slow");
      }),
      enqueue("FAST", async () => {
        events.push("fast");
      }),
    ]);
    expect(events).toEqual(["fast", "slow"]);
  });
});
