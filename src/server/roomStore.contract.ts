import { describe, expect, it } from "vitest";
import type { RoomStore } from "@/server/roomStore";

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
      expect(room.pokerHistory).toEqual([]);
      expect(room.feedback).toEqual({ items: [], submissionCount: 0 });
      expect(room.plinko).toEqual({ options: [], isRunning: false, winner: null, seed: null });
      expect(room.teams).toEqual({ names: [], teamCount: 2, teams: [] });
      expect(room.lastActivityAt).toBe(room.createdAt);
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

    it("is a no-op for a room that doesn't exist", async () => {
      const store = createStore();
      await expect(store.deleteRoom("NOPE99")).resolves.not.toThrow();
    });
  });
}
