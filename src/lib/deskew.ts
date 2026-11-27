/**
 * Skew detection for scanned pages (projection-profile method). Pure functions, so they run in
 * workers, the main thread or Node tests alike.
 */

/** Ink pixels (dark on light) of a grayscale image, subsampled to at most ~maxPts points. */
export function inkPoints(gray: Uint8Array, w: number, h: number, maxPts = 60000): { xs: Float32Array; ys: Float32Array } {
  // threshold halfway between the paper level and black
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let paper = 255; for (let v = 255, best = 0; v >= 100; v--) if (hist[v] > best) { best = hist[v]; paper = v; }
  const thr = paper * 0.55;
  let count = 0;
  // ignore a margin where scanner edges and shadows live
  const mx = Math.round(w * 0.03), my = Math.round(h * 0.03);
  for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) if (gray[y * w + x] < thr) count++;
  const step = Math.max(1, Math.ceil(count / maxPts));
  const xs: number[] = [], ys: number[] = [];
  let k = 0;
  for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) if (gray[y * w + x] < thr && k++ % step === 0) { xs.push(x); ys.push(y); }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys) };
}

function score(xs: Float32Array, ys: Float32Array, deg: number, h: number): number {
  const t = Math.tan((deg * Math.PI) / 180);
  const bins = new Float64Array(h * 2 + 4);
  const off = h;
  for (let i = 0; i < xs.length; i++) {
    const b = Math.round(ys[i] - xs[i] * t) + off;
    if (b >= 0 && b < bins.length) bins[b]++;
  }
  let s = 0;
  for (let i = 1; i < bins.length; i++) { const d = bins[i] - bins[i - 1]; s += d * d; }
  return s;
}

/**
 * Angle (degrees) by which text lines slope down to the right in image coordinates.
 * Rotating the page counter-clockwise (as seen) by this angle straightens it.
 * Returns null when the page has too little ink to tell.
 */
export function detectSkew(gray: Uint8Array, w: number, h: number, maxAngle = 8): number | null {
  const { xs, ys } = inkPoints(gray, w, h);
  if (xs.length < 300) return null;
  let best = 0, bestS = -1;
  for (let a = -maxAngle; a <= maxAngle + 1e-9; a += 0.5) { const s = score(xs, ys, a, h); if (s > bestS) { bestS = s; best = a; } }
  const coarse = best;
  for (let a = coarse - 0.5; a <= coarse + 0.5 + 1e-9; a += 0.05) { const s = score(xs, ys, a, h); if (s > bestS) { bestS = s; best = a; } }
  // a flat profile (photos, blank pages) has no meaningful peak
  const flat = score(xs, ys, best + 3, h);
  if (bestS < flat * 1.15) return null;
  return Math.round(best * 100) / 100;
}
