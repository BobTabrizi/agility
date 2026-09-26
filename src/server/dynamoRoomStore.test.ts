import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { DynamoRoomStore } from "@/server/dynamoRoomStore";
import { testRoomStoreContract } from "@/server/roomStore.contract";
import { RoomConflictError, updateRoom } from "@/server/roomUpdates";

// Opt-in: these hit a real, pay-per-request DynamoDB table, so they only run
// via `npm run test:dynamo` (which sets RUN_DYNAMODB_TESTS=1) — never as part
// of a plain `npm test`, even when .env.local has the table configured. Run
// them after changing a RoomStore or the DynamoDB store, not on every edit.
//
// Separate from DYNAMODB_TABLE_NAME (the app's runtime table) so running
// tests can never point at, and litter, whatever table the app itself uses.
// Rooms these tests create aren't explicitly cleaned up — they rely on TTL
// to expire on their own. Unlike the app's real 60-day TTL, these get a
// short one (see ttlSeconds below) so test debris doesn't linger for months
// in the real table.
const tableName = process.env.DYNAMODB_TEST_TABLE;
const TEST_TTL_SECONDS = 60 * 60; // 1 hour
const optedIn = process.env.RUN_DYNAMODB_TESTS === "1";

describe.skipIf(!optedIn || !tableName)(
  "DynamoRoomStore (only via `npm run test:dynamo`; needs DYNAMODB_TEST_TABLE + AWS credentials)",
  () => {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const createStore = () => new DynamoRoomStore(tableName!, { client, ttlSeconds: TEST_TTL_SECONDS });
    testRoomStoreContract(createStore);

    // Rooms written before versioning existed have no `version` attribute at
    // all — something only this store can have, so it's tested here rather
    // than in the shared contract.
    describe("rooms saved before versioning", () => {
      async function putLegacyRoom(store: DynamoRoomStore) {
        const { code } = await store.createRoom("Legacy");
        const item = (await store.getRoom(code))!;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stripping to simulate an old item
        const { version, appointedAdminTokens, ...legacy } = item;
        await client.send(
          new PutCommand({
            TableName: tableName!,
            Item: { ...legacy, expiresAt: Math.floor(Date.now() / 1000) + TEST_TTL_SECONDS },
          })
        );
        return code;
      }

      it("reads back as version 0 and can be updated, which starts versioning it", async () => {
        const store = createStore();
        const code = await putLegacyRoom(store);
        expect((await store.getRoom(code))!.version).toBe(0);

        const result = await updateRoom(store, code, (room) => {
          room.poker.topic = "upgraded";
        });
        expect(result.status).toBe("saved");
        const room = (await store.getRoom(code))!;
        expect(room.version).toBe(1);
        expect(room.poker.topic).toBe("upgraded");
      });

      it("still rejects a stale write to a legacy room", async () => {
        const store = createStore();
        const code = await putLegacyRoom(store);
        const first = (await store.getRoom(code))!;
        const second = (await store.getRoom(code))!;
        await store.saveRoom(first);
        await expect(store.saveRoom(second)).rejects.toBeInstanceOf(RoomConflictError);
      });

      it("accepts a vote, which starts versioning it", async () => {
        const store = createStore();
        const code = await putLegacyRoom(store);
        const room = await store.setVote(code, "alice", "5");
        expect(room?.poker.votes).toEqual({ alice: "5" });
        expect(room?.version).toBe(1);
      });

      it("doesn't recreate a legacy room that was deleted", async () => {
        const store = createStore();
        const code = await putLegacyRoom(store);
        const room = (await store.getRoom(code))!;
        await client.send(new DeleteCommand({ TableName: tableName!, Key: { code } }));
        await expect(store.saveRoom(room)).rejects.toBeInstanceOf(RoomConflictError);
      });
    });
  }
);
