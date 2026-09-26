import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe } from "vitest";
import { DynamoRoomStore } from "@/server/dynamoRoomStore";
import { testRoomStoreContract } from "@/server/roomStore.contract";

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
    testRoomStoreContract(() => new DynamoRoomStore(tableName!, { client, ttlSeconds: TEST_TTL_SECONDS }));
  }
);
