import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe } from "vitest";
import { DynamoRoomStore } from "@/server/dynamoRoomStore";
import { testRoomStoreContract } from "@/server/roomStore.contract";

// Separate from DYNAMODB_TABLE_NAME (the app's runtime table) so running
// tests can never point at, and litter, whatever table the app itself uses.
// Rooms these tests create aren't explicitly cleaned up — they rely on TTL
// to expire on their own. Unlike the app's real 60-day TTL, these get a
// short one (see ttlSeconds below) so test debris doesn't linger for months
// in the real table.
const tableName = process.env.DYNAMODB_TEST_TABLE;
const TEST_TTL_SECONDS = 60 * 60; // 1 hour

describe.skipIf(!tableName)(
  "DynamoRoomStore (skipped unless DYNAMODB_TEST_TABLE + AWS credentials are set)",
  () => {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    testRoomStoreContract(
      () => new DynamoRoomStore(tableName!, { client, ttlSeconds: TEST_TTL_SECONDS })
    );
  }
);
