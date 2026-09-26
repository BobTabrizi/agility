import type { Participant } from "@/lib/types";

/** Names of participants currently connected to the room (not "Away"), in join order. */
export function activeParticipantNames(participants: Participant[]): string[] {
  return participants.filter((p) => p.connected).map((p) => p.name);
}

// Past this, a name is cut short in the roster (with the full name in a tooltip).
export const MAX_DISPLAY_NAME_LENGTH = 30;

/** `name` cut to `max` characters with a trailing "…", or unchanged if it already fits. */
export function truncateName(name: string, max = MAX_DISPLAY_NAME_LENGTH): string {
  return name.length > max ? `${name.slice(0, max).trimEnd()}…` : name;
}
