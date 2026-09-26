"use client";

import { useEffect } from "react";

const AUTO_DISMISS_MS = 5000;

/**
 * A transient notice for an action the server rejected. Remount it (via
 * `key`) for each new error so the auto-dismiss timer restarts.
 */
export function ErrorNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded-md p-0.5 text-red-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900 dark:hover:text-red-100"
      >
        ✕
      </button>
    </div>
  );
}
