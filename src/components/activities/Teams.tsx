"use client";

import { useState, type FormEvent } from "react";
import { UseRoomMembersButton } from "@/components/UseRoomMembersButton";
import { MAX_TEAM_COUNT, MAX_TEAM_NAME_LENGTH } from "@/lib/types";
import type { TeamsState } from "@/lib/types";

export function Teams({
  teams,
  isAdmin,
  activeMemberNames,
  onGenerate,
}: {
  teams: TeamsState;
  isAdmin: boolean;
  activeMemberNames: string[];
  onGenerate: (names: string[], count: number) => void;
}) {
  const namesText = teams.names.join("\n");
  const [namesDraft, setNamesDraft] = useState(namesText);
  const [lastSeenNamesText, setLastSeenNamesText] = useState(namesText);
  if (namesText !== lastSeenNamesText) {
    setLastSeenNamesText(namesText);
    setNamesDraft(namesText);
  }

  const [countDraft, setCountDraft] = useState(String(teams.teamCount));
  const [lastSeenCount, setLastSeenCount] = useState(teams.teamCount);
  if (teams.teamCount !== lastSeenCount) {
    setLastSeenCount(teams.teamCount);
    setCountDraft(String(teams.teamCount));
  }

  const parsedNames = namesDraft
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);

  function handleGenerate(e: FormEvent) {
    e.preventDefault();
    if (parsedNames.length === 0) return;
    const count = Math.min(Math.max(Math.round(Number(countDraft)) || 1, 1), MAX_TEAM_COUNT);
    onGenerate(parsedNames, count);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="mb-3 text-sm font-medium text-neutral-500 dark:text-neutral-400">Names</p>
        {teams.names.length === 0 ? (
          <p className="text-center text-sm text-neutral-400">
            {isAdmin
              ? "Add some names below to get started."
              : "Waiting for the admin to add names…"}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {teams.names.map((n, i) => (
              <span
                key={`${n}-${i}`}
                className="rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              >
                {n}
              </span>
            ))}
          </div>
        )}
      </div>

      {teams.teams.length > 0 && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="mb-3 text-sm font-medium text-neutral-500 dark:text-neutral-400">Teams</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.teams.map((team, i) => (
              <div
                key={i}
                className="rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-neutral-800"
              >
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                  Team {i + 1}
                </p>
                {team.length === 0 ? (
                  <p className="text-sm text-neutral-400">No one assigned</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {team.map((n, j) => (
                      <li key={`${n}-${j}`} className="text-sm text-neutral-700 dark:text-neutral-200">
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <form
          onSubmit={handleGenerate}
          className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Names (one per line)
            <textarea
              value={namesDraft}
              onChange={(e) =>
                setNamesDraft(
                  e.target.value
                    .split("\n")
                    .map((line) => line.slice(0, MAX_TEAM_NAME_LENGTH))
                    .join("\n")
                )
              }
              rows={6}
              placeholder={"Alice\nBob\nCarla\nDan"}
              className="resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>
          <UseRoomMembersButton names={activeMemberNames} onUse={(names) => setNamesDraft(names.join("\n"))} />
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Number of teams
            <input
              type="number"
              min={1}
              max={MAX_TEAM_COUNT}
              value={countDraft}
              onChange={(e) => setCountDraft(e.target.value)}
              className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>
          <button
            type="submit"
            disabled={parsedNames.length === 0}
            className="self-end rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Generate teams
          </button>
        </form>
      )}
    </div>
  );
}
