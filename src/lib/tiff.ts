/**
 * Minimal TIFF reader for TIFF → PDF. Most TIFF compressions are also PDF filters, so image data is
 * passed through unchanged where possible (fax CCITT G3/G4, LZW, Deflate, JPEG): lossless and fast.
 * Other cases (PackBits, alpha, separate planes, 16-bit little-endian) are decoded here.
 */

export interface TiffChunk { x: number; y: number; w: number; h: number; data: Uint8Array; }
export interface TiffPage {
  width: number; height: number;
  /** dots per inch (x, y), when the file says */
  dpi: [number, number] | null;
  compression: number; photometric: number; bps: number; spp: number; extra: number;
  predictor: number; planar: number; fillOrder: number; t4: number; littleEndian: boolean;
  colormap?: Uint16Array; jpegTables?: Uint8Array;
  chunks: TiffChunk[];
}

const TAG = {
  NewSubfileType: 254, Width: 256, Height: 257, BitsPerSample: 258, Compression: 259, Photometric: 262, FillOrder: 266,
  StripOffsets: 273, SamplesPerPixel: 277, RowsPerStrip: 278, StripByteCounts: 279, XRes: 282, YRes: 283, Planar: 284,
  T4Options: 292, ResUnit: 296, Predictor: 317, ColorMap: 320, TileWidth: 322, TileLength: 323, TileOffsets: 324,
  TileByteCounts: 325, ExtraSamples: 338, JPEGTables: 347,
} as const;

/** Read every full-resolution image (page) of a TIFF file. */
export function readTiff(buf: Uint8Array): TiffPage[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const order = String.fromCharCode(buf[0], buf[1]);
  if (order !== 'II' && order !== 'MM') throw new Error('NOT_TIFF');
  const le = order === 'II';
  const magic = dv.getUint16(2, le);
  if (magic === 43) throw new Error('BIGTIFF');
  if (magic !== 42) throw new Error('NOT_TIFF');
  const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };
  const pages: TiffPage[] = [];
  const seen = new Set<number>();
  let ifd = dv.getUint32(4, le);
  while (ifd && ifd + 2 <= buf.length && !seen.has(ifd) && pages.length < 2000) {
    seen.add(ifd);
    const n = dv.getUint16(ifd, le);
    const tags = new Map<number, number[] | Uint8Array>();
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > buf.length) break;
      const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), count = dv.getUint32(e + 4, le);
      const size = (SIZES[type] ?? 1) * count;
      const off = size <= 4 ? e + 8 : dv.getUint32(e + 8, le);
      if (off + size > buf.length) continue;
      if (type === 7 || type === 1 || type === 2 || type === 6) {
        if (tag === TAG.JPEGTables || type === 7) { tags.set(tag, buf.subarray(off, off + size)); continue; }
      }
      const vals: number[] = [];
      for (let k = 0; k < count && k < 1_000_000; k++) {
        const p = off + k * (SIZES[type] ?? 1);
        switch (type) {
          case 1: case 2: case 7: vals.push(buf[p]); break;
          case 6: vals.push(dv.getInt8(p)); break;
          case 3: vals.push(dv.getUint16(p, le)); break;
          case 8: vals.push(dv.getInt16(p, le)); break;
          case 4: case 13: vals.push(dv.getUint32(p, le)); break;
          case 9: vals.push(dv.getInt32(p, le)); break;
          case 5: vals.push(dv.getUint32(p, le) / (dv.getUint32(p + 4, le) || 1)); break;
          case 10: vals.push(dv.getInt32(p, le) / (dv.getInt32(p + 4, le) || 1)); break;
          case 11: vals.push(dv.getFloat32(p, le)); break;
          case 12: vals.push(dv.getFloat64(p, le)); break;
          default: vals.push(0);
        }
      }
      tags.set(tag, vals);
    }
    ifd = ifd + 2 + n * 12 + 4 <= buf.length ? dv.getUint32(ifd + 2 + n * 12, le) : 0;
    const v = (t: number, d = 0) => { const x = tags.get(t); return x && !(x instanceof Uint8Array) && x.length ? x[0] : d; };
    const arr = (t: number) => { const x = tags.get(t); return x instanceof Uint8Array ? Array.from(x) : x ?? []; };
    if (v(TAG.NewSubfileType) & 1) continue; // thumbnail / reduced-resolution copy
    const width = v(TAG.Width), height = v(TAG.Height);
    if (!width || !height) continue;
    const spp = v(TAG.SamplesPerPixel, 1);
    const bps = v(TAG.BitsPerSample, 1);
    const compression = v(TAG.Compression, 1);
    const photometric = v(TAG.Photometric, compression >= 2 && compression <= 4 ? 0 : spp >= 3 ? 2 : 1);
    const planar = v(TAG.Planar, 1);
    const unit = v(TAG.ResUnit, 2);
    const xr = v(TAG.XRes), yr = v(TAG.YRes);
    const dpi: [number, number] | null = xr > 0 && yr > 0 && unit !== 1 ? (unit === 3 ? [xr * 2.54, yr * 2.54] : [xr, yr]) : null;
    const chunks: TiffChunk[] = [];
    const tw = v(TAG.TileWidth), th = v(TAG.TileLength);
    if (tw && th) {
      const offs = arr(TAG.TileOffsets), counts = arr(TAG.TileByteCounts);
      const across = Math.ceil(width / tw), down = Math.ceil(height / th);
      const planes = planar === 2 ? spp : 1;
      for (let i = 0; i < offs.length && i < across * down * planes; i++) {
        const t = i % (across * down);
        chunks.push({ x: (t % across) * tw, y: Math.floor(t / across) * th, w: tw, h: th, data: buf.subarray(offs[i], offs[i] + (counts[i] ?? 0)) });
      }
    } else {
      const offs = arr(TAG.StripOffsets), counts = arr(TAG.StripByteCounts);
      const rps = Math.min(height, v(TAG.RowsPerStrip, height) || height);
      const perPlane = Math.ceil(height / rps);
      for (let i = 0; i < offs.length; i++) {
        const s = i % perPlane;
        const y = s * rps;
        // a missing byte count on a single strip means "to the end of the file"
        const len = counts[i] ?? (offs.length === 1 ? buf.length - offs[i] : 0);
        chunks.push({ x: 0, y, w: width, h: Math.min(rps, height - y), data: buf.subarray(offs[i], offs[i] + len) });
      }
    }
    const cm = arr(TAG.ColorMap);
    const jt = tags.get(TAG.JPEGTables);
    pages.push({
      width, height, dpi, compression, photometric, bps, spp, extra: arr(TAG.ExtraSamples).length, predictor: v(TAG.Predictor, 1), planar,
      fillOrder: v(TAG.FillOrder, 1), t4: v(TAG.T4Options), littleEndian: le,
      colormap: cm.length ? Uint16Array.from(cm) : undefined, jpegTables: jt instanceof Uint8Array ? jt : undefined, chunks,
    });
  }
  return pages;
}

// ───────────────────── decoders for the cases PDF can't pass through ─────────────────────

export function unpackBits(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let i = 0, o = 0;
  while (i < src.length && o < expected) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) { const c = Math.min(n + 1, expected - o, src.length - i); out.set(src.subarray(i, i + c), o); i += n + 1; o += c; }
    else if (n !== -128) { const c = Math.min(1 - n, expected - o); out.fill(src[i++], o, o + c); o += c; }
  }
  return out;
}

/** TIFF LZW (MSB-first codes, early change). */
export function lzwDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0, bitPos = 0;
  const dict: Uint8Array[] = [];
  const reset = () => { dict.length = 258; for (let i = 0; i < 256; i++) dict[i] = Uint8Array.of(i); };
  reset();
  let width = 9, prev: Uint8Array | null = null;
  const read = () => {
    let code = 0;
    for (let k = 0; k < width; k++) { const b = src[bitPos >> 3]; if (b === undefined) return 257; code = (code << 1) | ((b >> (7 - (bitPos & 7))) & 1); bitPos++; }
    return code;
  };
  while (o < expected) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { reset(); width = 9; prev = null; continue; }
    let entry: Uint8Array;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (prev) { entry = new Uint8Array(prev.length + 1); entry.set(prev); entry[prev.length] = prev[0]; }
    else break;
    const c = Math.min(entry.length, expected - o);
    out.set(entry.subarray(0, c), o); o += c;
    if (prev) { const ne = new Uint8Array(prev.length + 1); ne.set(prev); ne[prev.length] = entry[0]; dict.push(ne); }
    prev = entry;
    const size = dict.length + 1;
    width = size >= 2048 ? 12 : size >= 1024 ? 11 : size >= 512 ? 10 : 9;
  }
  return out;
}

export async function inflate(src: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([src as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Undo TIFF horizontal differencing (predictor 2) in place. */
export function undoPredictor(data: Uint8Array, w: number, rows: number, spp: number, bps: number, le: boolean) {
  if (bps === 8) {
    const stride = w * spp;
    for (let r = 0; r < rows; r++) for (let i = spp; i < stride; i++) { const p = r * stride + i; data[p] = (data[p] + data[p - spp]) & 255; }
  } else if (bps === 16) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const stride = w * spp * 2;
    for (let r = 0; r < rows; r++) for (let i = spp; i < w * spp; i++) { const p = r * stride + i * 2; dv.setUint16(p, (dv.getUint16(p, le) + dv.getUint16(p - spp * 2, le)) & 0xffff, le); }
  }
}

const REV = (() => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) { let r = 0; for (let b = 0; b < 8; b++) r |= ((i >> b) & 1) << (7 - b); t[i] = r; } return t; })();
export const reverseBits = (d: Uint8Array) => d.map((b) => REV[b]);

/** Decode one chunk to raw samples (rows × bytesPerRow) for compressions we handle ourselves. */
export async function decodeChunk(p: TiffPage, c: TiffChunk, spp: number): Promise<Uint8Array> {
  const rowBytes = Math.ceil((c.w * spp * p.bps) / 8);
  const size = rowBytes * c.h;
  let raw: Uint8Array;
  switch (p.compression) {
    case 1: raw = c.data.slice(0, size); break;
    case 32773: raw = unpackBits(c.data, size); break;
    case 5: raw = lzwDecode(c.data, size); break;
    case 8: case 32946: raw = (await inflate(c.data)).slice(0, size); break;
    default: throw new Error('UNSUPPORTED_COMPRESSION');
  }
  if (raw.length < size) { const r = new Uint8Array(size); r.set(raw); raw = r; }
  if (p.predictor === 2) undoPredictor(raw, c.w, c.h, spp, p.bps, p.littleEndian);
  if (p.bps === 16 && p.littleEndian) for (let i = 0; i + 1 < raw.length; i += 2) { const t = raw[i]; raw[i] = raw[i + 1]; raw[i + 1] = t; }
  return raw;
}
