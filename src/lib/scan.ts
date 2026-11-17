/** Photo-of-paper clean-up for Scan to PDF. Pure canvas, runs on the device. */
import { decodeImage, rotate90, fromCanvas, draw, type Rect } from './image';

export type ScanFilter = 'original' | 'auto' | 'gray' | 'bw';

/** Decode (EXIF-aware), rotate and crop a photo; result is capped at `maxSide` px on its long edge. */
export async function prepare(file: Blob, turns: number, crop: Rect | null, maxSide: number): Promise<HTMLCanvasElement> {
  const img = await decodeImage(file);
  // downscale first (phone photos are 12+ MP); keep headroom for cropping
  const s0 = Math.min(1, (maxSide * 1.6) / Math.max(img.width, img.height));
  let c = draw(img, Math.round(img.width * s0), Math.round(img.height * s0), 'stretch', '#ffffff');
  img.close();
  if (turns % 4) { const r = rotate90(fromCanvas(c), turns); c.width = c.height = 0; c = r; }
  if (crop) {
    const x = Math.round(crop.x * c.width), y = Math.round(crop.y * c.height);
    const w = Math.max(1, Math.round(crop.w * c.width)), h = Math.max(1, Math.round(crop.h * c.height));
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d')!.drawImage(c, x, y, w, h, 0, 0, w, h);
    c.width = c.height = 0; c = out;
  }
  const s = Math.min(1, maxSide / Math.max(c.width, c.height));
  if (s < 1) {
    const d = fromCanvas(c);
    const out = draw(d, Math.round(c.width * s), Math.round(c.height * s), 'stretch', '#ffffff');
    c.width = c.height = 0; c = out;
  }
  return c;
}

/** Luminance percentile from a 256-bin histogram. */
function pct(hist: Uint32Array, total: number, p: number) {
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * p) return i; }
  return 255;
}

/**
 * Estimate the paper brightness at every pixel (lighting + shadows) by shrinking the image,
 * taking a local maximum (ink is dark, so the max is paper) and blurring it back up.
 */
function paperLevel(c: HTMLCanvasElement): Uint8ClampedArray {
  const sw = Math.max(8, Math.round(c.width / 24)), sh = Math.max(8, Math.round(c.height / 24));
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(c, 0, 0, sw, sh);
  const sd = sctx.getImageData(0, 0, sw, sh);
  let lum = new Float32Array(sw * sh);
  for (let i = 0; i < lum.length; i++) lum[i] = (sd.data[i * 4] * 77 + sd.data[i * 4 + 1] * 150 + sd.data[i * 4 + 2] * 29) / 256;
  const pass = (src: Float32Array, op: 'max' | 'avg', r: number) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let m = op === 'max' ? 0 : 0, n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(sw - 1, Math.max(0, x + dx)), yy = Math.min(sh - 1, Math.max(0, y + dy));
        const v = src[yy * sw + xx];
        if (op === 'max') { if (v > m) m = v; } else { m += v; n++; }
      }
      out[y * sw + x] = op === 'max' ? m : m / n;
    }
    return out;
  };
  lum = pass(pass(lum, 'max', 2), 'avg', 2);
  for (let i = 0; i < lum.length; i++) { const v = Math.max(1, lum[i]); sd.data[i * 4] = sd.data[i * 4 + 1] = sd.data[i * 4 + 2] = v; sd.data[i * 4 + 3] = 255; }
  sctx.putImageData(sd, 0, 0);
  const big = document.createElement('canvas');
  big.width = c.width; big.height = c.height;
  const bctx = big.getContext('2d', { willReadFrequently: true })!;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, c.width, c.height);
  const bd = bctx.getImageData(0, 0, c.width, c.height).data;
  const level = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0; i < level.length; i++) level[i] = Math.max(1, bd[i * 4]);
  small.width = small.height = big.width = big.height = 0;
  return level;
}

/**
 * auto: even out lighting and whiten the paper (keeps colour)
 * gray: same, in grayscale
 * bw:   high-contrast "document" look, paper becomes pure white
 */
export function enhance(c: HTMLCanvasElement, mode: ScanFilter): HTMLCanvasElement {
  if (mode === 'original') return c;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const im = ctx.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  const paper = paperLevel(c);
  // 1) divide by the paper level: shadows and uneven light disappear, paper ≈ 255
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const k = 255 / paper[p];
    d[i] = d[i] * k; d[i + 1] = d[i + 1] * k; d[i + 2] = d[i + 2] * k;
    hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++;
  }
  // 2) levels: darkest ink → black, anything close to paper → white
  const total = d.length / 4;
  const black = Math.min(pct(hist, total, 0.005), 160);
  const white = mode === 'bw' ? 215 : mode === 'gray' ? 235 : 245;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let t = Math.min(1, Math.max(0, (v - black) / (white - black)));
    if (mode === 'bw') t = Math.pow(t, 1.8); // darker, crisper ink
    else if (mode === 'gray') t = Math.pow(t, 1.25);
    lut[v] = Math.round(t * 255);
  }
  for (let i = 0; i < d.length; i += 4) {
    if (mode === 'auto') {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    } else {
      const y = lut[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8];
      d[i] = d[i + 1] = d[i + 2] = y;
    }
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

export function toJpeg(c: HTMLCanvasElement, q = 0.85): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), 'image/jpeg', q));
}
