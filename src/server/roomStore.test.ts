import { describe } from "vitest";
import { InMemoryRoomStore } from "@/server/roomStore";
import { testRoomStoreContract } from "@/server/roomStore.contract";

describe("InMemoryRoomStore", () => {
  testRoomStoreContract(() => new InMemoryRoomStore());
});
