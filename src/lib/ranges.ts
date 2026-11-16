import { UserError } from './errors';

/** "1-3, 5, 8-" → [[0,1,2],[4],[7..max-1]] (0-based). Throws a friendly error on bad input. */
export function parseRanges(input: string, max: number): number[][] {
  const parts = input.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new UserError('Enter at least one page or range, for example 1-3, 5.');
  return parts.map((p) => {
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(p) ?? /^(\d+)$/.exec(p);
    if (!m) throw new UserError(`“${p}” isn’t a valid page or range.`);
    const a = Number(m[1] || 1);
    const b = m[2] === undefined ? a : Number(m[2] || max);
    if (a < 1 || b < 1 || a > max || b > max) throw new UserError(`“${p}” is outside this PDF (it has ${max} pages).`);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo - 1 + i);
  });
}

/** [0,1,2,4] → "1-3, 5" */
export function formatPages(pages: number[]): string {
  const s = [...pages].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? `${s[i] + 1}` : `${s[i] + 1}-${s[j] + 1}`);
    i = j + 1;
  }
  return out.join(', ');
}
