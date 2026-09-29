"use client";

const SLICE_COLORS = [
  "var(--viz-series-1)",
  "var(--viz-series-2)",
  "var(--viz-series-3)",
  "var(--viz-series-4)",
  "var(--viz-series-5)",
  "var(--viz-series-6)",
  "var(--viz-series-7)",
  "var(--viz-series-8)",
];
// Text color to place on top of the matching SLICE_COLORS entry, picked by
// contrast ratio (computed, not eyeballed) so in-slice labels stay legible.
const SLICE_INKS = [
  "var(--viz-series-1-ink)",
  "var(--viz-series-2-ink)",
  "var(--viz-series-3-ink)",
  "var(--viz-series-4-ink)",
  "var(--viz-series-5-ink)",
  "var(--viz-series-6-ink)",
  "var(--viz-series-7-ink)",
  "var(--viz-series-8-ink)",
];
const OTHER_COLOR = "var(--viz-muted)";
const OTHER_INK = "var(--viz-muted-ink)";
const MAX_SLOTS = SLICE_COLORS.length;

// In-slice labels only appear on wedges big enough to hold the (now larger)
// text legibly; smaller slices stay in the legend + hover tooltip instead.
const LABEL_SHARE_THRESHOLD = 0.08;
// Long text-card values (e.g. "Continue retrospective") don't fit inside a
// wedge — those stay in the legend + tooltip rather than being squeezed in.
const LABEL_MAX_CHARS = 12;

const SIZE = 300;
const CENTER = SIZE / 2;
const RADIUS = 115;
const LABEL_RADIUS = RADIUS * 0.62;

function polarToCartesian(radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

function wedgePath(startAngle: number, endAngle: number) {
  const start = polarToCartesian(RADIUS, endAngle);
  const end = polarToCartesian(RADIUS, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

export interface VotedValue {
  value: string;
  count: number;
  // The value's color in the chart, and the text color to put on it.
  color: string;
  ink: string;
}

/**
 * The values voted this round, in display order — deck order, then anything
 * not in the deck — each with its count and chart color. The vote card
 * (PlanningPoker's revealed rows) uses this too, so a value is the same color
 * in both. Past the palette's size, values share the muted "Other" color.
 */
export function votedValues(votes: Record<string, string>, deck: string[]): VotedValue[] {
  const counts = new Map<string, number>();
  for (const value of Object.values(votes)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  // Ordered by deck position so a value's color/position stays consistent
  // between rounds instead of shuffling based on vote order.
  const ordered = [...deck.filter((v) => counts.has(v)), ...[...counts.keys()].filter((v) => !deck.includes(v))];
  return ordered.map((value, i) => ({
    value,
    count: counts.get(value)!,
    color: i < MAX_SLOTS ? SLICE_COLORS[i] : OTHER_COLOR,
    ink: i < MAX_SLOTS ? SLICE_INKS[i] : OTHER_INK,
  }));
}

interface Wedge {
  label: string;
  count: number;
  share: number;
  color: string;
  ink: string;
  startAngle: number;
  endAngle: number;
}

export function PokerVoteChart({ votes, deck }: { votes: Record<string, string>; deck: string[] }) {
  const total = Object.values(votes).length;
  if (total === 0) return null;

  const values = votedValues(votes, deck);
  const primaryValues = values.slice(0, MAX_SLOTS);
  const overflowValues = values.slice(MAX_SLOTS);

  let angle = 0;
  const wedges: Wedge[] = [];
  for (const { value, count, color, ink } of primaryValues) {
    const share = count / total;
    const startAngle = angle;
    angle += share * 360;
    wedges.push({ label: value, count, share, color, ink, startAngle, endAngle: angle });
  }

  if (overflowValues.length > 0) {
    const count = overflowValues.reduce((sum, v) => sum + v.count, 0);
    const share = count / total;
    const startAngle = angle;
    angle += share * 360;
    wedges.push({
      label: "Other",
      count,
      share,
      color: OTHER_COLOR,
      ink: OTHER_INK,
      startAngle,
      endAngle: angle,
    });
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="mb-4 text-sm font-medium text-neutral-500 dark:text-neutral-400">
        Vote distribution
      </p>
      <div className="flex flex-col items-center gap-8 sm:flex-row sm:justify-center">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-72 w-72 shrink-0"
          role="img"
          aria-label="Pie chart of votes by card value"
        >
          {wedges.map((w) => {
            // A wedge spanning the full 360° (e.g. only one distinct value was
            // voted) has identical start/end points, which degenerates to an
            // invisible zero-length arc — draw a plain circle instead.
            const isFullCircle = w.endAngle - w.startAngle >= 359.99;
            return (
              <g key={w.label}>
                {isFullCircle ? (
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={RADIUS}
                    fill={w.color}
                    stroke="var(--viz-surface)"
                    strokeWidth={3}
                  />
                ) : (
                  <path
                    d={wedgePath(w.startAngle, w.endAngle)}
                    fill={w.color}
                    stroke="var(--viz-surface)"
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                )}
                <title>
                  {w.label}: {w.count} vote{w.count === 1 ? "" : "s"} ({Math.round(w.share * 100)}%)
                </title>
              </g>
            );
          })}
          {wedges
            .filter((w) => w.share >= LABEL_SHARE_THRESHOLD && w.label.length <= LABEL_MAX_CHARS)
            .map((w) => {
              const mid = (w.startAngle + w.endAngle) / 2;
              const pos = polarToCartesian(LABEL_RADIUS, mid);
              return (
                <text
                  key={`label-${w.label}`}
                  x={pos.x}
                  y={pos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-[20px] font-semibold"
                  style={{ fill: w.ink }}
                >
                  {w.label}
                </text>
              );
            })}
        </svg>

        <ul className="flex flex-col gap-2.5">
          {wedges.map((w) => (
            <li key={w.label} className="flex items-center gap-2 text-sm">
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ backgroundColor: w.color }}
                aria-hidden
              />
              <span className="font-medium text-neutral-900 dark:text-neutral-50">{w.label}</span>
              <span className="text-neutral-500 dark:text-neutral-400">
                {w.count} vote{w.count === 1 ? "" : "s"} · {Math.round(w.share * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
