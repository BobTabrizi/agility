export type ActivityType = "poker" | "feedback" | "plinko" | "teams";

export const ACTIVITIES: { id: ActivityType; label: string }[] = [
  { id: "poker", label: "Planning Poker" },
  { id: "feedback", label: "Feedback Box" },
  { id: "plinko", label: "Plinko" },
  { id: "teams", label: "Team Randomizer" },
];

// Enforced by POST /api/rooms as well as the create form's maxLength — the
// form alone doesn't stop a direct API call.
export const MAX_ROOM_NAME_LENGTH = 60;

// A name longer than this doesn't display well in the team-name editor or
// the resulting team chips.
export const MAX_TEAM_NAME_LENGTH = 60;

export const MAX_TEAM_COUNT = 30;

export const DEFAULT_POKER_DECK = ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "?", "☕"];

// Cards longer than this don't display well in the card grid, so the deck
// editor caps input at this length and the server enforces it too.
export const MAX_POKER_CARD_LENGTH = 40;

export const POKER_PRESET_DECKS: { label: string; deck: string[] }[] = [
  { label: "Fibonacci", deck: DEFAULT_POKER_DECK },
  { label: "T-shirt sizes", deck: ["XS", "S", "M", "L", "XL", "XXL", "?"] },
  { label: "Powers of 2", deck: ["0", "1", "2", "4", "8", "16", "32", "?"] },
  { label: "Simple", deck: ["1", "2", "3", "5", "8", "13", "?"] },
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

export interface FeedbackState {
  items: FeedbackItem[];
  submissionCount: number;
}

export interface PlinkoState {
  options: string[];
  isRunning: boolean;
  winner: string | null;
  seed: number | null;
}

export interface TeamsState {
  names: string[];
  teamCount: number;
  teams: string[][];
}

export interface RoomState {
  code: string;
  name: string;
  createdAt: number;
  activeActivity: ActivityType;
  participants: Participant[];
  poker: PokerState;
  pokerHistory: PokerHistoryEntry[];
  feedback: FeedbackState;
  plinko: PlinkoState;
  teams: TeamsState;
}

/** Feedback as seen by a given socket: items are stripped for non-admins. */
export interface PublicFeedbackState {
  submissionCount: number;
  items: FeedbackItem[] | null;
}

/**
 * What is sent to a given socket on every change: feedback items are stripped
 * for non-admins, and poker history isn't included — only a summary of it.
 * The history itself is the bulk of the room at its 50-round cap and is only
 * sent to someone who asks for it (opening the history dialog, via
 * `poker:getHistory`).
 */
export type PublicRoomState = Omit<RoomState, "feedback" | "pokerHistory"> & {
  feedback: PublicFeedbackState;
  // Enough to show "Poker history (N)" without the history itself.
  // latestRevealedAt changes on every reveal (even once count is at the cap),
  // so an open history dialog knows to reload.
  pokerHistorySummary: { count: number; latestRevealedAt: number | null };
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

/** Reply to `poker:getHistory`. */
export type PokerHistoryResponse = { ok: true; entries: PokerHistoryEntry[] } | { ok: false; error: string };

export interface CreateRoomResponse {
  code: string;
  adminToken: string;
}

export interface JoinAck {
  ok: boolean;
  error?: string;
  participantId?: string;
}
