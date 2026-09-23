import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { customAlphabet } from "nanoid";
import { DEFAULT_POKER_DECK } from "@/lib/types";
import type { RoomStore, StoredRoom } from "@/server/roomStore";

const roomCodeAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const tokenAlphabet = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 24);

// Matches InMemoryRoomStore's 60-day sweep, but enforced by DynamoDB's own
// native TTL instead of an app-level setInterval — `expiresAt` (epoch
// seconds) is the attribute a table's TTL setting would point at. The
// constructor can override this (see dynamoRoomStore.test.ts, which uses a
// short TTL so test-created rooms don't linger in the real table for 60 days).
const DEFAULT_ROOM_TTL_SECONDS = 60 * 24 * 60 * 60;

// The Dynamo item is a StoredRoom plus the TTL attribute. `expiresAt` isn't
// part of RoomState/StoredRoom — it's Dynamo-specific and stripped on read
// so callers never see a field that has no meaning for InMemoryRoomStore.
type RoomItem = StoredRoom & { expiresAt: number };

function fromItem(item: RoomItem): StoredRoom {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarding expiresAt on purpose
  const { expiresAt, ...room } = item;
  return room;
}

function isConditionalCheckFailed(err: unknown): boolean {
  return err instanceof Error && err.name === "ConditionalCheckFailedException";
}

/**
 * DynamoDB-backed RoomStore: one item per room, partition key `code`. Verify
 * any change here against `testRoomStoreContract` (roomStore.contract.ts)
 * before trusting it — that's what the contract suite is for.
 */
export class DynamoRoomStore implements RoomStore {
  private client: DynamoDBDocumentClient;
  private tableName: string;
  private ttlSeconds: number;

  constructor(
    tableName: string,
    options: { client?: DynamoDBDocumentClient; ttlSeconds?: number } = {}
  ) {
    this.tableName = tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_ROOM_TTL_SECONDS;
  }

  private toItem(room: StoredRoom): RoomItem {
    return { ...room, expiresAt: Math.floor(room.lastActivityAt / 1000) + this.ttlSeconds };
  }

  async createRoom(name: string): Promise<StoredRoom> {
    // Codes are short (6 chars, ~1e9 combinations), so a collision is rare
    // but not impossible. InMemoryRoomStore checks its own Map before
    // picking a code; Dynamo has no cheap equivalent pre-check, so instead
    // the write itself is conditional and we just retry on the rare clash.
    for (;;) {
      const code = roomCodeAlphabet();
      const now = Date.now();
      const room: StoredRoom = {
        code,
        name: name.trim() || `Room ${code}`,
        createdAt: now,
        lastActivityAt: now,
        adminToken: tokenAlphabet(),
        activeActivity: "poker",
        participants: [],
        poker: { topic: "", votes: {}, revealed: false, deck: [...DEFAULT_POKER_DECK], anonymous: false },
        pokerHistory: [],
        feedback: { items: [], submissionCount: 0 },
        plinko: { options: [], isRunning: false, winner: null, seed: null },
        teams: { names: [], teamCount: 2, teams: [] },
      };
      try {
        await this.client.send(
          new PutCommand({
            TableName: this.tableName,
            Item: this.toItem(room),
            ConditionExpression: "attribute_not_exists(code)",
          })
        );
        return room;
      } catch (err) {
        if (!isConditionalCheckFailed(err)) throw err;
        // Someone already holds this code — loop and try a fresh one.
      }
    }
  }

  async getRoom(code: string): Promise<StoredRoom | undefined> {
    const res = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { code: code.toUpperCase() } })
    );
    return res.Item ? fromItem(res.Item as RoomItem) : undefined;
  }

  async saveRoom(room: StoredRoom): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: this.toItem(room) }));
  }

  async touchRoom(code: string): Promise<void> {
    const now = Date.now();
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { code: code.toUpperCase() },
          UpdateExpression: "SET lastActivityAt = :now, expiresAt = :exp",
          ConditionExpression: "attribute_exists(code)",
          ExpressionAttributeValues: {
            ":now": now,
            ":exp": Math.floor(now / 1000) + this.ttlSeconds,
          },
        })
      );
    } catch (err) {
      if (!isConditionalCheckFailed(err)) throw err; // no-op for a room that doesn't exist
    }
  }

  async deleteRoom(code: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: { code: code.toUpperCase() } })
    );
  }
}
