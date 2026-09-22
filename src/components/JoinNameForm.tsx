"use client";

import { useState, type FormEvent } from "react";
import { getLastUsedDisplayName } from "@/lib/storage";

export function JoinNameForm({
  code,
  onJoin,
}: {
  code: string;
  onJoin: (name: string) => void;
}) {
  const [name, setName] = useState(() => getLastUsedDisplayName());
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name so your team can see who's here.");
      return;
    }
    onJoin(trimmed);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6 dark:bg-neutral-950">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            Room {code}
          </p>
          <h1 className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            What should we call you?
          </h1>
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          placeholder="Your name"
          maxLength={40}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          Join room
        </button>
      </form>
    </div>
  );
}
