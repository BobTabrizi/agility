"use client";

import { useEffect, useState } from "react";
import { DeleteAllButton, DeleteEntryButton } from "@/components/DeleteControls";
import { Modal } from "@/components/Modal";
import { formatRelativeTime } from "@/lib/time";
import type { DeleteTarget, PollHistoryEntry } from "@/lib/types";

/**
 * Like PokerHistoryModal: fetched when it opens, and again whenever another
 * poll is recorded while it's open (`latestRecordedAt` changes).
 */
export function PollHistoryModal({
  latestRecordedAt,
  count,
  isAdmin,
  onDelete,
  onFetch,
  onClose,
}: {
  latestRecordedAt: number | null;
  // The room's entry count: changes when an admin deletes, so this reloads then too.
  count: number;
  isAdmin: boolean;
  onDelete: (target: DeleteTarget) => void;
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
  }, [onFetch, latestRecordedAt, count]);

  // Removed from view straight away; the reload the count change triggers confirms it.
  function deleteEntries(target: DeleteTarget) {
    setHistory((h) => h && ("all" in target ? [] : h.filter((e) => e.id !== target.id)));
    onDelete(target);
  }
  const deleteAll = isAdmin && history && history.length > 0 && (
    <div className="mb-3 flex justify-end">
      <DeleteAllButton
        what={`${history.length} poll${history.length === 1 ? "" : "s"}`}
        onConfirm={() => deleteEntries({ all: true })}
      />
    </div>
  );

  const title = history ? `Poll history (${history.length})` : "Poll history";

  return (
    <Modal title={title} onClose={onClose}>
      {!history ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {failed ? "Couldn't load poll history. Close this and try again." : "Loading…"}
        </p>
      ) : (
        <>
        {deleteAll}
        <div className="flex flex-col gap-3">
          {history.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{entry.question}</p>
                <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-400">
                  {formatRelativeTime(entry.recordedAt)}
                  {isAdmin && <DeleteEntryButton label="Delete this poll" onDelete={() => deleteEntries({ id: entry.id })} />}
                </span>
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
        </>
      )}
    </Modal>
  );
}
