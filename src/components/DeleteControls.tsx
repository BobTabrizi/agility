"use client";

import { useState } from "react";

/** The admin's small "×" on one entry in a list (a submission, a history entry). */
export function DeleteEntryButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      onClick={onDelete}
      aria-label={label}
      title={label}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
    >
      <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
      </svg>
    </button>
  );
}

/**
 * "Delete all" for an admin's list, confirmed inline (these lists live in
 * cards and dialogs, where a second dialog on top would be clumsy). `what`
 * names the entries, e.g. "12 submissions".
 */
export function DeleteAllButton({ what, onConfirm }: { what: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="shrink-0 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
      >
        Delete all
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-2 text-xs">
      <span className="text-neutral-600 dark:text-neutral-300">Delete all {what}? This can&apos;t be undone.</span>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
        className="rounded-md bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-500"
      >
        Delete all
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md border border-neutral-300 px-2 py-1 font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        Cancel
      </button>
    </span>
  );
}
