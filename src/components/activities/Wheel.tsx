"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Confetti } from "@/components/activities/Confetti";
import { ClearDraftButton } from "@/components/ClearDraftButton";
import { UseRoomMembersButton } from "@/components/UseRoomMembersButton";
import { ringColor } from "@/lib/chartPalette";
import {
  MAX_WHEEL_OPTION_LENGTH,
  MAX_WHEEL_OPTIONS,
  WHEEL_SPIN_DURATION_MS,
  type WheelState,
} from "@/lib/types";

/** A point on the wheel: angle in degrees clockwise from 12 o'clock, radius 0–1. */
function point(angle: number, radius: number) {
  const a = (angle * Math.PI) / 180;
  return [radius * Math.sin(a), -radius * Math.cos(a)] as const;
}

function slicePath(index: number, count: number) {
  if (count === 1) return "M 0 -1 A 1 1 0 1 1 0 1 A 1 1 0 1 1 0 -1 Z";
  const seg = 360 / count;
  const [x0, y0] = point(index * seg, 1);
  const [x1, y1] = point((index + 1) * seg, 1);
  return `M 0 0 L ${x0} ${y0} A 1 1 0 ${seg > 180 ? 1 : 0} 1 ${x1} ${y1} Z`;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * The wheel rotation (degrees, clockwise) that puts `spin`'s landing point —
 * `offset` of the way through the winning slice — under the pointer at the top.
 */
function landingAngle(spin: NonNullable<WheelState["spin"]>, count: number) {
  return mod(360 - (spin.winnerIndex + spin.offset) * (360 / count), 360);
}

// Fast at first, then a long, smooth slowdown — how a real wheel coasts to a stop.
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

function truncate(label: string, max: number) {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label;
}

export function Wheel({
  wheel,
  isAdmin,
  activeMemberNames,
  onSetOptions,
  onSpin,
  onRemoveWinner,
}: {
  wheel: WheelState;
  isAdmin: boolean;
  activeMemberNames: string[];
  onSetOptions: (options: string[]) => void;
  onSpin: () => void;
  onRemoveWinner: (spinId: string) => void;
}) {
  const { options, spin } = wheel;
  const count = options.length;

  // Draft-sync idiom (see CLAUDE.md) for the admin's options textarea.
  const optionsText = options.join("\n");
  const [optionsDraft, setOptionsDraft] = useState(optionsText);
  const [lastSeenOptionsText, setLastSeenOptionsText] = useState(optionsText);
  if (optionsText !== lastSeenOptionsText) {
    setLastSeenOptionsText(optionsText);
    setOptionsDraft(optionsText);
  }
  const parsedDraft = optionsDraft
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
  const draftIsUnsaved = parsedDraft.join("\n") !== optionsText;

  // A spin that already existed when this mounted (joined or refreshed after
  // it) is shown where it landed, not replayed.
  const [settledSpinId, setSettledSpinId] = useState(spin?.id ?? null);
  const landed = spin !== null && settledSpinId === spin.id;
  const spinning = spin !== null && !landed;
  // Bumped each time a slice passes under the pointer, to replay its flick.
  const [tick, setTick] = useState(0);

  const wheelRef = useRef<SVGGElement>(null);
  const rotation = useRef(spin ? landingAngle(spin, count) : 0);
  const frame = useRef<number | null>(null);

  // Drives the spin: a requestAnimationFrame loop that rotates the wheel
  // directly (no re-render per frame), and ticks the pointer whenever the
  // slice under it changes. A real side effect, so an effect — not state
  // mirroring.
  useEffect(() => {
    const group = wheelRef.current;
    const apply = (deg: number) => {
      rotation.current = deg;
      if (group) group.style.transform = `rotate(${deg}deg)`;
    };
    if (frame.current !== null) cancelAnimationFrame(frame.current);

    if (!spin || count === 0) {
      apply(0);
      return;
    }
    if (spin.id === settledSpinId) {
      apply(landingAngle(spin, count));
      return;
    }

    // Always spin forward: from wherever the wheel is now, a whole number of
    // extra turns, to the landing angle.
    const from = rotation.current;
    const to = from - mod(from, 360) + spin.turns * 360 + landingAngle(spin, count) + 360;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 0 : WHEEL_SPIN_DURATION_MS;
    const seg = 360 / count;
    let start: number | null = null;
    let lastSlice = -1;

    const step = (now: number) => {
      start ??= now;
      const t = duration === 0 ? 1 : Math.min((now - start) / duration, 1);
      const deg = from + (to - from) * easeOutQuart(t);
      apply(deg);
      const slice = Math.floor(mod(360 - deg, 360) / seg);
      if (slice !== lastSlice) {
        if (lastSlice !== -1) setTick((k) => k + 1);
        lastSlice = slice;
      }
      if (t < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        frame.current = null;
        setSettledSpinId(spin.id);
      }
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
    // settledSpinId is deliberately left out: settling a spin must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin?.id, count]);

  const winner = landed && spin ? options[spin.winnerIndex] : null;
  const labelMax = count <= 6 ? 18 : count <= 12 ? 14 : 10;
  const fontSize = count <= 6 ? 0.11 : count <= 12 ? 0.085 : 0.065;

  function handleSaveOptions(e: FormEvent) {
    e.preventDefault();
    onSetOptions(parsedDraft);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="relative w-full max-w-[340px]">
          {/* The pointer, fixed at 12 o'clock; flicks each time a slice passes. */}
          <div className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2">
            <div
              key={tick}
              className="wheel-motion origin-top"
              style={{ animation: tick > 0 ? "wheel-pointer-tick 140ms ease-out" : undefined }}
            >
              <svg width="26" height="30" viewBox="0 0 26 30" aria-hidden>
                <path
                  d="M13 30 L2 6 A12 12 0 1 1 24 6 Z"
                  className="fill-neutral-900 stroke-white dark:fill-neutral-50 dark:stroke-neutral-900"
                  strokeWidth="2"
                />
              </svg>
            </div>
          </div>

          <svg viewBox="-1.08 -1.08 2.16 2.16" className="w-full drop-shadow-md" role="img" aria-label={
            count === 0 ? "Empty wheel" : `Wheel with ${count} options`
          }>
            <g ref={wheelRef}>
              {count === 0 ? (
                <circle r="1" className="fill-neutral-100 dark:fill-neutral-800" />
              ) : (
                options.map((option, i) => {
                  const color = ringColor(i, count);
                  const mid = (i + 0.5) * (360 / count);
                  const dimmed = winner !== null && i !== spin?.winnerIndex;
                  return (
                    <g key={i} style={{ opacity: dimmed ? 0.3 : 1, transition: "opacity 400ms" }}>
                      <path d={slicePath(i, count)} fill={color.fill} stroke="white" strokeWidth={0.01} />
                      <text
                        // Labels run along the slice; on the left half they're turned
                        // around so they read left-to-right instead of upside down.
                        transform={`rotate(${mid}) translate(0 -0.6) rotate(${mid > 180 ? 90 : -90})`}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={fontSize}
                        fontWeight={600}
                        fill={color.ink}
                      >
                        {truncate(option, labelMax)}
                      </text>
                    </g>
                  );
                })
              )}
            </g>
            <circle r="1" fill="none" className="stroke-white dark:stroke-neutral-900" strokeWidth={0.03} />
            <circle r="0.12" className="fill-white stroke-neutral-200 dark:fill-neutral-900 dark:stroke-neutral-700" strokeWidth={0.02} />
          </svg>

          {winner && spin && <Confetti key={spin.id} seed={spin.id} />}
        </div>

        <div className="flex min-h-[3.5rem] items-center justify-center" aria-live="polite">
          {winner ? (
            <p
              key={spin?.id}
              className="wheel-motion text-center text-2xl font-bold text-neutral-900 dark:text-neutral-50"
              style={{ animation: "wheel-winner-pop 450ms ease-out" }}
            >
              🎉 {winner}
            </p>
          ) : spinning ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Spinning…</p>
          ) : (
            <p className="text-sm text-neutral-400">
              {count >= 2
                ? isAdmin
                  ? "Ready when you are."
                  : "Waiting for the admin to spin…"
                : isAdmin
                  ? "Add at least two options below."
                  : "Waiting for the admin to add options…"}
            </p>
          )}
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={onSpin}
              disabled={count < 2 || spinning}
              className="rounded-full bg-indigo-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm enabled:hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
            >
              {landed ? "Spin again" : "Spin"}
            </button>
            {winner !== null && spin && (
              <button
                type="button"
                onClick={() => onRemoveWinner(spin.id)}
                title="Take this option off the wheel, e.g. to pick the next person from who's left"
                className="max-w-[16rem] truncate rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                Remove {winner}
              </button>
            )}
          </div>
        )}
      </div>

      {isAdmin && (
        <form
          onSubmit={handleSaveOptions}
          className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Options (one per line, up to {MAX_WHEEL_OPTIONS})
            <textarea
              value={optionsDraft}
              onChange={(e) => setOptionsDraft(e.target.value)}
              rows={5}
              placeholder={"Alice\nBob\nCarla"}
              className="resize-y rounded-lg border border-neutral-300 px-3 py-2 text-base sm:text-sm font-normal outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>
          <p className="text-xs text-neutral-400">
            Long options are shortened on the wheel (up to {MAX_WHEEL_OPTION_LENGTH} characters are kept); the
            full text shows when one wins.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <UseRoomMembersButton names={activeMemberNames} onUse={(names) => setOptionsDraft(names.join("\n"))} />
              <ClearDraftButton disabled={!optionsDraft} onClear={() => setOptionsDraft("")} />
            </div>
            <button
              type="submit"
              disabled={!draftIsUnsaved}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 enabled:hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:enabled:hover:bg-neutral-800"
            >
              Save options
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
