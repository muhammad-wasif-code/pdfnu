/** pdf.js image objects → canvas (browser only). */
/** Convert a pdf.js image object to a canvas, whatever internal form it has. */
export function toCanvas(img: any): HTMLCanvasElement | null {
  const w = img?.width, h = img?.height;
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return c; }
  if (!img.data) return null;
  const out = ctx.createImageData(w, h);
  const src: Uint8Array = img.data, dst = out.data;
  if (img.kind === 3) dst.set(src.subarray(0, dst.length));
  else if (img.kind === 2) { for (let i = 0, j = 0; j < dst.length; i += 3, j += 4) { dst[j] = src[i]; dst[j + 1] = src[i + 1]; dst[j + 2] = src[i + 2]; dst[j + 3] = 255; } }
  else if (img.kind === 1) {
    const rowBytes = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      const j = (y * w + x) * 4, v = bit ? 255 : 0;
      dst[j] = dst[j + 1] = dst[j + 2] = v; dst[j + 3] = 255;
    }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return c;
}

export function hasAlpha(c: HTMLCanvasElement) {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) return true;
  return false;
}

/** A pdf.js image object → PNG (with transparency) or JPEG bytes. */
export async function imageBytes(img: any): Promise<Uint8Array | null> {
  const c = toCanvas(img);
  if (!c) return null;
  const png = hasAlpha(c);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.92));
  c.width = c.height = 0;
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
