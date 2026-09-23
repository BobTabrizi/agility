"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { MAX_POKER_CARD_LENGTH, POKER_PRESET_DECKS } from "@/lib/types";

export function PokerDeckModal({
  deck,
  onSetDeck,
  onClose,
}: {
  deck: string[];
  onSetDeck: (deck: string[]) => void;
  onClose: () => void;
}) {
  const [deckDraft, setDeckDraft] = useState(deck.join(", "));
  const parsedDeckDraft = deckDraft
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const deckIsUnsaved = parsedDeckDraft.join(", ") !== deck.join(", ");

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

  function saveDeck(next: string[]) {
    if (next.length === 0) return;
    onSetDeck(next);
    onClose();
  }

  return (
    <Modal title="Customize card deck" onClose={onClose}>
      <div className="flex flex-col gap-4">
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
            if (!deckIsUnsaved) return;
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
    </Modal>
  );
}
