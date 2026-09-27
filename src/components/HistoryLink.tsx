"use client";

/**
 * "View past rounds"-style link shown under an activity's card, opening that
 * activity's history. Renders nothing until there's history to show.
 *
 * Deliberately no count in the label: the room's history counter only ever
 * goes up, while stored entries expire after 60 days, so a number could
 * overstate what's actually there. The dialog's title shows the real count
 * of what it loaded.
 */
export function HistoryLink({ label, show, onOpen }: { label: string; show: boolean; onOpen: () => void }) {
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="self-start text-sm font-medium text-indigo-600 hover:text-indigo-500 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300"
    >
      {label}
    </button>
  );
}
