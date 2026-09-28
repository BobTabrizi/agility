"use client";

import { useRef, useState, type ReactNode } from "react";
import { HistoryLink } from "@/components/HistoryLink";
import { PokerHistoryModal } from "@/components/activities/PokerHistoryModal";
import {
  MAX_POKER_TOPIC_LENGTH,
  type DeleteTarget,
  type Participant,
  type PokerHistoryEntry,
  type PokerHistorySummary,
  type PokerState,
} from "@/lib/types";
import { PokerVoteChart } from "@/components/activities/PokerVoteChart";

export function PlanningPoker({
  poker,
  participants,
  selfId,
  isAdmin,
  onVote,
  onReveal,
  onReset,
  onSetTopic,
  onSetAnonymous,
  optionsMenu,
  historySummary,
  onFetchHistory,
  onDeleteHistory,
}: {
  poker: PokerState;
  participants: Participant[];
  selfId: string;
  isAdmin: boolean;
  onVote: (value: string | null) => void;
  onReveal: () => void;
  onReset: () => void;
  onSetTopic: (topic: string) => void;
  onSetAnonymous: (anonymous: boolean) => void;
  // Admin-only poker settings ("⋮"), shown top-right of the card picker; null for participants.
  optionsMenu: ReactNode;
  historySummary: PokerHistorySummary;
  onFetchHistory: () => Promise<PokerHistoryEntry[]>;
  onDeleteHistory: (target: DeleteTarget) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [topicDraft, setTopicDraft] = useState(poker.topic);
  const [lastSeenTopic, setLastSeenTopic] = useState(poker.topic);
  if (poker.topic !== lastSeenTopic) {
    setLastSeenTopic(poker.topic);
    setTopicDraft(poker.topic);
  }
  const [justSavedTopic, setJustSavedTopic] = useState(false);
  const topicInputRef = useRef<HTMLInputElement>(null);
  const topicIsUnsaved = topicDraft.trim() !== poker.topic;

  const myVote = poker.votes[selfId] ?? null;
  const voteCount = Object.keys(poker.votes).length;

  const numericVotes = Object.values(poker.votes)
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n));
  const average =
    numericVotes.length > 0
      ? (numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length).toFixed(1)
      : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Topic: editable by admins, read-only for participants. */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        {isAdmin ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!topicIsUnsaved) return;
              onSetTopic(topicDraft.trim());
              setJustSavedTopic(true);
              setTimeout(() => setJustSavedTopic(false), 2000);
            }}
            className="flex items-center gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <input
                ref={topicInputRef}
                aria-label="Topic"
                aria-describedby="poker-topic-count"
                value={topicDraft}
                onChange={(e) => setTopicDraft(e.target.value)}
                placeholder="What are we estimating?"
                maxLength={MAX_POKER_TOPIC_LENGTH}
                className={`w-full rounded-lg border border-neutral-300 py-2 pl-3 ${topicDraft ? "pr-24" : "pr-16"} text-base sm:text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800`}
              />
              <div className="absolute inset-y-0 right-2 flex items-center gap-1">
                <span
                  id="poker-topic-count"
                  className={`pointer-events-none px-1 text-xs tabular-nums ${
                    topicDraft.length >= MAX_POKER_TOPIC_LENGTH ? "text-amber-600 dark:text-amber-400" : "text-neutral-400"
                  }`}
                >
                  {topicDraft.length} / {MAX_POKER_TOPIC_LENGTH}
                </span>
                {/* Clears the draft only; Update still saves it (as no topic). */}
                {topicDraft && (
                  <button
                    type="button"
                    onClick={() => {
                      setTopicDraft("");
                      topicInputRef.current?.focus();
                    }}
                    aria-label="Clear topic"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                  >
                    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            {!topicIsUnsaved && justSavedTopic && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved ✓</span>
            )}
            <button
              type="submit"
              disabled={!topicIsUnsaved}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 enabled:hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:enabled:hover:bg-neutral-800"
            >
              Update
            </button>
          </form>
        ) : (
          <p className="break-words text-lg text-neutral-900 dark:text-neutral-50">
            <span className="font-medium text-neutral-500 dark:text-neutral-400">Topic: </span>
            <span className={poker.topic ? "font-medium" : "text-neutral-400 dark:text-neutral-500"}>
              {poker.topic || "None"}
            </span>
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
              {voteCount} of {participants.length} voted
            </p>
            {poker.anonymous && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                Anonymous
              </span>
            )}
          </div>
          {isAdmin && (
            <label
              className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400"
              title="Toggling this resets the current round's votes"
            >
              Anonymous voting
              <button
                type="button"
                role="switch"
                aria-checked={poker.anonymous}
                onClick={() => onSetAnonymous(!poker.anonymous)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  poker.anonymous ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    poker.anonymous ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </label>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          {participants.map((p) => {
            const voted = Object.prototype.hasOwnProperty.call(poker.votes, p.id);
            const showValue = poker.revealed && !poker.anonymous;
            return (
              <div
                key={p.id}
                className="flex flex-col items-center gap-1 rounded-xl border border-neutral-200 px-3 py-2 dark:border-neutral-800"
              >
                <div
                  className={`flex min-h-10 min-w-8 items-center justify-center rounded-md px-2 py-1 text-center font-semibold leading-tight break-words ${
                    showValue
                      ? "max-w-28 text-xs bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                      : voted
                        ? "text-sm bg-indigo-600 text-white"
                        : "text-sm bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
                  }`}
                >
                  {showValue ? poker.votes[p.id] ?? "–" : voted ? "✓" : ""}
                </div>
                <span className="max-w-20 truncate text-xs text-neutral-600 dark:text-neutral-400">
                  {p.name}
                </span>
              </div>
            );
          })}
        </div>

        {(isAdmin || (poker.revealed && average !== null)) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            {poker.revealed && average !== null && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Average of numeric votes: <span className="font-semibold">{average}</span>
              </p>
            )}
            {isAdmin && (
              <div className="ml-auto flex gap-2">
                <button
                  onClick={onReveal}
                  disabled={poker.revealed || voteCount === 0}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white enabled:hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
                >
                  Reveal
                </button>
                <button
                  onClick={onReset}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  Reset
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {!poker.revealed && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Pick your card</p>
            {optionsMenu}
          </div>
          <div className="flex flex-wrap gap-2">
            {poker.deck.map((card) => {
              const selected = myVote === card;
              const isShort = card.length <= 3;
              return (
                <button
                  key={card}
                  onClick={() => onVote(selected ? null : card)}
                  className={`flex min-h-16 items-center justify-center rounded-xl border-2 px-3 py-2 text-center font-semibold leading-tight break-words transition ${
                    isShort ? "min-w-12 text-lg" : "max-w-32 text-sm"
                  } ${
                    selected
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-neutral-300 bg-white text-neutral-700 hover:border-indigo-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  }`}
                >
                  {card}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {poker.revealed && <PokerVoteChart votes={poker.votes} deck={poker.deck} />}

      <HistoryLink
        label="View past rounds"
        show={historySummary.count > 0}
        onOpen={() => setHistoryOpen(true)}
      />
      {historyOpen && (
        <PokerHistoryModal
          latestRevealedAt={historySummary.latestRevealedAt}
          count={historySummary.count}
          isAdmin={isAdmin}
          onDelete={onDeleteHistory}
          onFetch={onFetchHistory}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}
