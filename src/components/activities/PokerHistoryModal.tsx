"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatRelativeTime } from "@/lib/time";
import type { PokerHistoryEntry } from "@/lib/types";

/**
 * History isn't part of the pushed room state — it's fetched when this opens,
 * and again whenever a new round is revealed while it's open
 * (`latestRevealedAt` changes). A reload keeps showing the previous list
 * until the new one arrives, rather than flashing back to "Loading…".
 */
export function PokerHistoryModal({
  latestRevealedAt,
  onFetch,
  onClose,
}: {
  latestRevealedAt: number | null;
  onFetch: () => Promise<PokerHistoryEntry[]>;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<PokerHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    onFetch().then(
      (entries) => {
        if (cancelled) return;
        setHistory(entries);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [onFetch, latestRevealedAt]);

  const title = history ? `Poker history (${history.length})` : "Poker history";

  if (!history) {
    return (
      <Modal title={title} onClose={onClose}>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {failed ? "Couldn't load poker history. Close this and try again." : "Loading…"}
        </p>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose}>
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
