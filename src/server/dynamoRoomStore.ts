import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type BatchWriteCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import type { FeedbackItem, PokerHistoryEntry } from "@/lib/types";
import { generateRoomCode, newRoom } from "@/server/newRoom";
import type { RoomStore, StoredRoom } from "@/server/roomStore";
import { RoomConflictError } from "@/server/roomUpdates";

/*
 * Table layout: partition key `pk` (the room code) + sort key `sk`, so a room
 * and everything that grows with it live together but as separate items:
 *
 *   pk=A5NY7D  sk=ROOM                            the room (StoredRoom)
 *   pk=A5NY7D  sk=HISTORY#<revealedAt>#<id>       one per revealed poker round
 *   pk=A5NY7D  sk=FEEDBACK#<createdAt>#<id>       one per feedback submission
 *
 * Every write to the room item is billed by the room item's size alone, and
 * no single item grows without bound (DynamoDB caps items at 400 KB). Listing
 * history or feedback is one Query on the sort-key prefix, newest first.
 *
 * Every item has `expiresAt` (epoch seconds), the attribute the table's TTL
 * setting points at: the room's is pushed out on every write, so an active
 * room lives on; history rounds and feedback expire a TTL after they were
 * created, so a long-lived room's oldest entries age out on their own.
 */

const ROOM_SK = "ROOM";
const HISTORY_PREFIX = "HISTORY#";
const FEEDBACK_PREFIX = "FEEDBACK#";

// Matches InMemoryRoomStore's 60-day sweep. The constructor can override it
// (see dynamoRoomStore.test.ts, which uses a short TTL so test-created items
// don't linger in the real table for 60 days).
const DEFAULT_TTL_SECONDS = 60 * 24 * 60 * 60;

type Keyed<T> = T & { pk: string; sk: string; expiresAt: number };

function withoutKeys<T>(item: Record<string, unknown>): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarding storage-only attributes on purpose
  const { pk, sk, expiresAt, ...rest } = item;
  return rest as T;
}

// Sort keys compare as strings, so timestamps are zero-padded to keep string
// order equal to time order.
function timeKey(ms: number): string {
  return String(ms).padStart(15, "0");
}

function errorName(err: unknown): string | undefined {
  return err instanceof Error ? err.name : undefined;
}

/**
 * True if a write failed because its condition didn't hold or the item was
 * mid-transaction — i.e. someone else changed it first. For a transaction,
 * that's reported per item inside TransactionCanceledException.
 */
function isWriteConflict(err: unknown): boolean {
  const name = errorName(err);
  if (name === "ConditionalCheckFailedException" || name === "TransactionConflictException") return true;
  if (name === "TransactionCanceledException") {
    const reasons = (err as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
    return reasons.some((r) => r.Code === "ConditionalCheckFailed" || r.Code === "TransactionConflict");
  }
  return false;
}

/**
 * A plain (non-transactional) write that lands on the room while a reveal's
 * transaction is writing it fails with TransactionConflictException. That's
 * transient — the transaction finishes within milliseconds — so retry briefly
 * rather than failing a vote or feedback submission over it.
 */
async function retryTransactionConflict<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      if (errorName(err) !== "TransactionConflictException" || attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * attempt));
    }
  }
}

/**
 * DynamoDB-backed RoomStore. Verify any change here against
 * `testRoomStoreContract` (roomStore.contract.ts) with `npm run test:dynamo`
 * before trusting it — that's what the contract suite is for.
 */
export class DynamoRoomStore implements RoomStore {
  private client: DynamoDBDocumentClient;
  private tableName: string;
  private ttlSeconds: number;

  constructor(tableName: string, options: { client?: DynamoDBDocumentClient; ttlSeconds?: number } = {}) {
    this.tableName = tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  private expiresAt(fromMs: number): number {
    return Math.floor(fromMs / 1000) + this.ttlSeconds;
  }

  private roomKey(code: string) {
    return { pk: code.toUpperCase(), sk: ROOM_SK };
  }

  private roomItem(room: StoredRoom): Keyed<StoredRoom> {
    return { ...room, ...this.roomKey(room.code), expiresAt: this.expiresAt(room.lastActivityAt) };
  }

  private historyItem(code: string, entry: PokerHistoryEntry): Keyed<PokerHistoryEntry> {
    return {
      ...entry,
      pk: code,
      sk: `${HISTORY_PREFIX}${timeKey(entry.revealedAt)}#${entry.id}`,
      expiresAt: this.expiresAt(entry.revealedAt),
    };
  }

  private feedbackItem(code: string, item: FeedbackItem): Keyed<FeedbackItem> {
    return {
      ...item,
      pk: code,
      sk: `${FEEDBACK_PREFIX}${timeKey(item.createdAt)}#${item.id}`,
      expiresAt: this.expiresAt(item.createdAt),
    };
  }

  async createRoom(name: string): Promise<StoredRoom> {
    // Codes are short (6 chars, ~1e9 combinations), so a collision is rare
    // but not impossible. InMemoryRoomStore checks its own Map before
    // picking a code; Dynamo has no cheap equivalent pre-check, so instead
    // the write itself is conditional and we just retry on the rare clash.
    for (;;) {
      const room = newRoom(generateRoomCode(), name);
      try {
        await this.client.send(
          new PutCommand({
            TableName: this.tableName,
            Item: this.roomItem(room),
            ConditionExpression: "attribute_not_exists(pk)",
          })
        );
        return room;
      } catch (err) {
        if (errorName(err) !== "ConditionalCheckFailedException") throw err;
        // Someone already holds this code — loop and try a fresh one.
      }
    }
  }

  async getRoom(code: string): Promise<StoredRoom | undefined> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: this.roomKey(code) }));
    return res.Item ? withoutKeys<StoredRoom>(res.Item) : undefined;
  }

  async saveRoom(room: StoredRoom, historyEntry?: PokerHistoryEntry): Promise<void> {
    const readVersion = room.version;
    const putRoom = {
      TableName: this.tableName,
      Item: this.roomItem({ ...room, version: readVersion + 1 }),
      // Also fails if the room no longer exists, so an expired room is
      // never silently recreated.
      ConditionExpression: "version = :read",
      ExpressionAttributeValues: { ":read": readVersion },
    };
    try {
      if (historyEntry) {
        // A reveal: the room (now revealed, count bumped) and its new history
        // round are written together or not at all, so a retry after a
        // conflict can't leave a duplicate or orphaned round behind.
        await this.client.send(
          new TransactWriteCommand({
            TransactItems: [
              { Put: putRoom },
              { Put: { TableName: this.tableName, Item: this.historyItem(room.code, historyEntry) } },
            ],
          })
        );
      } else {
        await this.client.send(new PutCommand(putRoom));
      }
    } catch (err) {
      if (isWriteConflict(err)) throw new RoomConflictError(room.code);
      throw err;
    }
    room.version = readVersion + 1;
  }

  async setVote(code: string, participantId: string, value: string | null): Promise<StoredRoom | undefined> {
    const now = Date.now();
    const bookkeeping = "version = version + :one, lastActivityAt = :now, expiresAt = :exp";
    const vote =
      value === null
        ? { UpdateExpression: `REMOVE poker.votes.#participant SET ${bookkeeping}`, values: {} }
        : { UpdateExpression: `SET poker.votes.#participant = :value, ${bookkeeping}`, values: { ":value": value } };
    try {
      const res = await retryTransactionConflict(() =>
        this.client.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: this.roomKey(code),
            UpdateExpression: vote.UpdateExpression,
            // Same rules the whole-room handler used to check after a read, now
            // enforced by DynamoDB at write time. (Also fails if the room doesn't
            // exist, since activeActivity is then missing.)
            ConditionExpression:
              value === null
                ? "activeActivity = :poker AND poker.revealed = :false"
                : "activeActivity = :poker AND poker.revealed = :false AND contains(poker.deck, :value)",
            ExpressionAttributeNames: { "#participant": participantId },
            ExpressionAttributeValues: {
              ...vote.values,
              ":poker": "poker",
              ":false": false,
              ":one": 1,
              ":now": now,
              ":exp": this.expiresAt(now),
            },
            ReturnValues: "ALL_NEW",
          })
        )
      );
      return withoutKeys<StoredRoom>(res.Attributes!);
    } catch (err) {
      if (errorName(err) === "ConditionalCheckFailedException") return undefined;
      throw err;
    }
  }

  async addFeedback(code: string, item: FeedbackItem): Promise<StoredRoom | undefined> {
    const upper = code.toUpperCase();
    const feedbackItem = this.feedbackItem(upper, item);
    // Deliberately not a transaction: submissions come in bursts (everyone at
    // the end of a retro), and concurrent transactions on the same room cancel
    // each other. Two plain writes instead, ordered so that a failure between
    // them is harmless: the submission is stored first, then the room's count
    // is bumped (which is what tells admins to reload the list).
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: feedbackItem }));
    const now = Date.now();
    try {
      const res = await retryTransactionConflict(() =>
        this.client.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: this.roomKey(upper),
            UpdateExpression:
              "SET #feedback.submissionCount = #feedback.submissionCount + :one, " +
              "version = version + :one, lastActivityAt = :now, expiresAt = :exp",
            ConditionExpression: "attribute_exists(pk)",
            ExpressionAttributeNames: { "#feedback": "feedback" },
            ExpressionAttributeValues: { ":one": 1, ":now": now, ":exp": this.expiresAt(now) },
            ReturnValues: "ALL_NEW",
          })
        )
      );
      return withoutKeys<StoredRoom>(res.Attributes!);
    } catch (err) {
      if (errorName(err) !== "ConditionalCheckFailedException") throw err;
      // No such room: take back the submission stored a moment ago.
      await this.client.send(
        new DeleteCommand({ TableName: this.tableName, Key: { pk: feedbackItem.pk, sk: feedbackItem.sk } })
      );
      return undefined;
    }
  }

  async listPokerHistory(code: string, limit: number): Promise<PokerHistoryEntry[]> {
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": code.toUpperCase(), ":prefix": HISTORY_PREFIX },
        ScanIndexForward: false, // newest first
        Limit: limit,
      })
    );
    return (res.Items ?? []).map((item) => withoutKeys<PokerHistoryEntry>(item));
  }

  async listFeedback(code: string): Promise<FeedbackItem[]> {
    const items: FeedbackItem[] = [];
    let startKey: Record<string, unknown> | undefined;
    // A Query returns at most 1 MB per page, so a room with a lot of feedback
    // comes back in several pages.
    do {
      const res = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": code.toUpperCase(), ":prefix": FEEDBACK_PREFIX },
          ScanIndexForward: false, // newest first
          ExclusiveStartKey: startKey,
        })
      );
      items.push(...(res.Items ?? []).map((item) => withoutKeys<FeedbackItem>(item)));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  async touchRoom(code: string): Promise<void> {
    const now = Date.now();
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this.roomKey(code),
          UpdateExpression: "SET lastActivityAt = :now, expiresAt = :exp",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: { ":now": now, ":exp": this.expiresAt(now) },
        })
      );
    } catch (err) {
      if (errorName(err) !== "ConditionalCheckFailedException") throw err; // no-op for a room that doesn't exist
    }
  }

  async deleteRoom(code: string): Promise<void> {
    const pk = code.toUpperCase();
    // Collect every item under the room (the room itself, history, feedback)…
    const keys: { pk: string; sk: string }[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": pk },
          ProjectionExpression: "pk, sk",
          ExclusiveStartKey: startKey,
        })
      );
      keys.push(...((res.Items ?? []) as { pk: string; sk: string }[]));
      startKey = res.LastEvaluatedKey;
    } while (startKey);

    // …and delete them 25 at a time (BatchWriteItem's limit), resending
    // anything DynamoDB reports as unprocessed.
    for (let i = 0; i < keys.length; i += 25) {
      let requests: Record<string, unknown>[] | undefined = keys
        .slice(i, i + 25)
        .map((key) => ({ DeleteRequest: { Key: key } }));
      while (requests && requests.length > 0) {
        const res: BatchWriteCommandOutput = await this.client.send(
          new BatchWriteCommand({ RequestItems: { [this.tableName]: requests } })
        );
        requests = res.UnprocessedItems?.[this.tableName];
      }
    }
  }
}
