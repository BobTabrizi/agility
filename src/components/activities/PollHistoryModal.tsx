"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatRelativeTime } from "@/lib/time";
import type { PollHistoryEntry } from "@/lib/types";

/**
 * Like PokerHistoryModal: fetched when it opens, and again whenever another
 * poll is recorded while it's open (`latestRecordedAt` changes).
 */
export function PollHistoryModal({
  latestRecordedAt,
  onFetch,
  onClose,
}: {
  latestRecordedAt: number | null;
  onFetch: () => Promise<PollHistoryEntry[]>;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<PollHistoryEntry[] | null>(null);
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
  }, [onFetch, latestRecordedAt]);

  const title = history ? `Poll history (${history.length})` : "Poll history";

  return (
    <Modal title={title} onClose={onClose}>
      {!history ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {failed ? "Couldn't load poll history. Close this and try again." : "Loading…"}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {history.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{entry.question}</p>
                <span className="shrink-0 text-xs text-neutral-400">{formatRelativeTime(entry.recordedAt)}</span>
              </div>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {entry.voterCount} {entry.voterCount === 1 ? "voter" : "voters"} ·{" "}
                {entry.multiple ? "multiple choice" : "single choice"} · {entry.anonymous ? "anonymous" : "named"}
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {entry.results.map((result, i) => {
                  const percent = entry.voterCount > 0 ? Math.round((result.count / entry.voterCount) * 100) : 0;
                  return (
                    <li key={i} className="relative overflow-hidden rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs dark:border-neutral-800">
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 bg-indigo-100 dark:bg-indigo-950/70"
                        style={{ width: `${percent}%` }}
                      />
                      <span className="relative flex items-center justify-between gap-2">
                        <span className="min-w-0 break-words text-neutral-800 dark:text-neutral-100">{result.text}</span>
                        <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                          {result.count} · {percent}%
                        </span>
                      </span>
                      {result.voters && result.voters.length > 0 && (
                        <span className="relative mt-0.5 block text-neutral-500 dark:text-neutral-400">
                          {result.voters.join(", ")}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
