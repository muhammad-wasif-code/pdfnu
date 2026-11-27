/**
 * Raster → SVG tracing (posterise + outline). Pure TypeScript.
 * Colours are reduced to a small palette, each colour region is outlined along pixel edges
 * (holes included), outlines are simplified and optionally smoothed into curves.
 */
import { palette } from './gif';

export interface TraceOpts { colors: number; mode: 'color' | 'bw'; threshold: number; smooth: boolean; detail: number; /* 0..100 */ transparentBg: boolean; }

type Pt = [number, number];

/** Pixel classes (palette index per pixel) after a light majority filter that removes specks. */
function classify(rgba: Uint8ClampedArray, w: number, h: number, o: TraceOpts): { cls: Uint8Array; pal: number[][]; alphaClass: number } {
  const cls = new Uint8Array(w * h);
  let pal: number[][];
  let alphaClass = -1;
  if (o.mode === 'bw') {
    pal = [[255, 255, 255], [0, 0, 0]];
    for (let i = 0; i < w * h; i++) { const p = i * 4; const l = rgba[p + 3] < 128 ? 255 : (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000; cls[i] = l < o.threshold ? 1 : 0; }
    if (o.transparentBg) alphaClass = 0;
  } else {
    const p = palette([rgba], Math.max(2, Math.min(32, o.colors)));
    pal = []; for (let i = 0; i < p.length; i += 3) pal.push([p[i], p[i + 1], p[i + 2]]);
    const cache = new Map<number, number>();
    const hasAlpha = (() => { for (let i = 3; i < rgba.length; i += 16) if (rgba[i] < 128) return true; return false; })();
    if (hasAlpha) { alphaClass = pal.length; pal.push([0, 0, 0]); }
    for (let i = 0; i < w * h; i++) {
      const q = i * 4;
      if (hasAlpha && rgba[q + 3] < 128) { cls[i] = alphaClass; continue; }
      const key = ((rgba[q] >> 2) << 12) | ((rgba[q + 1] >> 2) << 6) | (rgba[q + 2] >> 2);
      let k = cache.get(key);
      if (k === undefined) {
        let bd = Infinity; k = 0;
        for (let j = 0; j < (hasAlpha ? pal.length - 1 : pal.length); j++) { const dr = pal[j][0] - rgba[q], dg = pal[j][1] - rgba[q + 1], db = pal[j][2] - rgba[q + 2]; const d = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (d < bd) { bd = d; k = j; } }
        cache.set(key, k);
      }
      cls[i] = k;
    }
  }
  // majority filter (3×3): smooths jagged edges and removes single-pixel noise
  const passes = o.detail > 70 ? 0 : o.detail > 35 ? 1 : 2;
  let a = cls;
  for (let pass = 0; pass < passes; pass++) {
    const b = new Uint8Array(a);
    const cnt = new Uint8Array(256);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const touched: number[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = a[(y + dy) * w + x + dx]; if (!cnt[v]) touched.push(v); cnt[v]++; }
      let best = a[y * w + x], bc = cnt[best];
      for (const v of touched) if (cnt[v] > bc) { bc = cnt[v]; best = v; }
      if (bc >= 5) b[y * w + x] = best;
      for (const v of touched) cnt[v] = 0;
    }
    a = b;
  }
  return { cls: a, pal, alphaClass };
}

/** Closed outlines of all regions of class k (outer and hole loops), along pixel edges. */
function outlines(cls: Uint8Array, w: number, h: number, k: number): Pt[][] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cls[y * w + x] === k;
  // directed boundary edges, keyed by start vertex; region on the right side (clockwise in y-down)
  const out = new Map<number, number[]>();
  const V = (x: number, y: number) => y * (w + 1) + x;
  const add = (a: number, b: number) => { let l = out.get(a); if (!l) { l = []; out.set(a, l); } l.push(b); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (cls[y * w + x] !== k) continue;
    if (!inside(x, y - 1)) add(V(x, y), V(x + 1, y));
    if (!inside(x + 1, y)) add(V(x + 1, y), V(x + 1, y + 1));
    if (!inside(x, y + 1)) add(V(x + 1, y + 1), V(x, y + 1));
    if (!inside(x - 1, y)) add(V(x, y + 1), V(x, y));
  }
  const loops: Pt[][] = [];
  const xy = (v: number): Pt => [v % (w + 1), Math.floor(v / (w + 1))];
  for (const [start, list] of out) {
    while (list.length) {
      const loop: Pt[] = [xy(start)];
      let prev = start, cur = list.pop()!;
      let guard = 0;
      while (cur !== start && guard++ < 4_000_000) {
        loop.push(xy(cur));
        const nexts = out.get(cur);
        if (!nexts || !nexts.length) break;
        // at a pinch point (two choices) turn right, so diagonal pixels stay separate shapes
        let pick = 0;
        if (nexts.length > 1) {
          const [px, py] = xy(prev), [cx, cy] = xy(cur);
          const dx = cx - px, dy = cy - py;
          pick = nexts.findIndex((n) => { const [nx, ny] = xy(n); return (nx - cx) === -dy && (ny - cy) === dx; });
          if (pick < 0) pick = 0;
        }
        prev = cur;
        cur = nexts.splice(pick, 1)[0];
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

function area(p: Pt[]) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; }

/** Douglas–Peucker on a closed loop (after dropping collinear points). */
function simplify(p: Pt[], tol: number): Pt[] {
  // corners only
  const c: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length], b = p[i], d = p[(i + 1) % p.length];
    if ((b[0] - a[0]) * (d[1] - b[1]) !== (b[1] - a[1]) * (d[0] - b[0])) c.push(b);
  }
  if (c.length < 4 || tol <= 0) return c;
  const keep = new Uint8Array(c.length);
  const dp = (i: number, j: number) => {
    if (j <= i + 1) return;
    const [x1, y1] = c[i], [x2, y2] = c[j % c.length];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    let bd = 0, bi = -1;
    for (let k = i + 1; k < j; k++) { const [x, y] = c[k]; const d = Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / L; if (d > bd) { bd = d; bi = k; } }
    if (bd > tol && bi > 0) { keep[bi] = 1; dp(i, bi); dp(bi, j); }
  };
  // split the loop at its two farthest-apart points
  let far = 0, fd = 0;
  for (let k = 1; k < c.length; k++) { const d = Math.hypot(c[k][0] - c[0][0], c[k][1] - c[0][1]); if (d > fd) { fd = d; far = k; } }
  keep[0] = 1; keep[far] = 1;
  dp(0, far); dp(far, c.length);
  const r = c.filter((_, i) => keep[i]);
  return r.length >= 3 ? r : c;
}

const f = (v: number) => (Math.round(v * 100) / 100).toString();
function pathOf(loop: Pt[], smooth: boolean, s: number): string {
  const p = loop.map(([x, y]) => [x * s, y * s] as Pt);
  if (!smooth || p.length < 4) return `M${p.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
  // quadratic curves through edge midpoints (corners become gentle curves)
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = p.length;
  let d = `M${f(mid(p[n - 1], p[0])[0])} ${f(mid(p[n - 1], p[0])[1])}`;
  for (let i = 0; i < n; i++) { const m = mid(p[i], p[(i + 1) % n]); d += `Q${f(p[i][0])} ${f(p[i][1])} ${f(m[0])} ${f(m[1])}`; }
  return d + 'Z';
}

/** Trace an RGBA image (already scaled to working size) → SVG text. outW/outH: size of the SVG. */
export function traceToSvg(rgba: Uint8ClampedArray, w: number, h: number, o: TraceOpts, outW = w, outH = h): { svg: string; paths: number; colors: number } {
  const { cls, pal, alphaClass } = classify(rgba, w, h, o);
  const counts = new Map<number, number>();
  for (const v of cls) counts.set(v, (counts.get(v) ?? 0) + 1);
  const order = [...counts.keys()].filter((k) => k !== alphaClass).sort((a, b) => counts.get(b)! - counts.get(a)!);
  const s = outW / w;
  const minArea = Math.max(1, (100 - o.detail) / 12);
  const tol = 0.35 + (100 - o.detail) / 100 * 1.4;
  const hex = (c: number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const layers: string[] = [];
  let paths = 0;
  const bgFull = !o.transparentBg && alphaClass < 0;
  order.forEach((k, idx) => {
    if (idx === 0 && bgFull) { layers.push(`<rect width="${f(outW)}" height="${f(outH)}" fill="${hex(pal[k])}"/>`); return; }
    if (o.mode === 'bw' && o.transparentBg && k === 0) return;
    const loops = outlines(cls, w, h, k).filter((l) => Math.abs(area(l)) >= minArea);
    if (!loops.length) return;
    const d = loops.map((l) => pathOf(simplify(l, tol), o.smooth, s)).join('');
    paths += loops.length;
    // a hairline stroke in the same colour hides anti-aliasing seams between neighbouring colours
    layers.push(`<path fill="${hex(pal[k])}" fill-rule="evenodd"${bgFull || o.mode === 'color' ? ` stroke="${hex(pal[k])}" stroke-width="${f(Math.max(0.4, s * 0.6))}" stroke-linejoin="round"` : ''} d="${d}"/>`);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(outW)}" height="${f(outH)}" viewBox="0 0 ${f(outW)} ${f(outH)}">\n${layers.join('\n')}\n</svg>\n`;
  return { svg, paths, colors: order.length };
}
