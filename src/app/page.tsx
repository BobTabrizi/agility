"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getLastUsedDisplayName, setSessionDisplayName, setStoredAdminToken } from "@/lib/storage";
import type { CreateRoomResponse } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [yourName, setYourName] = useState(() => getLastUsedDisplayName());
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!yourName.trim()) {
      setCreateError("Enter your name so your team knows who's running the room.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName }),
      });
      if (!res.ok) throw new Error("Failed to create room");
      const data: CreateRoomResponse = await res.json();
      setStoredAdminToken(data.code, data.adminToken);
      setSessionDisplayName(data.code, yourName.trim());
      router.push(`/room/${data.code}`);
    } catch {
      setCreateError("Something went wrong creating the room. Try again.");
      setCreating(false);
    }
  }

  function handleJoin(e: FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    router.push(`/room/${code}`);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white dark:from-neutral-950 dark:to-neutral-900">
      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Agility
        </h1>
        <p className="mt-3 text-center text-neutral-600 dark:text-neutral-400">
          Spin up a room for your team: estimate stories with planning poker, collect anonymous
          feedback, or let plinko pick for you.
        </p>

        <div className="mt-12 grid w-full gap-6 sm:grid-cols-2">
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                Create a room
              </h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                You&apos;ll be the room admin.
              </p>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Team / workspace name
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Platform Team"
                maxLength={60}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Your name
              <input
                value={yourName}
                onChange={(e) => setYourName(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder="e.g. Jamie"
                maxLength={40}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
              />
            </label>
            {createError && <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>}
            <button
              type="submit"
              disabled={creating}
              className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create room"}
            </button>
          </form>

          <form
            onSubmit={handleJoin}
            className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                Join a room
              </h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Got a code from a teammate? Drop it in.
              </p>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Room code
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB12CD"
                maxLength={6}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm uppercase tracking-widest outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
              />
            </label>
            <div className="flex-1" />
            <button
              type="submit"
              className="mt-2 rounded-lg border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
            >
              Join room
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
