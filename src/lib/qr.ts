/**
 * QR Code encoder (ISO/IEC 18004): byte mode (UTF-8), numeric and alphanumeric modes, versions 1–40,
 * error correction L/M/Q/H, all 8 masks with penalty scoring. Pure TypeScript.
 * Also exports the Reed–Solomon / GF(256) pieces and tables that the decoder (qrDecode.ts) shares.
 */

export type Ecc = 'L' | 'M' | 'Q' | 'H';
export const ECC_BITS: Record<Ecc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// [ec codewords per block, blocks in group 1, data cw per block g1, blocks g2, data cw g2] per version and level (L, M, Q, H)
// prettier-ignore
const EC_TABLE: number[][][] = [
  [[7,1,19,0,0],[10,1,16,0,0],[13,1,13,0,0],[17,1,9,0,0]],[[10,1,34,0,0],[16,1,28,0,0],[22,1,22,0,0],[28,1,16,0,0]],
  [[15,1,55,0,0],[26,1,44,0,0],[18,2,17,0,0],[22,2,13,0,0]],[[20,1,80,0,0],[18,2,32,0,0],[26,2,24,0,0],[16,4,9,0,0]],
  [[26,1,108,0,0],[24,2,43,0,0],[18,2,15,2,16],[22,2,11,2,12]],[[18,2,68,0,0],[16,4,27,0,0],[24,4,19,0,0],[28,4,15,0,0]],
  [[20,2,78,0,0],[18,4,31,0,0],[18,2,14,4,15],[26,4,13,1,14]],[[24,2,97,0,0],[22,2,38,2,39],[22,4,18,2,19],[26,4,14,2,15]],
  [[30,2,116,0,0],[22,3,36,2,37],[20,4,16,4,17],[24,4,12,4,13]],[[18,2,68,2,69],[26,4,43,1,44],[24,6,19,2,20],[28,6,15,2,16]],
  [[20,4,81,0,0],[30,1,50,4,51],[28,4,22,4,23],[24,3,12,8,13]],[[24,2,92,2,93],[22,6,36,2,37],[26,4,20,6,21],[28,7,14,4,15]],
  [[26,4,107,0,0],[22,8,37,1,38],[24,8,20,4,21],[22,12,11,4,12]],[[30,3,115,1,116],[24,4,40,5,41],[20,11,16,5,17],[24,11,12,5,13]],
  [[22,5,87,1,88],[24,5,41,5,42],[30,5,24,7,25],[24,11,12,7,13]],[[24,5,98,1,99],[28,7,45,3,46],[24,15,19,2,20],[30,3,15,13,16]],
  [[28,1,107,5,108],[28,10,46,1,47],[28,1,22,15,23],[28,2,14,17,15]],[[30,5,120,1,121],[26,9,43,4,44],[28,17,22,1,23],[28,2,14,19,15]],
  [[28,3,113,4,114],[26,3,44,11,45],[26,17,21,4,22],[26,9,13,16,14]],[[28,3,107,5,108],[26,3,41,13,42],[30,15,24,5,25],[28,15,15,10,16]],
  [[28,4,116,4,117],[26,17,42,0,0],[28,17,22,6,23],[30,19,16,6,17]],[[28,2,111,7,112],[28,17,46,0,0],[30,7,24,16,25],[24,34,13,0,0]],
  [[30,4,121,5,122],[28,4,47,14,48],[30,11,24,14,25],[30,16,15,14,16]],[[30,6,117,4,118],[28,6,45,14,46],[30,11,24,16,25],[30,30,16,2,17]],
  [[26,8,106,4,107],[28,8,47,13,48],[30,7,24,22,25],[30,22,15,13,16]],[[28,10,114,2,115],[28,19,46,4,47],[28,28,22,6,23],[30,33,16,4,17]],
  [[30,8,122,4,123],[28,22,45,3,46],[30,8,23,26,24],[30,12,15,28,16]],[[30,3,117,10,118],[28,3,45,23,46],[30,4,24,31,25],[30,11,15,31,16]],
  [[30,7,116,7,117],[28,21,45,7,46],[30,1,23,37,24],[30,19,15,26,16]],[[30,5,115,10,116],[28,19,47,10,48],[30,15,24,25,25],[30,23,15,25,16]],
  [[30,13,115,3,116],[28,2,46,29,47],[30,42,24,1,25],[30,23,15,28,16]],[[30,17,115,0,0],[28,10,46,23,47],[30,10,24,35,25],[30,19,15,35,16]],
  [[30,17,115,1,116],[28,14,46,21,47],[30,29,24,19,25],[30,11,15,46,16]],[[30,13,115,6,116],[28,14,46,23,47],[30,44,24,7,25],[30,59,16,1,17]],
  [[30,12,121,7,122],[28,12,47,26,48],[30,39,24,14,25],[30,22,15,41,16]],[[30,6,121,14,122],[28,6,47,34,48],[30,46,24,10,25],[30,2,15,64,16]],
  [[30,17,122,4,123],[28,29,46,14,47],[30,49,24,10,25],[30,24,15,46,16]],[[30,4,122,18,123],[28,13,46,32,47],[30,48,24,14,25],[30,42,15,32,16]],
  [[30,20,117,4,118],[28,40,47,7,48],[30,43,24,22,25],[30,10,15,67,16]],[[30,19,118,6,119],[28,18,47,31,48],[30,34,24,34,25],[30,20,15,61,16]],
];
const LEVEL_INDEX: Record<Ecc, number> = { L: 0, M: 1, Q: 2, H: 3 };
export function blocksFor(version: number, ecc: Ecc) {
  const [ec, b1, d1, b2, d2] = EC_TABLE[version - 1][LEVEL_INDEX[ecc]];
  return { ec, groups: [[b1, d1], [b2, d2]] as [number, number][], dataCodewords: b1 * d1 + b2 * d2 };
}

// ───────── GF(256) and Reed–Solomon ─────────
export const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
export const gmul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function generator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= gmul(c, EXP[i]); }); g = next; }
  return g;
}
export function rsEncode(data: number[], ecLen: number): number[] {
  const gen = generator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const f = d ^ res[0];
    res.shift(); res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= gmul(gen[i + 1], f);
  }
  return res;
}

// ───────── geometry ─────────
export const sizeOf = (v: number) => 17 + v * 4;
export function alignmentCenters(v: number): number[] {
  if (v === 1) return [];
  const num = Math.floor(v / 7) + 2;
  const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (num * 2 - 2)) * 2;
  const out = [6];
  for (let pos = sizeOf(v) - 7; out.length < num; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** Function-pattern map: true where a module is reserved (finder, timing, alignment, format, version). */
export function reserved(v: number): Uint8Array {
  const n = sizeOf(v), r = new Uint8Array(n * n);
  const set = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < n && y < n) r[y * n + x] = 1; };
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) set(cx + dx, cy + dy);
  for (let i = 0; i < n; i++) { set(6, i); set(i, 6); }
  const al = alignmentCenters(v);
  for (const ay of al) for (const ax of al) { if ((ax < 9 && ay < 9) || (ax > n - 10 && ay < 9) || (ax < 9 && ay > n - 10)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy); }
  for (let i = 0; i < 9; i++) { set(8, i); set(i, 8); }
  for (let i = 0; i < 8; i++) { set(n - 1 - i, 8); set(8, n - 1 - i); }
  if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { set(n - 11 + j, i); set(i, n - 11 + j); }
  return r;
}

export const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 15-bit format word (BCH, XOR mask) for level + mask. */
export function formatBits(ecc: Ecc, mask: number): number {
  const data = (ECC_BITS[ecc] << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  return ((data << 10) | rem) ^ 0x5412;
}
export function versionBits(v: number): number {
  let rem = v << 12;
  for (let i = 17; i >= 12; i--) if (rem & (1 << i)) rem ^= 0x1f25 << (i - 12);
  return (v << 12) | rem;
}

/** Order in which data modules are filled (zig-zag column pairs from the bottom right). */
export function dataPositions(v: number): [number, number][] {
  const n = sizeOf(v), res = reserved(v), out: [number, number][] = [];
  let up = true;
  for (let x = n - 1; x > 0; x -= 2) {
    if (x === 6) x = 5;
    for (let i = 0; i < n; i++) {
      const y = up ? n - 1 - i : i;
      for (const xx of [x, x - 1]) if (!res[y * n + xx]) out.push([xx, y]);
    }
    up = !up;
  }
  return out;
}

// ───────── data encoding ─────────
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
type Mode = 'num' | 'alnum' | 'byte';
const countBits = (mode: Mode, v: number) => (mode === 'num' ? (v < 10 ? 10 : v < 27 ? 12 : 14) : mode === 'alnum' ? (v < 10 ? 9 : v < 27 ? 11 : 13) : v < 10 ? 8 : 16);

function bitsFor(text: string, mode: Mode, v: number): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  const bytes = new TextEncoder().encode(text);
  put(mode === 'num' ? 1 : mode === 'alnum' ? 2 : 4, 4);
  put(mode === 'byte' ? bytes.length : text.length, countBits(mode, v));
  if (mode === 'num') for (let i = 0; i < text.length; i += 3) { const g = text.slice(i, i + 3); put(+g, g.length === 3 ? 10 : g.length === 2 ? 7 : 4); }
  else if (mode === 'alnum') for (let i = 0; i < text.length; i += 2) { const a = ALNUM.indexOf(text[i]); if (i + 1 < text.length) put(a * 45 + ALNUM.indexOf(text[i + 1]), 11); else put(a, 6); }
  else for (const b of bytes) put(b, 8);
  return bits;
}

export interface QrCode { size: number; version: number; ecc: Ecc; mask: number; modules: Uint8Array; /* 1 = dark */ }

export function encodeQr(text: string, opts: { ecc?: Ecc; minVersion?: number; mask?: number } = {}): QrCode {
  const ecc = opts.ecc ?? 'M';
  const mode: Mode = /^\d+$/.test(text) ? 'num' : [...text].every((c) => ALNUM.includes(c)) && text.length > 0 ? 'alnum' : 'byte';
  let version = Math.max(1, opts.minVersion ?? 1), bits: number[] = [];
  for (; version <= 40; version++) { bits = bitsFor(text, mode, version); if (bits.length <= blocksFor(version, ecc).dataCodewords * 8) break; }
  if (version > 40) throw new Error('TOO_LONG');
  const { ec, groups, dataCodewords } = blocksFor(version, ecc);
  const cap = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCodewords; pad ^= 0xec ^ 0x11) data.push(pad);
  // split into blocks, add EC, interleave
  const blocks: { d: number[]; e: number[] }[] = [];
  let k = 0;
  for (const [count, len] of groups) for (let b = 0; b < count; b++) { const d = data.slice(k, k + len); k += len; blocks.push({ d, e: rsEncode(d, ec) }); }
  const final: number[] = [];
  const maxD = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) final.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) final.push(b.e[i]);

  const n = sizeOf(version);
  const base = new Uint8Array(n * n);
  const set = (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < n && y < n) base[y * n + x] = v; };
  // finders + separators
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
    const inner = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
    const dark = inner && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
    set(ox + dx, oy + dy, dark ? 1 : 0);
  }
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 ? 0 : 1); set(i, 6, i % 2 ? 0 : 1); }
  const al = alignmentCenters(version);
  for (const ay of al) for (const ax of al) {
    if ((ax < 9 && ay < 9) || (ax > n - 10 && ay < 9) || (ax < 9 && ay > n - 10)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0);
  }
  set(8, n - 8, 1); // dark module
  if (version >= 7) { const vb = versionBits(version); for (let i = 0; i < 18; i++) { const bit = (vb >> i) & 1; const a = Math.floor(i / 3), b = (i % 3) + n - 11; set(b, a, bit); set(a, b, bit); } }
  const pos = dataPositions(version);
  const place = (mask: number) => {
    const m = base.slice();
    pos.forEach(([x, y], i) => { const bit = i < final.length * 8 ? (final[i >> 3] >> (7 - (i & 7))) & 1 : 0; m[y * n + x] = bit ^ (MASKS[mask](x, y) ? 1 : 0); });
    const fb = formatBits(ecc, mask);
    const bit = (i: number) => (fb >> i) & 1;
    const at = (x: number, y: number, v: number) => { m[y * n + x] = v; };
    for (let i = 0; i <= 5; i++) at(8, i, bit(i));
    at(8, 7, bit(6)); at(8, 8, bit(7)); at(7, 8, bit(8));
    for (let i = 9; i < 15; i++) at(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) at(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) at(8, n - 15 + i, bit(i));
    at(8, n - 8, 1);
    return m;
  };
  let best = opts.mask ?? -1, bestM: Uint8Array | null = null, bestScore = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    if (opts.mask !== undefined && mk !== opts.mask) continue;
    const m = place(mk);
    const s = penalty(m, n);
    if (s < bestScore) { bestScore = s; best = mk; bestM = m; }
  }
  return { size: n, version, ecc, mask: best, modules: bestM! };
}

function penalty(m: Uint8Array, n: number): number {
  let p = 0;
  for (let pass = 0; pass < 2; pass++) for (let a = 0; a < n; a++) {
    let run = 1;
    for (let b = 1; b < n; b++) {
      const cur = pass ? m[b * n + a] : m[a * n + b], prev = pass ? m[(b - 1) * n + a] : m[a * n + b - 1];
      if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y * n + x]; if (c === m[y * n + x + 1] && c === m[(y + 1) * n + x] && c === m[(y + 1) * n + x + 1]) p += 3; }
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let a = 0; a < n; a++) for (let b = 0; b + 11 <= n; b++) for (const pp of [pat, pat2]) {
    if (pp.every((v, i) => m[a * n + b + i] === v)) p += 40;
    if (pp.every((v, i) => m[(b + i) * n + a] === v)) p += 40;
  }
  let dark = 0; for (const v of m) dark += v;
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

// ───────── output ─────────
export interface QrStyle { fg: string; bg: string | null; margin: number; dots: 'square' | 'round'; }

export function qrToSvg(q: QrCode, s: QrStyle, logoHref?: string): string {
  const total = q.size + s.margin * 2;
  let d = '';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) {
    if (!q.modules[y * q.size + x]) continue;
    const X = x + s.margin, Y = y + s.margin;
    d += s.dots === 'round' && !inFinder(q.size, x, y) ? `M${X + 0.5} ${Y}a.5 .5 0 1 1 0 1a.5 .5 0 1 1 0-1z` : `M${X} ${Y}h1v1h-1z`;
  }
  const logo = logoHref ? (() => { const L = q.size * 0.22, o = (total - L) / 2; return `<rect x="${o - 0.6}" y="${o - 0.6}" width="${L + 1.2}" height="${L + 1.2}" rx="1" fill="${s.bg ?? '#fff'}"/><image href="${logoHref}" x="${o}" y="${o}" width="${L}" height="${L}" preserveAspectRatio="xMidYMid meet"/>`; })() : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="${s.dots === 'round' ? 'geometricPrecision' : 'crispEdges'}">${s.bg ? `<rect width="${total}" height="${total}" fill="${s.bg}"/>` : ''}<path fill="${s.fg}" d="${d}"/>${logo}</svg>`;
}
const inFinder = (n: number, x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);

/** Payload builders for common QR types. */
export const payload = {
  wifi: (ssid: string, pass: string, sec: 'WPA' | 'WEP' | 'nopass', hidden: boolean) => { const e = (s: string) => s.replace(/([\\;,:"])/g, '\\$1'); return `WIFI:T:${sec};S:${e(ssid)};${sec !== 'nopass' ? `P:${e(pass)};` : ''}${hidden ? 'H:true;' : ''};`; },
  vcard: (c: { name: string; phone: string; email: string; org: string; url: string; address: string }) => ['BEGIN:VCARD', 'VERSION:3.0', `FN:${c.name}`, `N:${c.name.split(' ').reverse().join(';')};;;`, c.org && `ORG:${c.org}`, c.phone && `TEL;TYPE=CELL:${c.phone}`, c.email && `EMAIL:${c.email}`, c.url && `URL:${c.url}`, c.address && `ADR:;;${c.address};;;;`, 'END:VCARD'].filter(Boolean).join('\n'),
  email: (to: string, subject: string, body: string) => `mailto:${to}${subject || body ? `?${[subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).join('&')}` : ''}`,
  sms: (num: string, body: string) => `SMSTO:${num}:${body}`,
  phone: (num: string) => `tel:${num.replace(/[^\d+]/g, '')}`,
  whatsapp: (num: string, body: string) => `https://wa.me/${num.replace(/\D/g, '')}${body ? `?text=${encodeURIComponent(body)}` : ''}`,
};
