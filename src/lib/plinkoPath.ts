/**
 * Path generation for the Plinko activity — "movie physics": the
 * winning slot is chosen first (uniformly, so every option has the same
 * chance, unlike a real Plinko board where middle slots win far more often),
 * then this produces a believable bounce path that ends in it.
 *
 * Board model: slots are lanes 0…slotCount-1. The ball starts above the
 * middle, at lane (slotCount - 1) / 2, and each peg row knocks it a quarter
 * lane (PLINKO_STEP) left (-1) or right (+1). Pegs within a row are half a
 * lane apart and alternate rows are offset by a quarter — the classic
 * staggered layout, dense — so the ball always lands on a peg. It never
 * leaves the board: its position stays within [0, slotCount - 1].
 */

/** How far one peg row moves the ball, in lanes. */
export const PLINKO_STEP = 0.25;

/** Fewest rows a board has, so even a 2-option board has a proper drop. */
const MIN_ROWS = 14;

/**
 * How many peg rows a board with `slotCount` slots has: enough to reach the
 * outermost slots from the middle ((slotCount - 1) / 2 lanes, i.e.
 * 2 * (slotCount - 1) steps), at least MIN_ROWS, and even — every slot is an
 * even number of quarter-lane steps from the middle, so only an even row
 * count can end in it.
 */
export function plinkoRowCount(slotCount: number): number {
  const needed = 2 * (slotCount - 1);
  return Math.max(needed, MIN_ROWS);
}

/** The ball's lane position after each row (length = rows + 1, starting above the board). */
export function plinkoPositions(slotCount: number, path: number[]): number[] {
  const positions = [(slotCount - 1) / 2];
  for (const step of path) positions.push(positions[positions.length - 1] + step * PLINKO_STEP);
  return positions;
}

/**
 * A random bounce path (one -1/+1 per row) from the top-middle into slot
 * `winnerIndex`, staying on the board throughout. `random` is injectable for
 * tests; the server uses Math.random.
 */
export function plinkoPath(slotCount: number, winnerIndex: number, random: () => number = Math.random): number[] {
  if (slotCount < 2 || winnerIndex < 0 || winnerIndex >= slotCount) {
    throw new Error(`No path to slot ${winnerIndex} on a ${slotCount}-slot board.`);
  }
  const rows = plinkoRowCount(slotCount);
  // Net steps needed, from the middle to the winning slot.
  const net = (winnerIndex - (slotCount - 1) / 2) / PLINKO_STEP;
  const rights = (rows + net) / 2;

  // Choose each step with the odds that keep the remaining steps able to
  // finish the job (a uniformly random arrangement of the rights and lefts),
  // forcing a direction only where the other would leave the board.
  const max = slotCount - 1;
  let position = max / 2;
  let rightsLeft = rights;
  const path: number[] = [];
  for (let stepsLeft = rows; stepsLeft > 0; stepsLeft--) {
    const leftsLeft = stepsLeft - rightsLeft;
    const canGoRight = rightsLeft > 0 && position + PLINKO_STEP <= max;
    const canGoLeft = leftsLeft > 0 && position - PLINKO_STEP >= 0;
    const goRight = canGoRight && (!canGoLeft || random() < rightsLeft / stepsLeft);
    path.push(goRight ? 1 : -1);
    position += goRight ? PLINKO_STEP : -PLINKO_STEP;
    if (goRight) rightsLeft--;
  }
  return path;
}
