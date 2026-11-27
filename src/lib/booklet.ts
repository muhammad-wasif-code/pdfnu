/** Booklet imposition order (kept separate so the page can preview it without loading pdf-lib). */
/** Page order for a saddle-stitched booklet: pairs [left, right] per sheet side; -1 = blank. */
export function bookletOrder(n: number, rtl = false): [number, number][] {
  const total = Math.ceil(Math.max(1, n) / 4) * 4;
  const at = (i: number) => (i < n ? i : -1);
  const sides: [number, number][] = [];
  for (let s = 0; s < total / 4; s++) {
    const front: [number, number] = [at(total - 1 - 2 * s), at(2 * s)];
    const back: [number, number] = [at(2 * s + 1), at(total - 2 - 2 * s)];
    sides.push(rtl ? [front[1], front[0]] : front, rtl ? [back[1], back[0]] : back);
  }
  return sides;
}

