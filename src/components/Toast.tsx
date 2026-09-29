"use client";

import { useEffect } from "react";

const AUTO_DISMISS_MS = 2500;

/**
 * A brief confirmation pop-up ("Invite link copied to clipboard"), the
 * success counterpart of ErrorNotice. Sits above dialogs (z-[60] vs. the
 * Modal's z-50). Remount it (via `key`) to show it again and restart its timer.
 */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 shadow-lg dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
    >
      <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z"
          clipRule="evenodd"
        />
      </svg>
      {message}
    </div>
  );
}
