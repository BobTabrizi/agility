"use client";

import { useEffect, useRef, useState } from "react";
import { PokerDeckModal } from "@/components/activities/PokerDeckModal";
import { PokerHistoryModal } from "@/components/activities/PokerHistoryModal";
import type { PokerHistoryEntry } from "@/lib/types";

export function PokerOptionsMenu({
  historySummary,
  onFetchHistory,
  deck,
  isAdmin,
  onSetDeck,
}: {
  historySummary: { count: number; latestRevealedAt: number | null };
  onFetchHistory: () => Promise<PokerHistoryEntry[]>;
  deck: string[];
  isAdmin: boolean;
  onSetDeck: (deck: string[]) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openModal, setOpenModal] = useState<"history" | "deck" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Poker options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
      >
        <span aria-hidden className="text-lg leading-none">
          ⋮
        </span>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          <button
            type="button"
            role="menuitem"
            disabled={historySummary.count === 0}
            onClick={() => {
              setOpenModal("history");
              setMenuOpen(false);
            }}
            className="block w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Poker history{historySummary.count > 0 ? ` (${historySummary.count})` : ""}
          </button>
          {isAdmin && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenModal("deck");
                setMenuOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Customize deck
            </button>
          )}
        </div>
      )}

      {openModal === "history" && (
        <PokerHistoryModal
          latestRevealedAt={historySummary.latestRevealedAt}
          onFetch={onFetchHistory}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === "deck" && (
        <PokerDeckModal deck={deck} onSetDeck={onSetDeck} onClose={() => setOpenModal(null)} />
      )}
    </div>
  );
}
