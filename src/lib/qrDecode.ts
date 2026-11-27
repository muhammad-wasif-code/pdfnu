/**
 * QR Code decoder for photos and screenshots (pure TypeScript): adaptive binarisation, finder-pattern
 * detection, perspective correction (using the bottom-right alignment pattern when present),
 * format/version reading, Reed–Solomon error correction and segment parsing (numeric, alphanumeric,
 * byte/UTF-8, ECI). Normal and inverted (light-on-dark) codes, mirrored codes too.
 */
import { EXP, LOG, gmul, sizeOf, blocksFor, dataPositions, MASKS, formatBits, versionBits, type Ecc } from './qr';

type P = { x: number; y: number };

// ───────── binarisation (local mean in blocks, like most mobile scanners) ─────────
function binarise(gray: Uint8Array, w: number, h: number): Uint8Array {
  const B = 8, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const mean = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let s = 0, n = 0, lo = 255, hi = 0;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) { const v = gray[y * w + x]; s += v; n++; if (v < lo) lo = v; if (v > hi) hi = v; }
    // flat blocks take the neighbourhood's verdict (avoid noise in empty areas)
    mean[by * bw + bx] = hi - lo < 24 ? lo / 2 : s / n;
  }
  const out = new Uint8Array(w * h);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = by + dy, xx = bx + dx; if (yy < 0 || xx < 0 || yy >= bh || xx >= bw) continue; s += mean[yy * bw + xx]; n++; }
    const t = s / n;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) out[y * w + x] = gray[y * w + x] < t ? 1 : 0;
  }
  return out;
}

// ───────── finder patterns ─────────
interface Finder { x: number; y: number; size: number; count: number; }

function ratioOk(r: number[]): boolean {
  const total = r.reduce((a, b) => a + b, 0);
  if (total < 7) return false;
  const m = total / 7, v = m * 0.75;
  return Math.abs(m - r[0]) < v && Math.abs(m - r[1]) < v && Math.abs(3 * m - r[2]) < 3 * v && Math.abs(m - r[3]) < v && Math.abs(m - r[4]) < v;
}

/** Run lengths through (cx, cy) along direction (dx, dy); returns centre offset and total, or null. */
function cross(bin: Uint8Array, w: number, h: number, cx: number, cy: number, dx: number, dy: number, maxCount: number): { c: number; total: number } | null {
  const at = (k: number) => { const x = Math.round(cx + dx * k), y = Math.round(cy + dy * k); return x < 0 || y < 0 || x >= w || y >= h ? -1 : bin[y * w + x]; };
  const r = [0, 0, 0, 0, 0];
  let k = 0;
  while (at(k) === 1) { r[2]++; k--; }
  while (at(k) === 0 && r[1] <= maxCount) { r[1]++; k--; }
  while (at(k) === 1 && r[0] <= maxCount) { r[0]++; k--; }
  const start = k + 1;
  k = 1;
  while (at(k) === 1) { r[2]++; k++; }
  while (at(k) === 0 && r[3] <= maxCount) { r[3]++; k++; }
  while (at(k) === 1 && r[4] <= maxCount) { r[4]++; k++; }
  if (!ratioOk(r)) return null;
  const total = r.reduce((a, b) => a + b, 0);
  return { c: start + r[0] + r[1] + r[2] / 2 - 0.5, total };
}

function findFinders(bin: Uint8Array, w: number, h: number): Finder[] {
  const found: Finder[] = [];
  const step = Math.max(1, Math.floor(h / 500));
  const runs: number[] = [], starts: number[] = [], colors: number[] = [];
  for (let y = 0; y < h; y += step) {
    // run-length encode the row
    runs.length = starts.length = colors.length = 0;
    let x = 0;
    while (x < w) { const c = bin[y * w + x]; let e = x; while (e < w && bin[y * w + e] === c) e++; runs.push(e - x); starts.push(x); colors.push(c); x = e; }
    for (let i = 2; i + 2 < runs.length; i++) {
      if (colors[i] !== 1) continue;
      const r = [runs[i - 2], runs[i - 1], runs[i], runs[i + 1], runs[i + 2]];
      if (!ratioOk(r)) continue;
      const total = r.reduce((s2, v) => s2 + v, 0);
      const cx = starts[i] + runs[i] / 2 - 0.5;
      const vert = cross(bin, w, h, cx, y, 0, 1, total);
      if (!vert) continue;
      const cy = y + vert.c;
      const hor = cross(bin, w, h, cx, cy, 1, 0, total);
      if (!hor) continue;
      const fx = cx + hor.c, size = (hor.total + vert.total) / 14;
      if (!cross(bin, w, h, fx, cy, 1, 1, total * 1.6)) continue;
      const near = found.find((f) => Math.abs(f.x - fx) < f.size * 3 && Math.abs(f.y - cy) < f.size * 3);
      if (near) { near.x = (near.x * near.count + fx) / (near.count + 1); near.y = (near.y * near.count + cy) / (near.count + 1); near.size = (near.size * near.count + size) / (near.count + 1); near.count++; }
      else found.push({ x: fx, y: cy, size, count: 1 });
    }
  }
  return found.filter((f) => f.count >= 2 || found.length <= 3).sort((a, b) => b.count - a.count).slice(0, 12);
}

/** The three finders forming the best right-angled corner: [topLeft, topRight, bottomLeft]. */
function pickTriple(fs: Finder[]): [Finder, Finder, Finder] | null {
  let best: [Finder, Finder, Finder] | null = null, bestScore = Infinity;
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) for (let k = j + 1; k < fs.length; k++) {
    const t = [fs[i], fs[j], fs[k]];
    const ms = (t[0].size + t[1].size + t[2].size) / 3;
    if (t.some((f) => Math.abs(f.size - ms) > ms * 0.5)) continue;
    // the corner is the vertex opposite the longest side
    const d = (a: Finder, b: Finder) => Math.hypot(a.x - b.x, a.y - b.y);
    const sides = [[d(t[1], t[2]), 0], [d(t[0], t[2]), 1], [d(t[0], t[1]), 2]].sort((a, b) => b[0] - a[0]);
    const tl = t[sides[0][1]], o = t.filter((x) => x !== tl);
    const a = d(tl, o[0]), b = d(tl, o[1]), c = sides[0][0];
    if (a < ms * 7 || b < ms * 7) continue;
    const score = Math.abs(a - b) / Math.max(a, b) + Math.abs(c - Math.hypot(a, b)) / c * 2;
    if (score < bestScore) {
      bestScore = score;
      // orientation: topRight is clockwise from bottomLeft around topLeft (image y down)
      const cr = (o[0].x - tl.x) * (o[1].y - tl.y) - (o[0].y - tl.y) * (o[1].x - tl.x);
      best = cr > 0 ? [tl, o[0], o[1]] : [tl, o[1], o[0]];
    }
  }
  return bestScore < 0.6 ? best : null;
}

// ───────── perspective ─────────
type H = number[];
/** Homography mapping unit-square corners (0,0),(1,0),(1,1),(0,1) to the given points. */
function squareToQuad(p: P[]): H {
  const [p0, p1, p2, p3] = p;
  const dx3 = p0.x - p1.x + p2.x - p3.x, dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) return [p1.x - p0.x, p2.x - p1.x, p0.x, p1.y - p0.y, p2.y - p1.y, p0.y, 0, 0, 1];
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + hh * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + hh * p3.y, p0.y, g, hh, 1];
}
function invertH(m: H): H {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
}
const mulH = (a: H, b: H): H => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
const apply = (m: H, x: number, y: number): P => { const z = m[6] * x + m[7] * y + m[8]; return { x: (m[0] * x + m[1] * y + m[2]) / z, y: (m[3] * x + m[4] * y + m[5]) / z }; };
function quadToQuad(src: P[], dst: P[]): H { return mulH(squareToQuad(dst), invertH(squareToQuad(src))); }

/** Look for the alignment pattern (dark centre, light ring, dark ring) near a guess. */
function findAlignment(bin: Uint8Array, w: number, h: number, guess: P, module: number, reach = 4): P | null {
  const R = Math.max(4, module * reach);
  let best: P | null = null, bestScore = -Infinity;
  const at = (x: number, y: number) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : bin[yi * w + xi]; };
  const st = Math.max(1, module / 3);
  for (let y = guess.y - R; y <= guess.y + R; y += st) for (let x = guess.x - R; x <= guess.x + R; x += st) {
    if (!at(x, y)) continue;
    let s = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      s += at(x + dx * module, y + dy * module) ? -1 : 1; // light ring
      s += at(x + dx * module * 2, y + dy * module * 2) ? 1 : -1; // dark ring
    }
    s -= Math.hypot(x - guess.x, y - guess.y) / module * (0.3 / reach * 4);
    if (s > bestScore) { bestScore = s; best = { x, y }; }
  }
  return bestScore >= 12 ? best : null;
}

// ───────── Reed–Solomon decoding ─────────
const gdiv = (a: number, b: number) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);
const ginv = (a: number) => EXP[255 - LOG[a]];
const gpow = (e: number) => EXP[((e % 255) + 255) % 255];

/** Correct a block in place; returns false when there are too many errors. */
function rsCorrect(cw: number[], ecLen: number): boolean {
  const n = cw.length;
  const synd: number[] = [];
  let bad = false;
  for (let i = 0; i < ecLen; i++) { let s = 0; for (let j = 0; j < n; j++) s = gmul(s, gpow(i)) ^ cw[j]; synd.push(s); if (s) bad = true; }
  if (!bad) return true;
  // Berlekamp–Massey
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let i = 0; i < ecLen; i++) {
    let d = synd[i];
    for (let j = 1; j <= L; j++) d ^= gmul(C[j] ?? 0, synd[i - j]);
    if (d === 0) { m++; continue; }
    const T = C.slice();
    const coef = gdiv(d, b);
    const need = B.length + m;
    while (C.length < need) C.push(0);
    for (let j = 0; j < B.length; j++) C[j + m] ^= gmul(coef, B[j]);
    if (2 * L <= i) { L = i + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  // Chien search: error at position p (from the end) when C(α^-p) = 0
  const errs: number[] = [];
  for (let p = 0; p < n; p++) {
    let v = 0;
    for (let j = C.length - 1; j >= 0; j--) v = gmul(v, gpow(-p)) ^ C[j];
    if (v === 0) errs.push(p);
  }
  if (errs.length !== L || L * 2 > ecLen) return false;
  // Forney
  const omega: number[] = new Array(ecLen).fill(0);
  for (let i = 0; i < ecLen; i++) for (let j = 0; j <= i && j < C.length; j++) omega[i] ^= gmul(C[j], synd[i - j]);
  for (const p of errs) {
    const xi = gpow(p), xinv = ginv(xi);
    let num = 0; for (let i = ecLen - 1; i >= 0; i--) num = gmul(num, xinv) ^ omega[i];
    let den = 0; for (let j = 1; j < C.length; j += 2) den ^= gmul(C[j], gpow(-p * (j - 1)));
    if (!den) return false;
    const mag = gmul(xi, gdiv(num, den));
    cw[n - 1 - p] ^= mag;
  }
  // verify
  for (let i = 0; i < ecLen; i++) { let s = 0; for (let j = 0; j < n; j++) s = gmul(s, gpow(i)) ^ cw[j]; if (s) return false; }
  return true;
}

// ───────── reading the grid ─────────
const FORMATS = (['L', 'M', 'Q', 'H'] as Ecc[]).flatMap((e) => Array.from({ length: 8 }, (_, mk) => ({ e, mk, bits: formatBits(e, mk) })));
const popcount = (v: number) => { let c = 0; while (v) { c += v & 1; v >>>= 1; } return c; };

function readGrid(grid: Uint8Array, n: number): string | null {
  const g = (x: number, y: number) => grid[y * n + x];
  // format: both copies, nearest valid word
  let f1 = 0, f2 = 0;
  for (let i = 0; i <= 5; i++) f1 |= g(8, i) << i;
  f1 |= g(8, 7) << 6 | g(8, 8) << 7 | g(7, 8) << 8;
  for (let i = 9; i < 15; i++) f1 |= g(14 - i, 8) << i;
  for (let i = 0; i < 8; i++) f2 |= g(n - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) f2 |= g(8, n - 15 + i) << i;
  let best = FORMATS[0], bd = 99;
  for (const f of FORMATS) { const d = Math.min(popcount(f.bits ^ f1), popcount(f.bits ^ f2)); if (d < bd) { bd = d; best = f; } }
  if (bd > 3) return null;
  let version = (n - 17) / 4;
  if (version >= 7) {
    let v1 = 0;
    for (let i = 0; i < 18; i++) v1 |= g(n - 11 + (i % 3), Math.floor(i / 3)) << i;
    let bv = version, vd = 99;
    for (let v = 7; v <= 40; v++) { const d = popcount(versionBits(v) ^ v1); if (d < vd) { vd = d; bv = v; } }
    if (vd <= 3 && sizeOf(bv) === n) version = bv;
  }
  if (!Number.isInteger(version) || version < 1 || version > 40) return null;
  const pos = dataPositions(version);
  const mask = MASKS[best.mk];
  const bytes: number[] = [];
  for (let i = 0; i + 7 < pos.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) { const [x, y] = pos[i + k]; b = (b << 1) | (g(x, y) ^ (mask(x, y) ? 1 : 0)); }
    bytes.push(b);
  }
  // de-interleave
  const { ec, groups } = blocksFor(version, best.e);
  const blocks: number[][] = [];
  for (const [count, len] of groups) for (let i = 0; i < count; i++) blocks.push(new Array(len).fill(0));
  const maxD = Math.max(...blocks.map((b) => b.length));
  let k = 0;
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) b[i] = bytes[k++];
  const ecb = blocks.map(() => new Array(ec).fill(0));
  for (let i = 0; i < ec; i++) for (const e of ecb) e[i] = bytes[k++];
  const data: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const cw = [...blocks[i], ...ecb[i]];
    if (!rsCorrect(cw, ec)) return null;
    data.push(...cw.slice(0, blocks[i].length));
  }
  return parseSegments(data, version);
}

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
function parseSegments(data: number[], v: number): string | null {
  let bit = 0;
  const read = (n: number) => { let r = 0; for (let i = 0; i < n; i++) { const byte = data[bit >> 3] ?? 0; r = (r << 1) | ((byte >> (7 - (bit & 7))) & 1); bit++; } return r; };
  let out = '';
  let enc = 'utf-8';
  const bytes: number[] = [];
  const flush = () => { if (!bytes.length) return; try { out += new TextDecoder(enc, { fatal: enc === 'utf-8' }).decode(Uint8Array.from(bytes)); } catch { out += new TextDecoder('iso-8859-1').decode(Uint8Array.from(bytes)); } bytes.length = 0; };
  while (bit + 4 <= data.length * 8) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode === 7) { const e = read(8); enc = e === 26 ? 'utf-8' : e === 3 || e === 1 ? 'iso-8859-1' : e === 20 ? 'shift-jis' : 'utf-8'; continue; }
    if (mode === 1) { flush(); let n = read(v < 10 ? 10 : v < 27 ? 12 : 14); while (n >= 3) { out += String(read(10)).padStart(3, '0'); n -= 3; } if (n === 2) out += String(read(7)).padStart(2, '0'); else if (n === 1) out += String(read(4)); }
    else if (mode === 2) { flush(); let n = read(v < 10 ? 9 : v < 27 ? 11 : 13); while (n >= 2) { const x = read(11); out += ALNUM[Math.floor(x / 45)] + ALNUM[x % 45]; n -= 2; } if (n) out += ALNUM[read(6)]; }
    else if (mode === 4) { const n = read(v < 10 ? 8 : 16); for (let i = 0; i < n; i++) bytes.push(read(8)); }
    else if (mode === 8) { flush(); const n = read(v < 10 ? 8 : v < 27 ? 10 : 12); const sj: number[] = []; for (let i = 0; i < n; i++) { let c = read(13); c = ((Math.floor(c / 0xc0)) << 8) | (c % 0xc0); c += c < 0x1f00 ? 0x8140 : 0xc140; sj.push(c >> 8, c & 255); } try { out += new TextDecoder('shift-jis').decode(Uint8Array.from(sj)); } catch { /* skip */ } }
    else if (mode === 3) { read(16); } // structured append header
    else return out || null;
  }
  flush();
  return out;
}

function sampleAndRead(bin: Uint8Array, w: number, h: number, tl: Finder, tr: Finder, bl: Finder): string | null {
  const module = (tl.size + tr.size + bl.size) / 3;
  const dist = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(bl.x - tl.x, bl.y - tl.y)) / 2;
  const est = Math.round(dist / module) + 7;
  // try the estimated size and its neighbours (n = 17 + 4v)
  const cands = new Set<number>();
  for (const d of [0, -4, 4, -8, 8]) { const n = Math.round((est - 17) / 4) * 4 + 17 + d; if (n >= 21 && n <= 177) cands.add(n); }
  for (const n of cands) {
    const brGuess = { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y };
    const mod = dist / (n - 7);
    const attempts: { src: P[]; dst: P[] }[] = [];
    if (n > 21) {
      // expected alignment centre, three modules in from the bottom-right finder-equivalent
      const k = (n - 10) / (n - 7);
      const guess = { x: tl.x + (brGuess.x - tl.x) * k, y: tl.y + (brGuess.y - tl.y) * k };
      // tilted photos move the pattern away from the parallelogram guess: widen the search step by step
      const seen = new Set<string>();
      for (const reach of [4, 8, 14]) {
        const al = findAlignment(bin, w, h, guess, mod, reach);
        if (!al || seen.has(`${al.x|0},${al.y|0}`)) continue;
        seen.add(`${al.x|0},${al.y|0}`);
        attempts.push({ src: [{ x: 3.5, y: 3.5 }, { x: n - 3.5, y: 3.5 }, { x: n - 6.5, y: n - 6.5 }, { x: 3.5, y: n - 3.5 }], dst: [tl, tr, al, bl] });
      }
    }
    attempts.push({ src: [{ x: 3.5, y: 3.5 }, { x: n - 3.5, y: 3.5 }, { x: n - 3.5, y: n - 3.5 }, { x: 3.5, y: n - 3.5 }], dst: [tl, tr, brGuess, bl] });
    for (const a of attempts) {
      const H = quadToQuad(a.src, a.dst);
      const grid = new Uint8Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const p = apply(H, x + 0.5, y + 0.5);
        const xi = Math.round(p.x), yi = Math.round(p.y);
        grid[y * n + x] = xi >= 0 && yi >= 0 && xi < w && yi < h ? bin[yi * w + xi] : 0;
      }
      const text = readGrid(grid, n);
      if (text !== null) return text;
      // mirrored codes (some printers and selfie cameras)
      const mir = new Uint8Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) mir[y * n + x] = grid[x * n + y];
      const t2 = readGrid(mir, n);
      if (t2 !== null) return t2;
    }
  }
  return null;
}

/** Decode a QR code from RGBA pixels. */
export function decodeQr(rgba: Uint8ClampedArray, w: number, h: number): string | null {
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  for (const invert of [false, true]) {
    let bin = binarise(gray, w, h);
    if (invert) bin = bin.map((v) => 1 - v);
    const fs = findFinders(bin, w, h);
    if (fs.length < 3) continue;
    // try the best few triples
    const tried = new Set<string>();
    for (let attempt = 0; attempt < 4; attempt++) {
      const pool = fs.filter((f) => !tried.has(`${f.x|0},${f.y|0}`) || attempt === 0);
      const t = pickTriple(attempt === 0 ? fs : pool);
      if (!t) break;
      const r = sampleAndRead(bin, w, h, t[0], t[1], t[2]);
      if (r !== null) return r;
      tried.add(`${t[0].x|0},${t[0].y|0}`);
      fs.splice(fs.indexOf(t[0]), 1);
      if (fs.length < 3) break;
    }
  }
  return null;
}
