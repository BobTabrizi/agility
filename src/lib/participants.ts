import type { Participant } from "@/lib/types";

/** Names of participants currently connected to the room (not "Away"), in join order. */
export function activeParticipantNames(participants: Participant[]): string[] {
  return participants.filter((p) => p.connected).map((p) => p.name);
}
