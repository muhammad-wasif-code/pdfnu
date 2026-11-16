import { UserError } from './errors';

export type OutType = 'image/jpeg' | 'image/png' | 'image/webp';
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

export function isImage(file: File) {
  return /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
}

export interface Decoded { source: CanvasImageSource; width: number; height: number; close(): void; }

/** Decode an image honoring EXIF orientation (phone photos). */
export async function decodeImage(file: Blob, name = 'image'): Promise<Decoded> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    // Fallback (older Safari): <img> also applies EXIF orientation
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new UserError(`“${name}” couldn’t be opened. Use a JPG, PNG or WebP image.`, 'type');
    }
  }
}

export type Fit = 'stretch' | 'cover' | 'contain';

/** Draw `img` into a w×h canvas. */
export function draw(img: Decoded, w: number, h: number, fit: Fit = 'stretch', background: string | null = '#ffffff'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
  let sx = 0, sy = 0, sw = img.width, sh = img.height, dx = 0, dy = 0, dw = c.width, dh = c.height;
  if (fit === 'cover') {
    const s = Math.max(c.width / img.width, c.height / img.height);
    sw = c.width / s; sh = c.height / s; sx = (img.width - sw) / 2; sy = (img.height - sh) / 2;
  } else if (fit === 'contain') {
    const s = Math.min(c.width / img.width, c.height / img.height);
    dw = img.width * s; dh = img.height * s; dx = (c.width - dw) / 2; dy = (c.height - dh) / 2;
  }
  // Large downscales: step down by halves for better quality than one big jump
  let src: CanvasImageSource = img.source, srcW = sw, srcH = sh, srcX = sx, srcY = sy;
  while (srcW / dw > 2.2 && srcH / dh > 2.2) {
    const t = document.createElement('canvas');
    t.width = Math.round(srcW / 2); t.height = Math.round(srcH / 2);
    const tc = t.getContext('2d')!;
    tc.imageSmoothingQuality = 'high';
    tc.drawImage(src, srcX, srcY, srcW, srcH, 0, 0, t.width, t.height);
    src = t; srcX = 0; srcY = 0; srcW = t.width; srcH = t.height;
  }
  ctx.drawImage(src, srcX, srcY, srcW, srcH, dx, dy, dw, dh);
  return c;
}

export function toBlob(c: HTMLCanvasElement, type: OutType, q = 0.9): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new UserError('Your browser couldn’t encode this image.'))), type, q));
}

export interface Encoded { blob: Blob; width: number; height: number; quality: number; missed: boolean; }

/**
 * Encode under `target` bytes with the best quality possible: binary-search quality at full size,
 * then shrink dimensions step by step. Floors: quality 0.3, short side 64px.
 */
export async function encodeUnder(img: Decoded, target: number, type: OutType, opts: { maxW?: number; maxH?: number; background?: string | null; keepSize?: boolean } = {}): Promise<Encoded> {
  if (type === 'image/png') type = 'image/jpeg'; // PNG has no quality knob
  let w = img.width, h = img.height;
  const cap = Math.min(1, (opts.maxW ?? Infinity) / w, (opts.maxH ?? Infinity) / h);
  w *= cap; h *= cap;
  let smallest: Encoded | null = null;
  for (let step = 0; step < 12; step++) {
    const c = draw(img, w, h, 'stretch', opts.background === undefined ? '#ffffff' : opts.background);
    let lo = 0.3, hi = 0.92, best: Blob | null = null, bestQ = 0;
    const atLo = await toBlob(c, type, lo);
    if (!smallest || atLo.size < smallest.blob.size) smallest = { blob: atLo, width: c.width, height: c.height, quality: lo, missed: true };
    if (atLo.size <= target) {
      best = atLo; bestQ = lo;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        const b = await toBlob(c, type, mid);
        if (b.size <= target) { best = b; bestQ = mid; lo = mid; } else hi = mid;
      }
      const top = await toBlob(c, type, 0.92);
      if (top.size <= target) { best = top; bestQ = 0.92; }
      c.width = c.height = 0;
      return { blob: best, width: Math.round(w), height: Math.round(h), quality: bestQ, missed: false };
    }
    c.width = c.height = 0;
    // shrink proportionally to how far off we are (JPEG size ~ pixel count)
    const f = Math.max(0.5, Math.min(0.9, Math.sqrt(target / atLo.size) * 0.95));
    if (opts.keepSize || Math.min(w, h) * f < 64) break;
    w *= f; h *= f;
  }
  return smallest!;
}

export interface Rect { x: number; y: number; w: number; h: number; }

/** Wrap a canvas so it can be passed anywhere a Decoded image is expected. */
export function fromCanvas(c: HTMLCanvasElement): Decoded {
  return { source: c, width: c.width, height: c.height, close() { c.width = c.height = 0; } };
}

/** Crop `rect` (in source pixels) out of `img`, optionally scaling to outW×outH with high-quality downscaling. */
export function crop(img: Decoded, rect: Rect, outW?: number, outH?: number, background: string | null = null): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(rect.w));
  c.height = Math.max(1, Math.round(rect.h));
  const ctx = c.getContext('2d')!;
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(img.source, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
  if (!outW || !outH || (outW === c.width && outH === c.height)) return c;
  const scaled = draw(fromCanvas(c), outW, outH, 'stretch', background);
  c.width = c.height = 0;
  return scaled;
}

/** Rotate an image by 90° steps, returning a canvas. */
export function rotate90(img: Decoded, quarterTurns: number): HTMLCanvasElement {
  const q = ((quarterTurns % 4) + 4) % 4;
  const c = document.createElement('canvas');
  const swap = q % 2 === 1;
  c.width = swap ? img.height : img.width;
  c.height = swap ? img.width : img.height;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(img.source, -img.width / 2, -img.height / 2);
  return c;
}

/**
 * Write a DPI value into a JPEG's JFIF header so print shops and form portals
 * see the intended physical size (e.g. 300 DPI for passport photos).
 */
export async function setJpegDpi(blob: Blob, dpi: number): Promise<Blob> {
  const b = new Uint8Array(await blob.arrayBuffer());
  // FFD8 FFE0 len(2) 'JFIF\0' ver(2) units(1) Xdensity(2) Ydensity(2)
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[3] === 0xe0 && b[6] === 0x4a && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46) {
    b[13] = 1; // dots per inch
    b[14] = dpi >> 8; b[15] = dpi & 255;
    b[16] = dpi >> 8; b[17] = dpi & 255;
  }
  return new Blob([b], { type: 'image/jpeg' });
}
