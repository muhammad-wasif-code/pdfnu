/**
 * Animated GIF encoder: median-cut palette shared by all frames, optional Floyd–Steinberg dithering,
 * LZW compression. Pure TypeScript (works in workers and Node).
 */

export interface GifFrame { data: Uint8ClampedArray; delay: number; } // RGBA, delay in ms

/** Median-cut palette (up to 256 colours) from sampled pixels. */
export function palette(frames: Uint8ClampedArray[], max = 256): Uint8Array {
  const samples: number[] = [];
  const total = frames.reduce((t, f) => t + f.length / 4, 0);
  const step = Math.max(1, Math.floor(total / 120000));
  let k = 0;
  for (const f of frames) for (let i = 0; i < f.length; i += 4) { if (k++ % step) continue; if (f[i + 3] < 128) continue; samples.push((f[i] << 16) | (f[i + 1] << 8) | f[i + 2]); }
  if (!samples.length) samples.push(0);
  type Box = { px: number[] };
  const boxes: Box[] = [{ px: samples }];
  const range = (b: Box, sh: number) => { let lo = 255, hi = 0; for (const p of b.px) { const v = (p >> sh) & 255; if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; };
  while (boxes.length < max) {
    // split the box with the largest channel range (weighted by population)
    let bi = -1, bestScore = 0, bestSh = 16;
    boxes.forEach((b: any, i) => {
      if (b.px.length < 2 || b.done) return;
      for (const sh of [16, 8, 0]) { const s = range(b, sh) * Math.sqrt(b.px.length); if (s > bestScore) { bestScore = s; bi = i; bestSh = sh; } }
    });
    if (bi < 0) break;
    const b = boxes[bi];
    b.px.sort((x, y) => ((x >> bestSh) & 255) - ((y >> bestSh) & 255));
    // split at the value change nearest the median, so one colour never ends up in both halves
    const val = (i: number) => (b.px[i] >> bestSh) & 255;
    const n = b.px.length, mid = n >> 1;
    let lo = mid; while (lo > 0 && val(lo) === val(lo - 1)) lo--;
    let hi = mid; while (hi < n && val(hi) === val(hi - 1)) hi++;
    const cut = lo > 0 && (hi >= n || mid - lo <= hi - mid) ? lo : hi;
    if (cut <= 0 || cut >= n) { b.px = b.px.slice(); (b as any).done = true; if (boxes.every((x: any) => x.done || x.px.length < 2)) break; continue; }
    boxes.splice(bi, 1, { px: b.px.slice(0, cut) }, { px: b.px.slice(cut) });
  }
  const pal = new Uint8Array(max * 3);
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0;
    for (const p of b.px) { r += (p >> 16) & 255; g += (p >> 8) & 255; bl += p & 255; }
    const n = b.px.length || 1;
    pal[i * 3] = Math.round(r / n); pal[i * 3 + 1] = Math.round(g / n); pal[i * 3 + 2] = Math.round(bl / n);
  });
  return pal.slice(0, Math.max(2, boxes.length) * 3);
}

function nearestFn(pal: Uint8Array) {
  const n = pal.length / 3;
  const cache = new Int16Array(32768).fill(-1);
  return (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const c = cache[key];
    if (c >= 0) return c;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const dr = pal[i * 3] - r, dg = pal[i * 3 + 1] - g, db = pal[i * 3 + 2] - b; const d = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (d < bd) { bd = d; best = i; } }
    cache[key] = best;
    return best;
  };
}

/** Map RGBA pixels to palette indexes. transparentIndex is used for alpha < 128. */
export function indexFrame(rgba: Uint8ClampedArray, w: number, h: number, pal: Uint8Array, dither: boolean, transparentIndex: number | null): Uint8Array {
  const out = new Uint8Array(w * h);
  const near = nearestFn(pal);
  const err = dither ? new Float32Array(w * h * 3) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4;
    if (transparentIndex !== null && rgba[p + 3] < 128) { out[i] = transparentIndex; continue; }
    let r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    if (err) { r = Math.min(255, Math.max(0, r + err[i * 3])); g = Math.min(255, Math.max(0, g + err[i * 3 + 1])); b = Math.min(255, Math.max(0, b + err[i * 3 + 2])); }
    const k = near(r | 0, g | 0, b | 0);
    out[i] = k;
    if (err) {
      const er = r - pal[k * 3], eg = g - pal[k * 3 + 1], eb = b - pal[k * 3 + 2];
      const spread = (dx: number, dy: number, f: number) => { const xx = x + dx, yy = y + dy; if (xx < 0 || xx >= w || yy >= h) return; const j = (yy * w + xx) * 3; err[j] += er * f; err[j + 1] += eg * f; err[j + 2] += eb * f; };
      spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
    }
  }
  return out;
}

/** GIF LZW, emitted as data sub-blocks. */
function lzw(indexes: Uint8Array, minCode: number): number[] {
  const out: number[] = [];
  let cur = 0, bits = 0;
  const block: number[] = [];
  const emit = (code: number, size: number) => {
    cur |= code << bits; bits += size;
    while (bits >= 8) { block.push(cur & 255); cur >>>= 8; bits -= 8; if (block.length === 255) { out.push(255, ...block); block.length = 0; } }
  };
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1;
  let dict = new Map<number, number>();
  emit(clear, size);
  let prefix = indexes[0];
  for (let i = 1; i < indexes.length; i++) {
    const c = indexes[i];
    const key = (prefix << 8) | c;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix, size);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear, size); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    prefix = c;
  }
  emit(prefix, size); emit(eoi, size);
  if (bits > 0) block.push(cur & 255);
  if (block.length) out.push(block.length, ...block);
  out.push(0);
  return out;
}

export function encodeGif(frames: GifFrame[], w: number, h: number, o: { loop: number; dither: boolean; transparent: boolean }): Uint8Array {
  const pal0 = palette(frames.map((f) => f.data), o.transparent ? 255 : 256);
  const n0 = pal0.length / 3;
  const transparentIndex = o.transparent ? n0 : null;
  const colors = n0 + (o.transparent ? 1 : 0);
  let depth = 1; while ((1 << depth) < colors) depth++;
  const pal = new Uint8Array((1 << depth) * 3); pal.set(pal0);
  const bytes: number[] = [];
  const u16 = (v: number) => bytes.push(v & 255, (v >> 8) & 255);
  for (const ch of 'GIF89a') bytes.push(ch.charCodeAt(0));
  u16(w); u16(h);
  bytes.push(0x80 | ((depth - 1) << 4) | (depth - 1), 0, 0);
  for (const v of pal) bytes.push(v);
  if (frames.length > 1) { bytes.push(0x21, 0xff, 11); for (const ch of 'NETSCAPE2.0') bytes.push(ch.charCodeAt(0)); bytes.push(3, 1); u16(o.loop); bytes.push(0); }
  const minCode = Math.max(2, depth);
  for (const f of frames) {
    // graphic control: delay (1/100 s), disposal 2 when transparent so frames don't pile up
    const cs = Math.max(2, Math.round(f.delay / 10));
    bytes.push(0x21, 0xf9, 4, o.transparent ? (2 << 2) | 1 : 0, cs & 255, (cs >> 8) & 255, transparentIndex ?? 0, 0);
    bytes.push(0x2c); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
    bytes.push(minCode);
    const idx = indexFrame(f.data, w, h, pal0, o.dither, transparentIndex);
    for (const b of lzw(idx, minCode)) bytes.push(b);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
