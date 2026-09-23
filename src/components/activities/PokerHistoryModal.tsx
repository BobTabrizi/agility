"use client";

import { Modal } from "@/components/Modal";
import { formatRelativeTime } from "@/lib/time";
import type { PokerHistoryEntry } from "@/lib/types";

export function PokerHistoryModal({
  history,
  onClose,
}: {
  history: PokerHistoryEntry[];
  onClose: () => void;
}) {
  return (
    <Modal title={`Poker history (${history.length})`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {history.map((entry) => (
          <div
            key={entry.id}
            className="rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-neutral-800"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
                {entry.topic || "Untitled round"}
              </p>
              <span className="shrink-0 text-xs text-neutral-400">
                {formatRelativeTime(entry.revealedAt)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.votes.map((v, i) => (
                <span
                  key={i}
                  className="rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  {v.name ? `${v.name}: ${v.value}` : v.value}
                </span>
              ))}
            </div>
            {entry.average !== null && (
              <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                Average: <span className="font-semibold">{entry.average.toFixed(1)}</span>
              </p>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
