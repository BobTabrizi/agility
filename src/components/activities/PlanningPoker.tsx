"use client";

import { useState } from "react";
import { MAX_POKER_CARD_LENGTH, POKER_PRESET_DECKS } from "@/lib/types";
import type { Participant, PokerState } from "@/lib/types";
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
  onSetDeck,
  onSetAnonymous,
}: {
  poker: PokerState;
  participants: Participant[];
  selfId: string;
  isAdmin: boolean;
  onVote: (value: string | null) => void;
  onReveal: () => void;
  onReset: () => void;
  onSetTopic: (topic: string) => void;
  onSetDeck: (deck: string[]) => void;
  onSetAnonymous: (anonymous: boolean) => void;
}) {
  const [topicDraft, setTopicDraft] = useState(poker.topic);
  const [lastSeenTopic, setLastSeenTopic] = useState(poker.topic);
  if (poker.topic !== lastSeenTopic) {
    setLastSeenTopic(poker.topic);
    setTopicDraft(poker.topic);
  }
  const [justSavedTopic, setJustSavedTopic] = useState(false);
  const topicIsUnsaved = topicDraft.trim() !== poker.topic;

  const deckText = poker.deck.join(", ");
  const [deckDraft, setDeckDraft] = useState(deckText);
  const [lastSeenDeckText, setLastSeenDeckText] = useState(deckText);
  if (deckText !== lastSeenDeckText) {
    setLastSeenDeckText(deckText);
    setDeckDraft(deckText);
  }
  const [deckExpanded, setDeckExpanded] = useState(false);
  const parsedDeckDraft = deckDraft
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const deckIsUnsaved = parsedDeckDraft.join(", ") !== poker.deck.join(", ");

  // The card currently being typed is whatever's after the last comma —
  // that's the one worth showing a live counter for.
  const deckDraftCards = deckDraft.split(",");
  const activeCardLength = deckDraftCards[deckDraftCards.length - 1].trim().length;

  function handleDeckDraftChange(value: string) {
    // Cap each card as it's typed (rather than only on save) so admins get
    // immediate feedback instead of a silent server-side truncation later.
    const capped = value
      .split(",")
      .map((card) => card.slice(0, MAX_POKER_CARD_LENGTH))
      .join(",");
    setDeckDraft(capped);
  }

  function saveDeck(deck: string[]) {
    if (deck.length === 0) return;
    onSetDeck(deck);
  }

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
            <input
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              placeholder="What are we estimating? (shown to everyone in the room)"
              maxLength={200}
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
            {!topicIsUnsaved && justSavedTopic && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved ✓</span>
            )}
            <button
              type="submit"
              disabled={!topicIsUnsaved}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Update
            </button>
          </form>
        ) : (
          <p className="text-lg font-medium text-neutral-900 dark:text-neutral-50">
            {poker.topic || "Waiting for the admin to set a topic…"}
          </p>
        )}
      </div>

      {!poker.revealed && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="mb-3 text-sm font-medium text-neutral-500 dark:text-neutral-400">
            Pick your card
          </p>
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

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
          <div className="flex items-center gap-3">
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
            {isAdmin && (
              <div className="flex gap-2">
                <button
                  onClick={onReveal}
                  disabled={poker.revealed || voteCount === 0}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
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

        {poker.revealed && average !== null && (
          <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
            Average of numeric votes: <span className="font-semibold">{average}</span>
          </p>
        )}
      </div>

      {poker.revealed && <PokerVoteChart votes={poker.votes} deck={poker.deck} />}

      {isAdmin && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <button
            type="button"
            onClick={() => setDeckExpanded((v) => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-medium text-neutral-500 dark:text-neutral-400"
          >
            Customize card deck
            <span className="text-xs text-neutral-400">{deckExpanded ? "Hide" : "Show"}</span>
          </button>

          {deckExpanded && (
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {POKER_PRESET_DECKS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => saveDeck(preset.deck)}
                    className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveDeck(parsedDeckDraft);
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={deckDraft}
                  onChange={(e) => handleDeckDraftChange(e.target.value)}
                  placeholder="0, 1, 2, 3, 5, 8, 13, ?, Continue retrospective, Leave retrospective"
                  className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
                />
                <span
                  className={`shrink-0 text-xs tabular-nums ${
                    activeCardLength >= MAX_POKER_CARD_LENGTH
                      ? "text-red-500"
                      : "text-neutral-400 dark:text-neutral-500"
                  }`}
                >
                  {activeCardLength}/{MAX_POKER_CARD_LENGTH}
                </span>
                <button
                  type="submit"
                  disabled={!deckIsUnsaved || parsedDeckDraft.length === 0}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  Save deck
                </button>
              </form>
              <p className="text-xs text-neutral-400">
                Comma-separated card values — numbers, sizes, or short phrases, up to {MAX_POKER_CARD_LENGTH}{" "}
                characters each — shown to everyone in the room. Saving resets any votes in progress.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
