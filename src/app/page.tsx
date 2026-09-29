"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getLastUsedDisplayName, setSessionDisplayName, setStoredAdminToken } from "@/lib/storage";
import { MAX_ROOM_NAME_LENGTH, type CreateRoomResponse } from "@/lib/types";

const ROOM_CODE_LENGTH = 6;

/**
 * What someone typed or pasted into the join box, as a room code: an invite
 * link (".../room/AB12CD") works too, and anything that isn't a letter or
 * digit is dropped.
 */
function parseRoomCode(input: string): string {
  const fromLink = input.match(/\/room\/([A-Za-z0-9]+)/)?.[1];
  return (fromLink ?? input)
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, ROOM_CODE_LENGTH);
}

const inputClass =
  "h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-base text-neutral-900 shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 sm:text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:placeholder:text-neutral-500";

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
      document.getElementById("your-name")?.focus();
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
      if (res.status === 429) {
        // Rate limited: the server says why and when to try again.
        const body = await res.json().catch(() => ({}));
        setCreateError(body?.error || "Too many rooms created — please try again later.");
        setCreating(false);
        return;
      }
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
    if (joinCode.length !== ROOM_CODE_LENGTH) return;
    router.push(`/room/${joinCode}`);
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-white dark:bg-neutral-950">
      {/* A soft indigo glow behind the top of the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[1100px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-indigo-400/20 blur-3xl dark:bg-indigo-500/15"
      />

      {/* Phones: headline, then the card (the main action stays near the top),
          then the activities. Desktop: headline and activities on the left,
          the card on the right spanning both rows. */}
      <main className="relative mx-auto grid w-full max-w-6xl flex-1 content-center gap-10 px-6 py-10 lg:grid-cols-[1.15fr_1fr] lg:gap-x-16 lg:gap-y-10 lg:py-16">
        <section className="lg:col-start-1 lg:row-start-1 lg:self-end">
          <div className="flex items-center gap-3">
            <LogoMark />
            <span className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl dark:text-neutral-50">
              Agility
            </span>
          </div>
          <h1 className="mt-8 text-4xl font-semibold tracking-tight text-balance text-neutral-900 sm:text-5xl dark:text-neutral-50">
            Your team&apos;s rituals, in one shared room.
          </h1>
          <p className="mt-4 max-w-xl text-base text-pretty text-neutral-600 sm:text-lg dark:text-neutral-400">
            Estimate stories, run quick polls, gather candid feedback and make fair picks — everyone sees the same
            thing, live. Create a room and share the link.
          </p>
        </section>

        <ul
          aria-label="Activities"
          className="grid grid-cols-2 gap-x-5 gap-y-5 md:grid-cols-3 lg:col-start-1 lg:row-start-2 lg:grid-cols-2 lg:self-start"
        >
          {ACTIVITY_HIGHLIGHTS.map((activity) => (
            <li key={activity.name} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-indigo-600 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-indigo-400">
                {activity.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{activity.name}</span>
                <span className="block text-sm text-neutral-500 dark:text-neutral-400">{activity.blurb}</span>
              </span>
            </li>
          ))}
        </ul>

        <section className="row-start-2 w-full max-w-md justify-self-start rounded-2xl lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center border border-neutral-200 bg-white p-6 shadow-xl shadow-neutral-900/5 sm:p-8 lg:justify-self-end dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/40">
          <form onSubmit={handleCreate} noValidate>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Start a room</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              You&apos;ll be its admin. Invite your team with the link.
            </p>

            <div className="mt-6 flex flex-col gap-4">
              <Field label="Your name" htmlFor="your-name">
                <input
                  id="your-name"
                  value={yourName}
                  onChange={(e) => setYourName(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="e.g. Jamie"
                  maxLength={40}
                  autoComplete="nickname"
                  className={inputClass}
                />
              </Field>
              <Field label="Room name" hint="Optional" htmlFor="room-name">
                <input
                  id="room-name"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="e.g. Platform Team"
                  maxLength={MAX_ROOM_NAME_LENGTH}
                  autoComplete="off"
                  className={inputClass}
                />
              </Field>
            </div>

            {createError && (
              <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
                {createError}
              </p>
            )}

            <button
              type="submit"
              disabled={creating}
              className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition enabled:hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {creating ? "Creating room…" : "Create room"}
              {!creating && <ArrowRightIcon />}
            </button>
          </form>

          <div className="my-7 flex items-center gap-3 text-xs font-medium text-neutral-400 dark:text-neutral-500">
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
            or join with a code
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          </div>

          <form onSubmit={handleJoin} className="flex gap-2">
            <label htmlFor="room-code" className="sr-only">
              Room code or invite link
            </label>
            <input
              id="room-code"
              value={joinCode}
              onChange={(e) => setJoinCode(parseRoomCode(e.target.value))}
              placeholder="Room code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={`${inputClass} font-mono tracking-[0.25em] placeholder:font-sans placeholder:tracking-normal`}
            />
            <button
              type="submit"
              disabled={joinCode.length !== ROOM_CODE_LENGTH}
              className="h-11 shrink-0 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm transition enabled:hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/30 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
            >
              Join
            </button>
          </form>
          <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">Pasting an invite link works too.</p>
        </section>
      </main>

      <footer className="relative mx-auto w-full max-w-6xl px-6 pb-8 text-xs text-neutral-400 dark:text-neutral-500">
        Rooms are removed after 60 days without activity.
      </footer>
    </div>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-baseline justify-between text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {label}
        {hint && <span className="text-xs font-normal text-neutral-400 dark:text-neutral-500">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ---- Icons -----------------------------------------------------------------
// Simple line icons drawn for this page (24×24, stroked with currentColor), so
// they share one weight and style. The app has no icon library.

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const ACTIVITY_HIGHLIGHTS: { name: string; blurb: string; icon: ReactNode }[] = [
  {
    name: "Planning Poker",
    blurb: "Estimate, then reveal",
    icon: (
      <Icon>
        <rect x="4" y="7" width="11" height="14" rx="2" />
        <path d="M9 4.5A1.5 1.5 0 0 1 10.5 3h7A1.5 1.5 0 0 1 19 4.5v11a1.5 1.5 0 0 1-1.5 1.5H17" />
      </Icon>
    ),
  },
  {
    name: "Poll",
    blurb: "Quick votes, live results",
    icon: (
      <Icon>
        <path d="M6 20v-7M12 20V5M18 20v-10M3 20h18" />
      </Icon>
    ),
  },
  {
    name: "Wheel",
    blurb: "Spin to pick who's next",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
      </Icon>
    ),
  },
  {
    name: "Plinko",
    blurb: "For big-moment picks",
    icon: (
      <Icon>
        <circle cx="12" cy="5" r="1" fill="currentColor" />
        <circle cx="8" cy="10" r="1" fill="currentColor" />
        <circle cx="16" cy="10" r="1" fill="currentColor" />
        <circle cx="4" cy="15" r="1" fill="currentColor" />
        <circle cx="12" cy="15" r="1" fill="currentColor" />
        <circle cx="20" cy="15" r="1" fill="currentColor" />
        <path d="M3 20h18" />
      </Icon>
    ),
  },
  {
    name: "Team Randomizer",
    blurb: "Split into fair, random teams",
    icon: (
      <Icon>
        <circle cx="8" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M2.5 20a5.5 5.5 0 0 1 11 0M14.5 14.4A4.5 4.5 0 0 1 21.5 18" />
      </Icon>
    ),
  },
  {
    name: "Anonymous Box",
    blurb: "Candid feedback, no names",
    icon: (
      <Icon>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3.5 7 8.5 6 8.5-6" />
      </Icon>
    ),
  },
];

function LogoMark() {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-md shadow-indigo-900/25 sm:h-12 sm:w-12">
      {/* A runner mid-stride — an original mark, drawn for Agility. */}
      <svg aria-hidden viewBox="0 0 24 24" className="h-7 w-7 sm:h-8 sm:w-8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="15" cy="4.2" r="2" fill="currentColor" stroke="none" />
        {/* torso */}
        <path d="M13.4 8.2 11 13.6" />
        {/* arms: one swinging forward, one back */}
        <path d="M13.4 8.2 16.4 10.6 18.6 9.6" />
        <path d="M13.4 8.2 9.6 9.2 8 11.8" />
        {/* legs: front knee up, back leg pushing off */}
        <path d="M11 13.6 14.6 15.6 13.8 20.4" />
        <path d="M11 13.6 9 17.6 4.8 18.4" />
      </svg>
    </span>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
