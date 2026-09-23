"use client";

/**
 * Drop-in for any admin-only names field (e.g. the Team Randomizer's name
 * list) that wants a one-click way to pull in whoever's currently connected
 * to the room, instead of typing names by hand. Deliberately a button, not
 * an auto-populate on join/leave: the admin may already be mid-edit, and
 * activities that reset on names-change (see the round-reset convention in
 * CLAUDE.md) would otherwise clear results every time someone's connection
 * blipped.
 */
export function UseRoomMembersButton({
  names,
  onUse,
}: {
  names: string[];
  onUse: (names: string[]) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onUse(names)}
      disabled={names.length === 0}
      className="self-start rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      title={names.length === 0 ? "No one else is connected to the room yet" : undefined}
    >
      Use current room members ({names.length})
    </button>
  );
}
