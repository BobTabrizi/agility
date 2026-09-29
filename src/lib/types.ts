export type ActivityType = "poker" | "feedback" | "plinko" | "teams" | "poll" | "wheel";

// In the order the activity dropdown lists them.
export const ACTIVITIES: { id: ActivityType; label: string }[] = [
  { id: "poker", label: "Planning Poker" },
  { id: "poll", label: "Poll" },
  { id: "wheel", label: "Wheel" },
  { id: "plinko", label: "Plinko" },
  { id: "teams", label: "Team Randomizer" },
  { id: "feedback", label: "Anonymous Box" },
];

// Past this many, bins get too narrow to label (especially on a phone).
export const MAX_PLINKO_OPTIONS = 12;
export const MAX_PLINKO_OPTION_LENGTH = 60;

/** Drop speeds an admin can pick, as a multiplier on the animation's durations. */
export const PLINKO_SPEEDS = { slow: 1.6, normal: 1, fast: 0.6 } as const;
export type PlinkoSpeed = keyof typeof PLINKO_SPEEDS;

export const MAX_WHEEL_OPTIONS = 30;
export const MAX_WHEEL_OPTION_LENGTH = 60;
/** How long a spin's animation lasts, in every client. */
export const WHEEL_SPIN_DURATION_MS = 6000;

export const MAX_POLL_QUESTION_LENGTH = 200;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_POLL_OPTION_LENGTH = 100;
/** The newest this many finished polls are what the poll history dialog shows. */
export const MAX_POLL_HISTORY = 50;

// Enforced by POST /api/rooms as well as the create form's maxLength — the
// form alone doesn't stop a direct API call.
export const MAX_ROOM_NAME_LENGTH = 60;

// A name longer than this doesn't display well in the team-name editor or
// the resulting team chips.
export const MAX_TEAM_NAME_LENGTH = 60;

export const MAX_TEAM_COUNT = 30;

const SIMPLE_POKER_DECK = ["1", "2", "3", "5", "8", "13", "?"];
const FIBONACCI_POKER_DECK = ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "?", "☕"];

/** The deck a new room starts with (the first preset in the deck editor). */
export const DEFAULT_POKER_DECK = SIMPLE_POKER_DECK;

// Cards longer than this don't display well in the card grid, so the deck
// editor caps input at this length and the server enforces it too.
export const MAX_POKER_CARD_LENGTH = 40;

// In the order the deck editor shows them; the default comes first.
export const POKER_PRESET_DECKS: { label: string; deck: string[] }[] = [
  { label: "Simple", deck: SIMPLE_POKER_DECK },
  { label: "Fibonacci", deck: FIBONACCI_POKER_DECK },
  { label: "T-shirt sizes", deck: ["XS", "S", "M", "L", "XL", "XXL", "?"] },
  { label: "Powers of 2", deck: ["0", "1", "2", "4", "8", "16", "32", "?"] },
  { label: "Yes / No", deck: ["Yes", "No"] },
];

export interface Participant {
  id: string;
  name: string;
  isAdmin: boolean;
  joinedAt: number;
  connected: boolean;
}

export interface PokerState {
  topic: string;
  votes: Record<string, string>; // participantId -> card value
  revealed: boolean;
  deck: string[];
  anonymous: boolean;
}

export interface PokerHistoryEntry {
  id: string;
  topic: string;
  revealedAt: number;
  anonymous: boolean;
  // name is null for entries revealed under anonymous voting — recorded that
  // way at reveal time, not just hidden client-side, so an anonymous round
  // stays anonymous in history even after the toggle is later switched off.
  votes: { name: string | null; value: string }[];
  average: number | null;
}

export interface FeedbackItem {
  id: string;
  text: string;
  createdAt: number;
}

// Poker history and feedback items are stored as their own items next to the
// room (see DynamoRoomStore), not inside it — the room only carries counts.
// Both lists are fetched on demand: history by anyone opening the history
// dialog (`poker:getHistory`), feedback items by admins viewing the Feedback
// Box (`feedback:getItems`).

/**
 * Longest feedback submission, in characters — enforced by the server
 * (`feedback:submit`) as well as the text box. Keeps each stored submission
 * (and the write that stores it) small.
 */
export const MAX_FEEDBACK_LENGTH = 2000;

/**
 * Most submissions a room's Anonymous Box holds — enforced atomically by the
 * store (addFeedback). Bounds storage and what an admin's list has to load;
 * admins can delete submissions to make room.
 */
export const MAX_FEEDBACK_SUBMISSIONS = 500;

/**
 * Most people on a room's roster. When it's full, a new person joining
 * replaces the longest-gone Away (non-admin) entry; only a room with no such
 * entry turns them away. Keeps the room item — which holds the roster — far
 * from DynamoDB's 400 KB item limit.
 */
export const MAX_ROOM_PARTICIPANTS = 100;

/**
 * Longest planning poker topic, in characters — enforced by the server
 * (`poker:setTopic`) as well as the topic box, which shows the count. Kept
 * short so a topic reads as a one-line label.
 */
export const MAX_POKER_TOPIC_LENGTH = 60;

/** The newest this many rounds are what the history dialog shows. */
export const MAX_POKER_HISTORY = 50;

export interface PokerHistorySummary {
  // Rounds in history: capped at MAX_POKER_HISTORY (older ones are trimmed), lowered when an admin deletes.
  count: number;
  // Changes on every reveal, so an open history dialog knows to reload.
  latestRevealedAt: number | null;
}

export interface FeedbackState {
  // Changes on every submission, so an admin's open list knows to reload.
  submissionCount: number;
}

export interface TeamsState {
  names: string[];
  teamCount: number;
  teams: string[][];
}

export interface PollOption {
  id: string;
  text: string;
}

/** A poll as stored on the room. Never sent to clients as-is — see PublicPollState. */
export interface PollState {
  // null until an admin starts the first poll. A new poll gets a new id, which
  // is how a vote cast for a poll that's since been replaced gets rejected.
  id: string | null;
  createdAt: number | null;
  // When this poll's results were last saved to poll history (on close, or
  // when a new poll replaced it) — null if never. Lets a reopened-and-reclosed
  // poll update its history entry instead of counting as a second poll.
  recordedAt: number | null;
  question: string;
  options: PollOption[];
  // The option ids again as a plain list, so a vote's "is this a real option?"
  // check can be a DynamoDB condition (contains() works on lists of strings,
  // not on a list of objects).
  optionIds: string[];
  multiple: boolean;
  anonymous: boolean;
  closed: boolean;
  votes: Record<string, string[]>; // participantId -> chosen option ids
}

/**
 * A poll as one viewer sees it, built per socket in toPublicState(): results
 * are only included once that viewer may see them (admins always; others once
 * they've voted, or when the poll is closed), and voter names only for
 * non-anonymous polls. Enforced server-side — a participant who hasn't voted
 * receives no results at all, not just hidden ones.
 */
export interface PublicPollState {
  id: string | null;
  question: string;
  options: PollOption[];
  multiple: boolean;
  anonymous: boolean;
  closed: boolean;
  voterCount: number;
  myVote: string[];
  results: { optionId: string; count: number; voters: string[] | null }[] | null;
}

/**
 * A finished poll as kept in poll history (stored beside the room, like poker
 * rounds). Names are resolved when it's recorded, and are null throughout for
 * an anonymous poll — so it stays anonymous in history.
 */
export interface PollHistoryEntry {
  id: string; // the poll's id — re-recording the same poll replaces its entry
  question: string;
  createdAt: number;
  recordedAt: number;
  multiple: boolean;
  anonymous: boolean;
  voterCount: number;
  results: { text: string; count: number; voters: string[] | null }[];
}

export interface PollHistorySummary {
  count: number;
  // Changes whenever a poll is recorded, so an open history dialog knows to reload.
  latestRecordedAt: number | null;
}

/**
 * A spinning wheel. The server decides everything about a spin — the winner
 * and how the wheel gets there — so every client animates the exact same
 * spin and lands on the same slice.
 */
export interface WheelState {
  options: string[];
  spin: {
    id: string; // new per spin: what tells clients to animate
    winnerIndex: number;
    turns: number; // whole extra rotations before stopping (drama)
    offset: number; // where within the winning slice it stops, 0–1 (so it isn't always dead center)
  } | null; // null until spun, and again whenever the options change
}

/**
 * Plinko, "movie physics": the server picks the winner uniformly (fair to
 * every option), then a random bounce path into its slot (src/lib/
 * plinkoPath.ts), so every client animates the identical drop.
 */
export interface PlinkoState {
  options: string[];
  // A room setting (not per person) so everyone watches the drop at the same pace.
  speed: PlinkoSpeed;
  drop: {
    id: string; // new per drop: what tells clients to animate
    winnerIndex: number;
    path: number[]; // one -1/+1 per peg row
    // The speed at the moment of the drop — changing the setting afterwards
    // doesn't alter a drop already in flight, so clients can't fall out of step.
    speed: PlinkoSpeed;
  } | null; // null until dropped, and again whenever the options change
}

export interface RoomState {
  code: string;
  name: string;
  createdAt: number;
  activeActivity: ActivityType;
  participants: Participant[];
  poker: PokerState;
  pokerHistorySummary: PokerHistorySummary;
  feedback: FeedbackState;
  plinko: PlinkoState;
  teams: TeamsState;
  poll: PollState;
  pollHistorySummary: PollHistorySummary;
  wheel: WheelState;
}

/** What is sent to a given socket on every change. */
export type PublicRoomState = Omit<RoomState, "poll"> & {
  poll: PublicPollState;
  // Whether the socket receiving this state is an admin right now. Pushed
  // with every broadcast (not just the join ack) so being appointed or
  // removed as admin takes effect without a rejoin.
  viewerIsAdmin: boolean;
  // Participants made admin by another admin, as opposed to the room creator
  // (who is also isAdmin but can't be removed). Their tokens stay server-side.
  appointedAdminIds: string[];
  // The room's write counter. Only ever increases, so a client can ignore a
  // snapshot older than one it already has (broadcasts from concurrent writes
  // can arrive out of order).
  version: number;
};

/** Reply to `poker:getHistory` — newest first, at most MAX_POKER_HISTORY. */
export type PokerHistoryResponse = { ok: true; entries: PokerHistoryEntry[] } | { ok: false; error: string };

/** Reply to `poll:getHistory` — newest first, at most MAX_POLL_HISTORY. */
export type PollHistoryResponse = { ok: true; entries: PollHistoryEntry[] } | { ok: false; error: string };

/** What an admin deletes from a list (Anonymous Box, poker/poll history): one entry by id, or all. */
export type DeleteTarget = { id: string } | { all: true };

/** Reply to `participant:leave`: ok once you're off the roster. */
export type LeaveResponse = { ok: true } | { ok: false; error: string };

/** Reply to `feedback:submit`: only confirms once the submission is stored. */
export type FeedbackSubmitResponse = { ok: true } | { ok: false; error: string };

/** Reply to `feedback:getItems` (admins only) — newest first. */
export type FeedbackItemsResponse = { ok: true; items: FeedbackItem[] } | { ok: false; error: string };

export interface CreateRoomResponse {
  code: string;
  adminToken: string;
}

export interface JoinAck {
  ok: boolean;
  error?: string;
  participantId?: string;
}
