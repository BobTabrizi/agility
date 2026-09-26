import { describe, expect, it } from "vitest";
import type { FeedbackItem, PokerHistoryEntry } from "@/lib/types";
import type { RoomStore } from "@/server/roomStore";
import { RoomConflictError, SKIP, updateRoom } from "@/server/roomUpdates";

/**
 * Behavior every RoomStore implementation must satisfy — run this against a
 * fresh instance per test. Exercise a future backend (e.g. DynamoDB) against
 * this suite before trusting it in socketServer.ts; it's the safety net for
 * that swap. Not named `*.test.ts` on purpose, so vitest doesn't try to run
 * it directly — it only runs wherever a real `*.test.ts` file calls it.
 */
export function testRoomStoreContract(createStore: () => RoomStore) {
  describe("createRoom", () => {
    it("returns a room with sane defaults", async () => {
      const store = createStore();
      const room = await store.createRoom("Platform Team");

      expect(room.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      expect(room.name).toBe("Platform Team");
      expect(room.adminToken).toBeTruthy();
      expect(room.appointedAdminTokens).toEqual({});
      expect(room.activeActivity).toBe("poker");
      expect(room.participants).toEqual([]);
      expect(room.poker.votes).toEqual({});
      expect(room.poker.revealed).toBe(false);
      expect(room.poker.deck.length).toBeGreaterThan(0);
      expect(room.pokerHistorySummary).toEqual({ count: 0, latestRevealedAt: null });
      expect(room.feedback).toEqual({ submissionCount: 0 });
      expect(await store.listPokerHistory(room.code, 50)).toEqual([]);
      expect(await store.listFeedback(room.code)).toEqual([]);
      expect(room.plinko).toEqual({ options: [], isRunning: false, winner: null, seed: null });
      expect(room.teams).toEqual({ names: [], teamCount: 2, teams: [] });
      expect(room.lastActivityAt).toBe(room.createdAt);
      expect(room.version).toBe(1);
    });

    it("falls back to a generated name when given a blank one", async () => {
      const store = createStore();
      const room = await store.createRoom("   ");
      expect(room.name).toBe(`Room ${room.code}`);
    });

    it("generates distinct codes and admin tokens across rooms", async () => {
      const store = createStore();
      const a = await store.createRoom("A");
      const b = await store.createRoom("B");
      expect(a.code).not.toBe(b.code);
      expect(a.adminToken).not.toBe(b.adminToken);
    });
  });

  describe("getRoom", () => {
    it("returns the room that was created", async () => {
      const store = createStore();
      const created = await store.createRoom("Team");
      expect(await store.getRoom(created.code)).toEqual(created);
    });

    it("is case-insensitive on the room code", async () => {
      const store = createStore();
      const created = await store.createRoom("Team");
      const fetched = await store.getRoom(created.code.toLowerCase());
      expect(fetched?.code).toBe(created.code);
    });

    it("returns undefined for a room that doesn't exist", async () => {
      const store = createStore();
      expect(await store.getRoom("NOPE99")).toBeUndefined();
    });
  });

  describe("saveRoom", () => {
    it("persists mutations for later reads", async () => {
      const store = createStore();
      const room = await store.createRoom("Team");
      room.poker.topic = "Story 42";
      await store.saveRoom(room);

      const fetched = await store.getRoom(room.code);
      expect(fetched?.poker.topic).toBe("Story 42");
    });
  });

  describe("touchRoom", () => {
    it("bumps lastActivityAt", async () => {
      const store = createStore();
      const room = await store.createRoom("Team");
      const before = room.lastActivityAt;

      await new Promise((resolve) => setTimeout(resolve, 5));
      await store.touchRoom(room.code);

      const fetched = await store.getRoom(room.code);
      expect(fetched!.lastActivityAt).toBeGreaterThan(before);
    });

    it("is case-insensitive on the room code", async () => {
      const store = createStore();
      const room = await store.createRoom("Team");
      const before = room.lastActivityAt;

      await new Promise((resolve) => setTimeout(resolve, 5));
      await store.touchRoom(room.code.toLowerCase());

      const fetched = await store.getRoom(room.code);
      expect(fetched!.lastActivityAt).toBeGreaterThan(before);
    });

    it("is a no-op for a room that doesn't exist", async () => {
      const store = createStore();
      await expect(store.touchRoom("NOPE99")).resolves.not.toThrow();
    });
  });

  describe("deleteRoom", () => {
    it("removes the room", async () => {
      const store = createStore();
      const room = await store.createRoom("Team");
      await store.deleteRoom(room.code);
      expect(await store.getRoom(room.code)).toBeUndefined();
    });

    it("also removes its poker history and feedback", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      await updateRoom(store, code, () => ({ addPokerHistory: historyEntry("r1", 1_000) }));
      await store.addFeedback(code, feedbackItem("f1", 1_000));

      await store.deleteRoom(code);

      expect(await store.listPokerHistory(code, 50)).toEqual([]);
      expect(await store.listFeedback(code)).toEqual([]);
    });

    it("is a no-op for a room that doesn't exist", async () => {
      const store = createStore();
      await expect(store.deleteRoom("NOPE99")).resolves.not.toThrow();
    });
  });

  describe("optimistic concurrency", () => {
    it("getRoom returns an independent copy — unsaved changes aren't visible", async () => {
      const store = createStore();
      const room = await store.createRoom("Team");
      const copy = await store.getRoom(room.code);
      copy!.poker.topic = "not saved";
      expect((await store.getRoom(room.code))!.poker.topic).toBe("");
    });

    it("saveRoom bumps the version", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      const room = (await store.getRoom(code))!;
      await store.saveRoom(room);
      expect(room.version).toBe(2);
      expect((await store.getRoom(code))!.version).toBe(2);
    });

    it("saveRoom rejects a stale copy and keeps the newer save", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      const first = (await store.getRoom(code))!;
      const second = (await store.getRoom(code))!;

      first.poker.topic = "first";
      await store.saveRoom(first);
      second.poker.topic = "second";
      await expect(store.saveRoom(second)).rejects.toBeInstanceOf(RoomConflictError);

      expect((await store.getRoom(code))!.poker.topic).toBe("first");
    });

    it("saveRoom rejects a room that no longer exists instead of recreating it", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      const room = (await store.getRoom(code))!;
      await store.deleteRoom(code);
      await expect(store.saveRoom(room)).rejects.toBeInstanceOf(RoomConflictError);
      expect(await store.getRoom(code)).toBeUndefined();
    });
  });

  describe("updateRoom", () => {
    // The bug this guards against: several people voting at once, each
    // handler saving a copy that doesn't include the others' votes.
    it("applies concurrent changes to the same room without losing any", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      const voters = ["a", "b", "c", "d", "e"];

      const results = await Promise.all(
        voters.map((id) =>
          updateRoom(store, code, (room) => {
            room.poker.votes[id] = "5";
          })
        )
      );

      expect(results.every((r) => r.status === "saved")).toBe(true);
      const room = (await store.getRoom(code))!;
      expect(Object.keys(room.poker.votes).sort()).toEqual(voters);
      expect(room.version).toBe(1 + voters.length);
    });

    it("saves nothing when the change skips or rejects", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");

      expect(await updateRoom(store, code, () => SKIP)).toEqual({ status: "skipped" });
      expect(await updateRoom(store, code, () => ({ error: "nope" }))).toEqual({
        status: "rejected",
        error: "nope",
      });
      expect((await store.getRoom(code))!.version).toBe(1);
    });

    it("reports a room that doesn't exist", async () => {
      const store = createStore();
      expect(await updateRoom(store, "NOPE99", () => {})).toEqual({ status: "missing" });
    });
  });

  describe("setVote", () => {
    it("records and clears one participant's vote, bumping the version", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");

      const afterVote = await store.setVote(code, "alice", "5");
      expect(afterVote?.poker.votes).toEqual({ alice: "5" });
      expect(afterVote?.version).toBe(2);

      const afterClear = await store.setVote(code, "alice", null);
      expect(afterClear?.poker.votes).toEqual({});
      expect(afterClear?.version).toBe(3);
      expect((await store.getRoom(code))!.poker.votes).toEqual({});
    });

    it("lands every vote when many people vote at once", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      const voters = Array.from({ length: 10 }, (_, i) => `voter${i}`);

      const results = await Promise.all(voters.map((id) => store.setVote(code, id, "8")));

      expect(results.every(Boolean)).toBe(true);
      const room = (await store.getRoom(code))!;
      expect(Object.keys(room.poker.votes).sort()).toEqual([...voters].sort());
      expect(room.version).toBe(1 + voters.length);
    });

    it("is ignored when the vote isn't allowed right now", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");

      expect(await store.setVote(code, "alice", "not-a-card")).toBeUndefined();

      await updateRoom(store, code, (room) => {
        room.poker.revealed = true;
      });
      expect(await store.setVote(code, "alice", "5")).toBeUndefined();

      await updateRoom(store, code, (room) => {
        room.poker.revealed = false;
        room.activeActivity = "plinko";
      });
      expect(await store.setVote(code, "alice", "5")).toBeUndefined();

      expect((await store.getRoom(code))!.poker.votes).toEqual({});
      expect(await store.setVote("NOPE99", "alice", "5")).toBeUndefined();
    });

    // The two write paths have to coexist: a whole-room save that read the
    // room before a vote landed must not overwrite (drop) that vote.
    it("makes an older whole-room copy stale, so its save conflicts instead of dropping the vote", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      const readBeforeVote = (await store.getRoom(code))!;

      await store.setVote(code, "alice", "5");
      readBeforeVote.poker.topic = "Story 42";
      await expect(store.saveRoom(readBeforeVote)).rejects.toBeInstanceOf(RoomConflictError);

      // What updateRoom does next: re-read and re-apply — keeping both changes.
      await updateRoom(store, code, (room) => {
        room.poker.topic = "Story 42";
      });
      const room = (await store.getRoom(code))!;
      expect(room.poker.topic).toBe("Story 42");
      expect(room.poker.votes).toEqual({ alice: "5" });
    });
  });

  describe("poker history", () => {
    it("adds a round atomically with the room save, listed newest first", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");

      for (const [id, at] of [["r1", 1_000], ["r2", 2_000], ["r3", 3_000]] as const) {
        const result = await updateRoom(store, code, (room) => {
          room.pokerHistorySummary = { count: room.pokerHistorySummary.count + 1, latestRevealedAt: at };
          return { addPokerHistory: historyEntry(id, at) };
        });
        expect(result.status).toBe("saved");
      }

      expect((await store.listPokerHistory(code, 50)).map((e) => e.id)).toEqual(["r3", "r2", "r1"]);
      expect((await store.getRoom(code))!.pokerHistorySummary).toEqual({ count: 3, latestRevealedAt: 3_000 });
    });

    it("returns at most `limit` rounds — the newest ones", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      for (let i = 1; i <= 4; i++) {
        await updateRoom(store, code, () => ({ addPokerHistory: historyEntry(`r${i}`, i * 1_000) }));
      }
      expect((await store.listPokerHistory(code, 2)).map((e) => e.id)).toEqual(["r4", "r3"]);
    });

    // The point of saving them together: a reveal that loses a conflict must
    // not leave its round behind, or the retry would record it twice.
    it("doesn't store the round when the room save is rejected as stale", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      const stale = (await store.getRoom(code))!;
      await store.setVote(code, "alice", "5"); // makes `stale` out of date

      await expect(store.saveRoom(stale, historyEntry("lost", 1_000))).rejects.toBeInstanceOf(RoomConflictError);
      expect(await store.listPokerHistory(code, 50)).toEqual([]);
    });

    it("keeps the full entry, including anonymous (null) names", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      const entry: PokerHistoryEntry = {
        ...historyEntry("r1", 1_000),
        anonymous: true,
        votes: [{ name: null, value: "5" }, { name: null, value: "?" }],
        average: 5,
      };
      await updateRoom(store, code, () => ({ addPokerHistory: entry }));
      expect(await store.listPokerHistory(code, 50)).toEqual([entry]);
    });
  });

  describe("addFeedback", () => {
    it("stores a submission and bumps the count and version", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");

      const room = await store.addFeedback(code, feedbackItem("f1", 1_000));
      expect(room?.feedback.submissionCount).toBe(1);
      expect(room?.version).toBe(2);

      await store.addFeedback(code, feedbackItem("f2", 2_000));
      expect(await store.listFeedback(code)).toEqual([feedbackItem("f2", 2_000), feedbackItem("f1", 1_000)]);
    });

    it("lands every submission when many arrive at once", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      const items = Array.from({ length: 8 }, (_, i) => feedbackItem(`f${i}`, 1_000 + i));

      const results = await Promise.all(items.map((item) => store.addFeedback(code, item)));

      expect(results.every(Boolean)).toBe(true);
      expect((await store.listFeedback(code)).length).toBe(items.length);
      expect((await store.getRoom(code))!.feedback.submissionCount).toBe(items.length);
    });

    it("makes an older whole-room copy stale, like a vote does", async () => {
      const store = createStore();
      const { code } = await store.createRoom("Team");
      const readBefore = (await store.getRoom(code))!;
      await store.addFeedback(code, feedbackItem("f1", 1_000));
      await expect(store.saveRoom(readBefore)).rejects.toBeInstanceOf(RoomConflictError);
    });

    it("stores nothing for a room that doesn't exist", async () => {
      const store = createStore();
      expect(await store.addFeedback("NOPE99", feedbackItem("f1", 1_000))).toBeUndefined();
      expect(await store.listFeedback("NOPE99")).toEqual([]);
    });
  });
}

function historyEntry(id: string, revealedAt: number): PokerHistoryEntry {
  return { id, topic: `Story ${id}`, revealedAt, anonymous: false, votes: [{ name: "Alice", value: "5" }], average: 5 };
}

function feedbackItem(id: string, createdAt: number): FeedbackItem {
  return { id, text: `Feedback ${id}`, createdAt };
}
