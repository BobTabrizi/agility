"use client";

import { useEffect, useRef, useState } from "react";
import type { Participant } from "@/lib/types";

export function RoomHeader({
  name,
  code,
  participants,
  isAdmin,
}: {
  name: string;
  code: string;
  participants: Participant[];
  isAdmin: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const rosterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rosterOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (!rosterRef.current?.contains(e.target as Node)) {
        setRosterOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setRosterOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [rosterOpen]);

  async function copyLink() {
    const url = `${window.location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  const connectedParticipants = participants.filter((p) => p.connected);

  return (
    <div className="flex flex-col gap-4 border-b border-neutral-200 pb-4 dark:border-neutral-800 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{name}</h1>
          {isAdmin && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              Admin
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
          Room code <span className="font-mono font-semibold tracking-wide">{code}</span> ·{" "}
          {connectedParticipants.length === participants.length
            ? `${connectedParticipants.length} here`
            : `${connectedParticipants.length} of ${participants.length} here`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div ref={rosterRef} className="relative">
          <button
            type="button"
            onClick={() => setRosterOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={rosterOpen}
            className="flex -space-x-2 rounded-full transition hover:opacity-80"
          >
            {connectedParticipants.slice(0, 6).map((p) => (
              <div
                key={p.id}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-indigo-500 text-xs font-semibold text-white dark:border-neutral-900"
              >
                {p.name.slice(0, 2).toUpperCase()}
              </div>
            ))}
            {connectedParticipants.length > 6 && (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-neutral-400 text-xs font-semibold text-white dark:border-neutral-900">
                +{connectedParticipants.length - 6}
              </div>
            )}
          </button>

          {rosterOpen && (
            <div className="absolute right-0 top-full z-10 mt-2 w-56 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
              <p className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {participants.length} joined this room
              </p>
              <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                {participants.map((p) => (
                  <li
                    key={p.id}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                      p.connected ? "" : "opacity-50"
                    }`}
                  >
                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${
                        p.connected ? "bg-indigo-500" : "bg-neutral-400 dark:bg-neutral-600"
                      }`}
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="truncate text-neutral-800 dark:text-neutral-100">
                      {p.name}
                    </span>
                    {!p.connected && (
                      <span className="shrink-0 text-xs text-neutral-400">Away</span>
                    )}
                    {p.isAdmin && (
                      <span className="ml-auto shrink-0 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        Admin
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <button
          onClick={copyLink}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {copied ? "Copied!" : "Copy invite link"}
        </button>
      </div>
    </div>
  );
}
