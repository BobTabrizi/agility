"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Confetti } from "@/components/activities/Confetti";
import { UseRoomMembersButton } from "@/components/UseRoomMembersButton";
import { CHART_PALETTE } from "@/lib/chartPalette";
import { PLINKO_STEP, plinkoPositions, plinkoRowCount } from "@/lib/plinkoPath";
import {
  MAX_PLINKO_OPTION_LENGTH,
  MAX_PLINKO_OPTIONS,
  PLINKO_SPEEDS,
  type PlinkoState,
  type PlinkoSpeed,
} from "@/lib/types";

// ---- Board geometry (SVG user units) -------------------------------------
// Lanes are the slot centers, 0…count-1 (see plinkoPath.ts). Boards with few
// slots get wider lanes so they don't turn into a thin column; rows are packed
// tightly (and capped relative to the width) so the board stays wider than it
// is tall and fits on screen without scrolling.
const MARGIN = 0.35;
const PEG_R = 0.06;
const BALL_R = 0.15;
const TOP_Y = 0.7;
const BIN_H = 1.6;

function geometry(count: number) {
  const rows = plinkoRowCount(count);
  const laneW = Math.max(1, 6 / count);
  const width = 2 * MARGIN + count * laneW;
  const rowH = Math.min(0.31 * Math.min(laneW, 1.5), (0.55 * width) / rows);
  const binTop = TOP_Y + rows * rowH;
  return {
    rows,
    laneW,
    rowH,
    binTop,
    width,
    height: binTop + BIN_H + 0.2,
    x: (lane: number) => MARGIN + (lane + 0.5) * laneW,
    pegY: (row: number) => TOP_Y + row * rowH,
  };
}

/** Peg lane positions in `row`: every step position with that row's parity, within the board. */
function pegLanes(row: number, count: number): number[] {
  const middle = (count - 1) / 2;
  const lanes: number[] = [];
  const reach = Math.ceil(count / PLINKO_STEP);
  for (let m = -reach; m <= reach; m++) {
    if (mod(m, 2) !== row % 2) continue;
    const lane = middle + m * PLINKO_STEP;
    if (lane >= 0 && lane <= count - 1) lanes.push(lane);
  }
  return lanes;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---- Animation timeline ----------------------------------------------------
// The ball's whole drop as a list of timed segments, computed from the path
// the server sent — so every client plays the identical drop.
type Segment = {
  duration: number;
  from: [number, number];
  to: [number, number];
  arc: number; // bounce height above the straight line
  gravity?: boolean; // falling from rest: ease-in instead of an arc
  hitRow?: number; // peg row the ball strikes at the start of this segment
};

function timeline(count: number, path: number[], speed: PlinkoSpeed): { segments: Segment[]; total: number } {
  const g = geometry(count);
  const pace = PLINKO_SPEEDS[speed];
  const lanes = plinkoPositions(count, path);
  const rest = (row: number, lane: number): [number, number] => [g.x(lane), g.pegY(row) - PEG_R - BALL_R];
  const inBin: [number, number] = [g.x(lanes[lanes.length - 1]), g.binTop + BIN_H - BALL_R - 0.05];
  const segments: Segment[] = [
    // Dropped in above the middle, falling onto the first peg.
    { duration: 460 * pace, from: [g.x(lanes[0]), 0.1], to: rest(0, lanes[0]), arc: 0, gravity: true },
  ];
  for (let row = 0; row < g.rows - 1; row++) {
    // Each bounce a little quicker than the last, like picking up speed.
    segments.push({
      duration: Math.max(120, 230 - row * 6) * pace,
      from: rest(row, lanes[row]),
      to: rest(row + 1, lanes[row + 1]),
      arc: g.rowH * 0.8,
      hitRow: row,
    });
  }
  // Off the last peg and into the bin, then a couple of settling hops.
  segments.push({ duration: 400 * pace, from: rest(g.rows - 1, lanes[g.rows - 1]), to: inBin, arc: g.rowH, hitRow: g.rows - 1 });
  segments.push({ duration: 200 * pace, from: inBin, to: inBin, arc: 0.28 });
  segments.push({ duration: 140 * pace, from: inBin, to: inBin, arc: 0.1 });
  return { segments, total: segments.reduce((sum, s) => sum + s.duration, 0) };
}

function ballAt(segment: Segment, t: number): [number, number] {
  const x = lerp(segment.from[0], segment.to[0], t);
  const y = segment.gravity
    ? lerp(segment.from[1], segment.to[1], t * t)
    : lerp(segment.from[1], segment.to[1], t) - segment.arc * 4 * t * (1 - t);
  return [x, y];
}

function truncate(label: string, max: number) {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label;
}

export function Plinko({
  plinko,
  isAdmin,
  activeMemberNames,
  onSetOptions,
  onDrop,
  onRemoveWinner,
  onSetSpeed,
}: {
  plinko: PlinkoState;
  isAdmin: boolean;
  activeMemberNames: string[];
  onSetOptions: (options: string[]) => void;
  onDrop: () => void;
  onRemoveWinner: (dropId: string) => void;
  onSetSpeed: (speed: PlinkoSpeed) => void;
}) {
  const { options, drop } = plinko;
  const count = options.length;
  const board = count >= 2 ? geometry(count) : null;

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
  const draftTooLong = parsedDraft.length > MAX_PLINKO_OPTIONS;

  // A drop that already existed when this mounted (joined or refreshed after
  // it) is shown settled in its bin, not replayed.
  const [settledDropId, setSettledDropId] = useState(drop?.id ?? null);
  const landed = drop !== null && settledDropId === drop.id;
  const dropping = drop !== null && !landed;
  // The peg the ball is striking right now, so it can flash.
  const [hit, setHit] = useState<{ row: number; lane: number } | null>(null);

  const ballRef = useRef<SVGGElement>(null);
  const frame = useRef<number | null>(null);

  // Drives the drop: a requestAnimationFrame loop over the timeline, moving
  // the ball directly (no re-render per frame) and flashing each peg as it's
  // struck. A real side effect, so an effect.
  useEffect(() => {
    const ball = ballRef.current;
    const place = ([x, y]: [number, number], visible = true) => {
      if (!ball) return;
      ball.style.transform = `translate(${x}px, ${y}px)`;
      ball.style.opacity = visible ? "1" : "0";
    };
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    // A path that doesn't fit this board (e.g. saved under an earlier board
    // layout) can't be drawn — leave the ball out rather than misplace it.
    if (!drop || count < 2 || drop.path.length !== plinkoRowCount(count)) {
      place([0, 0], false);
      return;
    }
    // Drops from before the speed setting existed have no speed: normal.
    const { segments, total } = timeline(count, drop.path, drop.speed ?? "normal");
    const lanes = plinkoPositions(count, drop.path);
    const final = segments[segments.length - 1].to;
    if (drop.id === settledDropId) {
      place(final);
      return;
    }

    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : total;
    let start: number | null = null;
    let lastHitRow = -1;
    const step = (now: number) => {
      start ??= now;
      const elapsed = duration === 0 ? total : Math.min(now - start, total);
      // Find the segment we're in.
      let offset = 0;
      let index = 0;
      while (index < segments.length - 1 && elapsed > offset + segments[index].duration) {
        offset += segments[index].duration;
        index++;
      }
      const segment = segments[index];
      const t = Math.min((elapsed - offset) / segment.duration, 1);
      place(ballAt(segment, t));
      if (segment.hitRow !== undefined && segment.hitRow !== lastHitRow) {
        lastHitRow = segment.hitRow;
        setHit({ row: segment.hitRow, lane: lanes[segment.hitRow] });
      }
      if (elapsed < total) {
        frame.current = requestAnimationFrame(step);
      } else {
        frame.current = null;
        place(final);
        setHit(null);
        setSettledDropId(drop.id);
      }
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
    // settledDropId is deliberately left out: settling a drop must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop?.id, count]);

  const winner = landed && drop ? options[drop.winnerIndex] : null;
  const labelMax = count <= 4 ? 12 : count <= 8 ? 9 : 7;

  function handleSaveOptions(e: FormEvent) {
    e.preventDefault();
    onSetOptions(parsedDraft.slice(0, MAX_PLINKO_OPTIONS));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="relative w-full max-w-[420px]">
          {board ? (
            <svg
              viewBox={`0 0 ${board.width} ${board.height}`}
              className="w-full"
              role="img"
              aria-label={`Plinko board with ${count} bins`}
            >
              <defs>
                <radialGradient id="plinko-ball" cx="35%" cy="35%" r="65%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="45%" stopColor="#c7d2fe" />
                  <stop offset="100%" stopColor="#4f46e5" />
                </radialGradient>
              </defs>

              {/* Side walls */}
              <line x1={MARGIN / 2} y1={TOP_Y - 0.4} x2={MARGIN / 2} y2={board.binTop + BIN_H} className="stroke-neutral-300 dark:stroke-neutral-700" strokeWidth={0.06} strokeLinecap="round" />
              <line x1={board.width - MARGIN / 2} y1={TOP_Y - 0.4} x2={board.width - MARGIN / 2} y2={board.binTop + BIN_H} className="stroke-neutral-300 dark:stroke-neutral-700" strokeWidth={0.06} strokeLinecap="round" />

              {/* Pegs — the one being struck flashes */}
              {Array.from({ length: board.rows }, (_, row) =>
                pegLanes(row, count).map((lane) => {
                  const struck = hit?.row === row && hit.lane === lane;
                  return (
                    <circle
                      key={`${row}-${lane}`}
                      cx={board.x(lane)}
                      cy={board.pegY(row)}
                      r={struck ? PEG_R * 1.6 : PEG_R}
                      className={struck ? "fill-amber-300" : "fill-neutral-400 dark:fill-neutral-500"}
                      style={{ transition: "r 120ms, fill 200ms" }}
                    />
                  );
                })
              )}

              {/* Bins */}
              {options.map((option, i) => {
                const color = CHART_PALETTE[i % CHART_PALETTE.length];
                const isWinner = winner !== null && i === drop?.winnerIndex;
                const x0 = MARGIN + i * board.laneW;
                const cx = x0 + board.laneW / 2;
                const cy = board.binTop + BIN_H / 2;
                return (
                  <g key={i} style={{ opacity: winner !== null && !isWinner ? 0.35 : 1, transition: "opacity 400ms" }}>
                    <rect
                      x={x0 + 0.04}
                      y={board.binTop}
                      width={board.laneW - 0.08}
                      height={BIN_H}
                      rx={0.12}
                      fill={color.fill}
                      opacity={isWinner ? 1 : 0.55}
                    />
                    <text
                      transform={`translate(${cx} ${cy}) rotate(-90)`}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.min(0.3, board.laneW * 0.32)}
                      fontWeight={600}
                      fill={color.ink}
                    >
                      {truncate(option, labelMax)}
                    </text>
                  </g>
                );
              })}

              {/* The ball — positioned every frame by the effect above */}
              <g ref={ballRef} style={{ opacity: 0 }}>
                <circle r={BALL_R} fill="url(#plinko-ball)" className="drop-shadow" />
              </g>
            </svg>
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-neutral-100 text-sm text-neutral-400 dark:bg-neutral-800">
              Plinko board
            </div>
          )}

          {winner && drop && <Confetti key={drop.id} seed={drop.id} originY="85%" />}
        </div>

        <div className="flex min-h-[3.5rem] items-center justify-center" aria-live="polite">
          {winner ? (
            <p
              key={drop?.id}
              className="wheel-motion text-center text-2xl font-bold text-neutral-900 dark:text-neutral-50"
              style={{ animation: "wheel-winner-pop 450ms ease-out" }}
            >
              🎉 {winner}
            </p>
          ) : dropping ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Dropping…</p>
          ) : (
            <p className="text-sm text-neutral-400">
              {count >= 2
                ? isAdmin
                  ? "Ready when you are."
                  : "Waiting for the admin to drop the ball…"
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
              onClick={onDrop}
              disabled={count < 2 || dropping}
              className="rounded-full bg-indigo-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-40"
            >
              {landed ? "Drop again" : "Drop the ball"}
            </button>
            {winner !== null && drop && (
              <button
                type="button"
                onClick={() => onRemoveWinner(drop.id)}
                title="Take this option off the board, e.g. to pick the next person from who's left"
                className="max-w-[16rem] truncate rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                Remove {winner}
              </button>
            )}
          </div>
        )}

        {isAdmin && (
          // A room setting: everyone sees the drop at the same pace. Applies from the next drop.
          <div
            className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400"
            role="radiogroup"
            aria-label="Drop speed"
          >
            Speed
            <div className="inline-flex rounded-full border border-neutral-200 p-0.5 dark:border-neutral-800">
              {(Object.keys(PLINKO_SPEEDS) as PlinkoSpeed[]).map((speed) => (
                <button
                  key={speed}
                  type="button"
                  role="radio"
                  aria-checked={plinko.speed === speed}
                  onClick={() => onSetSpeed(speed)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                    plinko.speed === speed
                      ? "bg-indigo-600 text-white"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  {speed}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
        <form
          onSubmit={handleSaveOptions}
          className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Options (one per line, up to {MAX_PLINKO_OPTIONS})
            <textarea
              value={optionsDraft}
              onChange={(e) => setOptionsDraft(e.target.value)}
              rows={5}
              placeholder={"Alice\nBob\nCarla"}
              className="resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>
          <p className={`text-xs ${draftTooLong ? "text-amber-600 dark:text-amber-400" : "text-neutral-400"}`}>
            {draftTooLong
              ? `Only the first ${MAX_PLINKO_OPTIONS} will be used — the board has ${MAX_PLINKO_OPTIONS} bins at most.`
              : `Every option has an equal chance. Long ones are shortened on the board (up to ${MAX_PLINKO_OPTION_LENGTH} characters are kept).`}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <UseRoomMembersButton names={activeMemberNames} onUse={(names) => setOptionsDraft(names.join("\n"))} />
            <button
              type="submit"
              disabled={!draftIsUnsaved}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Save options
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
