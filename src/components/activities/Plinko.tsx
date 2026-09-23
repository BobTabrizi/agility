"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { UseRoomMembersButton } from "@/components/UseRoomMembersButton";
import type { PlinkoState } from "@/lib/types";

export function Plinko({
  plinko,
  isAdmin,
  activeMemberNames,
  onSetOptions,
  onSpin,
}: {
  plinko: PlinkoState;
  isAdmin: boolean;
  activeMemberNames: string[];
  onSetOptions: (options: string[]) => void;
  onSpin: () => void;
}) {
  const optionsText = plinko.options.join("\n");
  const [optionsDraft, setOptionsDraft] = useState(optionsText);
  const [lastSeenOptionsText, setLastSeenOptionsText] = useState(optionsText);
  if (optionsText !== lastSeenOptionsText) {
    setLastSeenOptionsText(optionsText);
    setOptionsDraft(optionsText);
  }

  const [animating, setAnimating] = useState(false);
  const [revealedWinner, setRevealedWinner] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const lastSeed = useRef<number | null>(null);
  const isFirstRun = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // This effect drives a real side effect (a chained setTimeout animation with
  // cleanup) in response to the server picking a new winner — it isn't mirroring
  // a prop into state, so it can't be replaced by render-time state adjustment.
  useEffect(() => {
    const firstRun = isFirstRun.current;
    isFirstRun.current = false;

    if (plinko.seed === null || plinko.seed === lastSeed.current) return;
    lastSeed.current = plinko.seed;

    // On first load (join/refresh) there may already be a decided winner —
    // show it instantly instead of replaying the drop animation for a spin
    // that already happened before this client connected.
    if (firstRun) {
      setRevealedWinner(plinko.winner);
      return;
    }

    if (!plinko.winner || plinko.options.length === 0) return;

    timers.current.forEach(clearTimeout);
    timers.current = [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRevealedWinner(null);
    setAnimating(true);

    const winnerIndex = plinko.options.indexOf(plinko.winner);
    const totalSteps = plinko.options.length * 3 + Math.max(winnerIndex, 0);
    let step = 0;

    function tick(delay: number) {
      const t = setTimeout(() => {
        setHighlightIndex(step % plinko.options.length);
        step += 1;
        if (step <= totalSteps) {
          const progress = step / totalSteps;
          const nextDelay = 60 + progress * progress * 260;
          tick(nextDelay);
        } else {
          setAnimating(false);
          setRevealedWinner(plinko.winner);
        }
      }, delay);
      timers.current.push(t);
    }
    tick(60);

    return () => {
      timers.current.forEach(clearTimeout);
    };
  }, [plinko.seed, plinko.winner, plinko.options]);

  function handleSaveOptions(e: FormEvent) {
    e.preventDefault();
    const options = optionsDraft
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    onSetOptions(options);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex flex-col items-center gap-1.5">
          {Array.from({ length: 4 }).map((_, row) => (
            <div key={row} className="flex gap-3" style={{ marginLeft: row % 2 ? 12 : 0 }}>
              {Array.from({ length: 6 }).map((_, col) => (
                <span
                  key={col}
                  className="h-1.5 w-1.5 rounded-full bg-indigo-200 dark:bg-indigo-800"
                />
              ))}
            </div>
          ))}
        </div>

        {plinko.options.length === 0 ? (
          <p className="text-center text-sm text-neutral-400">
            {isAdmin
              ? "Add some options below to get started."
              : "Waiting for the admin to add options…"}
          </p>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            {plinko.options.map((opt, i) => {
              const isHighlighted = animating && i === highlightIndex;
              const isWinner = !animating && revealedWinner === opt;
              return (
                <span
                  key={`${opt}-${i}`}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-all ${
                    isWinner
                      ? "scale-110 border-emerald-500 bg-emerald-500 text-white shadow-md"
                      : isHighlighted
                        ? "scale-105 border-indigo-500 bg-indigo-500 text-white"
                        : "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  }`}
                >
                  {opt}
                </span>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex min-h-12 items-center justify-center">
          {animating && <p className="text-sm text-neutral-400">Dropping the ball…</p>}
          {!animating && revealedWinner && (
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              🎉 {revealedWinner}
            </p>
          )}
        </div>

        {isAdmin && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={onSpin}
              disabled={animating || plinko.options.length < 2}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Drop the ball
            </button>
          </div>
        )}
      </div>

      {isAdmin && (
        <form
          onSubmit={handleSaveOptions}
          className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Options (one per line)
            <textarea
              value={optionsDraft}
              onChange={(e) => setOptionsDraft(e.target.value)}
              rows={6}
              placeholder={"Alice\nBob\nCarla"}
              className="resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>
          <div className="mt-3 flex items-center justify-between gap-2">
            <UseRoomMembersButton
              names={activeMemberNames}
              onUse={(names) => setOptionsDraft(names.join("\n"))}
            />
            <button
              type="submit"
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Save options
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
