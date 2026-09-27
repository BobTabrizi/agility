/**
 * The categorical palette from globals.css, each fill paired with the text
 * color chosen for contrast on it — so labels stay readable on every color.
 * Used for wheel slices and Plinko bins.
 */
export const CHART_PALETTE = Array.from({ length: 8 }, (_, i) => ({
  fill: `var(--viz-series-${i + 1})`,
  ink: `var(--viz-series-${i + 1}-ink)`,
}));

/**
 * The color for item `index` of `count` arranged in a ring (wheel slices):
 * cycling the palette would give the last item the first one's color when
 * they end up adjacent (count ≡ 1 mod 8), so that one is shifted.
 */
export function ringColor(index: number, count: number) {
  const n = CHART_PALETTE.length;
  const i = index === count - 1 && count > 1 && (count - 1) % n === 0 ? 4 : index;
  return CHART_PALETTE[i % n];
}

/** Small seeded PRNG: the same seed always gives the same sequence (e.g. confetti per result). */
export function seededRandom(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
