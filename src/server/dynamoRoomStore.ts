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
import type { FeedbackItem, PokerHistoryEntry, PollHistoryEntry } from "@/lib/types";
import { generateRoomCode, newRoom } from "@/server/newRoom";
import type { DeleteTarget, HistoryAppend, HistoryKind, RoomStore, StoredRoom } from "@/server/roomStore";
import { RoomConflictError } from "@/server/roomUpdates";

/*
 * Table layout: partition key `pk` (the room code) + sort key `sk`, so a room
 * and everything that grows with it live together but as separate items:
 *
 *   pk=A5NY7D  sk=ROOM                            the room (StoredRoom)
 *   pk=A5NY7D  sk=HISTORY#<revealedAt>#<id>       one per revealed poker round
 *   pk=A5NY7D  sk=POLL#<createdAt>#<pollId>       one per finished poll (re-saving
 *                                                 the same poll overwrites it)
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
const POLL_PREFIX = "POLL#";
const FEEDBACK_PREFIX = "FEEDBACK#";
const HISTORY_PREFIXES: Record<HistoryKind, string> = { poker: HISTORY_PREFIX, poll: POLL_PREFIX };

type ItemKey = { pk: string; sk: string; id: string };

// Matches InMemoryRoomStore's 60-day sweep. The constructor can override it
// (see dynamoRoomStore.test.ts, which uses a short TTL so test-created items
// don't linger in the real table for 60 days).
const DEFAULT_TTL_SECONDS = 60 * 24 * 60 * 60;

type Keyed<T> = T & { pk: string; sk: string; expiresAt: number };

/**
 * A room item as a StoredRoom. This is the place to fill in a field added
 * after rooms were already saved (the next whole-room save then writes it for
 * real) — currently there are none: the tables were wiped when Plinko was
 * replaced, so every stored room has the current shape.
 */
function roomFromItem(item: Record<string, unknown>): StoredRoom {
  return withoutKeys<StoredRoom>(item);
}

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

  // Keyed by the poll's id (and start time, for ordering), so saving the same
  // poll again — closed, reopened, closed again — overwrites its entry.
  private pollHistoryItem(code: string, entry: PollHistoryEntry): Keyed<PollHistoryEntry> {
    return {
      ...entry,
      pk: code,
      sk: `${POLL_PREFIX}${timeKey(entry.createdAt)}#${entry.id}`,
      expiresAt: this.expiresAt(entry.recordedAt),
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
    return res.Item ? roomFromItem(res.Item) : undefined;
  }

  async saveRoom(room: StoredRoom, append?: HistoryAppend): Promise<void> {
    const readVersion = room.version;
    const putRoom = {
      TableName: this.tableName,
      Item: this.roomItem({ ...room, version: readVersion + 1 }),
      // Also fails if the room no longer exists, so an expired room is
      // never silently recreated.
      ConditionExpression: "version = :read",
      ExpressionAttributeValues: { ":read": readVersion },
    };
    const historyPuts = [
      ...(append?.pokerRound ? [this.historyItem(room.code, append.pokerRound)] : []),
      ...(append?.pollResult ? [this.pollHistoryItem(room.code, append.pollResult)] : []),
    ].map((Item) => ({ Put: { TableName: this.tableName, Item } }));
    try {
      if (historyPuts.length > 0) {
        // A reveal or a finished poll: the room and its new history entry are
        // written together or not at all, so a retry after a conflict can't
        // leave a duplicate or orphaned entry behind.
        await this.client.send(
          new TransactWriteCommand({ TransactItems: [{ Put: putRoom }, ...historyPuts] })
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
      return roomFromItem(res.Attributes!);
    } catch (err) {
      if (errorName(err) === "ConditionalCheckFailedException") return undefined;
      throw err;
    }
  }

  async setPollVote(
    code: string,
    participantId: string,
    pollId: string,
    optionIds: string[]
  ): Promise<StoredRoom | undefined> {
    const now = Date.now();
    // Every condition setPollVote promises, as one expression DynamoDB checks
    // at write time: the right poll, still open, each id a real option, and
    // several ids only for a multiple-choice poll. Placeholders are built per
    // call because DynamoDB rejects any value that the expression doesn't use.
    const conditions = ["activeActivity = :poll", "poll.id = :pollId", "poll.closed = :false"];
    const values: Record<string, unknown> = {
      ":poll": "poll",
      ":pollId": pollId,
      ":false": false,
      ":one": 1,
      ":now": now,
      ":exp": this.expiresAt(now),
    };
    optionIds.forEach((id, i) => {
      conditions.push(`contains(poll.optionIds, :option${i})`);
      values[`:option${i}`] = id;
    });
    if (optionIds.length > 1) {
      conditions.push("poll.multiple = :true");
      values[":true"] = true;
    }
    const bookkeeping = "version = version + :one, lastActivityAt = :now, expiresAt = :exp";
    let update: string;
    if (optionIds.length === 0) {
      update = `REMOVE poll.votes.#participant SET ${bookkeeping}`;
    } else {
      update = `SET poll.votes.#participant = :choices, ${bookkeeping}`;
      values[":choices"] = optionIds;
    }
    try {
      const res = await retryTransactionConflict(() =>
        this.client.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: this.roomKey(code),
            UpdateExpression: update,
            ConditionExpression: conditions.join(" AND "),
            ExpressionAttributeNames: { "#participant": participantId },
            ExpressionAttributeValues: values,
            ReturnValues: "ALL_NEW",
          })
        )
      );
      return roomFromItem(res.Attributes!);
    } catch (err) {
      if (errorName(err) === "ConditionalCheckFailedException") return undefined;
      throw err;
    }
  }

  async addFeedback(code: string, item: FeedbackItem, maxSubmissions: number): Promise<StoredRoom | "full" | undefined> {
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
            // The cap is checked here, atomically with the bump, so a burst
            // of submissions can't overshoot it.
            ConditionExpression: "attribute_exists(pk) AND #feedback.submissionCount < :max",
            ExpressionAttributeNames: { "#feedback": "feedback" },
            ExpressionAttributeValues: { ":one": 1, ":max": maxSubmissions, ":now": now, ":exp": this.expiresAt(now) },
            ReturnValues: "ALL_NEW",
            // On failure, says whether the room exists — i.e. full vs. missing.
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          })
        )
      );
      return roomFromItem(res.Attributes!);
    } catch (err) {
      if (errorName(err) !== "ConditionalCheckFailedException") throw err;
      // Full, or no such room: take back the submission stored a moment ago.
      await this.client.send(
        new DeleteCommand({ TableName: this.tableName, Key: { pk: feedbackItem.pk, sk: feedbackItem.sk } })
      );
      return (err as { Item?: unknown }).Item ? "full" : undefined;
    }
  }

  async deleteFeedback(code: string, target: DeleteTarget): Promise<StoredRoom | undefined> {
    const upper = code.toUpperCase();
    const keys = await this.listKeys(upper, FEEDBACK_PREFIX);
    const deleted = await this.deleteKeys("all" in target ? keys : keys.filter((k) => k.id === target.id));
    if (deleted.length === 0) return undefined;
    const now = Date.now();
    try {
      const res = await retryTransactionConflict(() =>
        this.client.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: this.roomKey(upper),
            // A relative change for one, so a submission landing meanwhile
            // isn't lost from the count; all resets it (which also clears any
            // drift from submissions that expired via TTL).
            UpdateExpression:
              ("all" in target
                ? "SET #feedback.submissionCount = :zero, "
                : "SET #feedback.submissionCount = #feedback.submissionCount - :deleted, ") +
              "version = version + :one, lastActivityAt = :now, expiresAt = :exp",
            ConditionExpression: "attribute_exists(pk)",
            ExpressionAttributeNames: { "#feedback": "feedback" },
            ExpressionAttributeValues: {
              ...("all" in target ? { ":zero": 0 } : { ":deleted": deleted.length }),
              ":one": 1,
              ":now": now,
              ":exp": this.expiresAt(now),
            },
            ReturnValues: "ALL_NEW",
          })
        )
      );
      return roomFromItem(res.Attributes!);
    } catch (err) {
      if (errorName(err) !== "ConditionalCheckFailedException") throw err;
      return undefined;
    }
  }

  async deleteHistory(code: string, kind: HistoryKind, target: DeleteTarget): Promise<string[]> {
    const keys = await this.listKeys(code.toUpperCase(), HISTORY_PREFIXES[kind]);
    return this.deleteKeys("all" in target ? keys : keys.filter((k) => k.id === target.id));
  }

  async trimHistory(code: string, kind: HistoryKind, keep: number): Promise<void> {
    const keys = await this.listKeys(code.toUpperCase(), HISTORY_PREFIXES[kind]);
    await this.deleteKeys(keys.slice(keep));
  }

  /** The keys (and ids) of every item under one of the room's list prefixes, newest first. */
  private async listKeys(pk: string, prefix: string): Promise<ItemKey[]> {
    const keys: ItemKey[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": pk, ":prefix": prefix },
          ProjectionExpression: "pk, sk, id",
          ScanIndexForward: false,
          ExclusiveStartKey: startKey,
        })
      );
      keys.push(...((res.Items ?? []) as ItemKey[]));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return keys;
  }

  /**
   * Deletes these items, 25 at a time in parallel, each only if it still
   * exists — so when two admins delete the same entry at once, only one of
   * them counts it. Returns the ids actually deleted.
   */
  private async deleteKeys(keys: ItemKey[]): Promise<string[]> {
    const deleted: string[] = [];
    for (let i = 0; i < keys.length; i += 25) {
      await Promise.all(
        keys.slice(i, i + 25).map(async ({ pk, sk, id }) => {
          try {
            await this.client.send(
              new DeleteCommand({
                TableName: this.tableName,
                Key: { pk, sk },
                ConditionExpression: "attribute_exists(pk)",
              })
            );
            deleted.push(id);
          } catch (err) {
            if (errorName(err) !== "ConditionalCheckFailedException") throw err;
          }
        })
      );
    }
    return deleted;
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

  async listPollHistory(code: string, limit: number): Promise<PollHistoryEntry[]> {
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": code.toUpperCase(), ":prefix": POLL_PREFIX },
        ScanIndexForward: false, // newest first
        Limit: limit,
      })
    );
    return (res.Items ?? []).map((item) => withoutKeys<PollHistoryEntry>(item));
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
