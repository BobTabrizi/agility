export type ActivityType = "poker" | "feedback" | "plinko";

export const ACTIVITIES: { id: ActivityType; label: string }[] = [
  { id: "poker", label: "Planning Poker" },
  { id: "feedback", label: "Feedback Box" },
  { id: "plinko", label: "Plinko" },
];

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

export interface RoomState {
  code: string;
  name: string;
  createdAt: number;
  activeActivity: ActivityType;
  participants: Participant[];
  poker: PokerState;
  feedback: FeedbackState;
  plinko: PlinkoState;
}

/** Feedback as seen by a given socket: items are stripped for non-admins. */
export interface PublicFeedbackState {
  submissionCount: number;
  items: FeedbackItem[] | null;
}

/** What is sent to a given socket: feedback items are stripped for non-admins. */
export type PublicRoomState = Omit<RoomState, "feedback"> & {
  feedback: PublicFeedbackState;
};

export interface CreateRoomResponse {
  code: string;
  adminToken: string;
}

export interface JoinAck {
  ok: boolean;
  error?: string;
  participantId?: string;
  isAdmin?: boolean;
}
