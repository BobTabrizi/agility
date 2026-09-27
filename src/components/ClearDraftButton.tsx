"use client";

/**
 * One-click "empty this list" for an admin's options/names box (Wheel,
 * Plinko, Team Randomizer), sitting beside UseRoomMembersButton. It only
 * clears the draft — nothing is saved until the admin saves as usual.
 */
export function ClearDraftButton({ disabled, onClear }: { disabled: boolean; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      disabled={disabled}
      className="self-start rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 enabled:hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:enabled:hover:bg-neutral-800"
    >
      Clear
    </button>
  );
}
