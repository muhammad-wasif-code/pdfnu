/** Main-thread helpers for true redaction: find text positions and burn boxes into a page image. */
import { renderPage } from './render';
import { loadPdfJs } from './pdfjs';

export interface Box { x: number; y: number; w: number; h: number; }

/**
 * Find every occurrence of `query` (case-insensitive) and return boxes per page,
 * as fractions of the visible page (origin top-left). Works on the text layer; scans have none.
 */
export async function findText(pdf: any, query: string): Promise<Map<number, Box[]>> {
  const q = query.trim().toLowerCase();
  const found = new Map<number, Box[]>();
  if (!q) return found;
  const { Util } = await loadPdfJs();
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const boxes: Box[] = [];
    for (const item of content.items as any[]) {
      const s: string = item.str;
      if (!s) continue;
      const low = s.toLowerCase();
      let at = low.indexOf(q);
      if (at < 0) continue;
      const tx = Util.transform(vp.transform, item.transform);
      const fontH = Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 10;
      const angle = Math.atan2(tx[1], tx[0]);
      const len = item.width; // viewport scale is 1
      while (at >= 0) {
        const a = at / s.length, b = (at + q.length) / s.length;
        // corners of the matched run along the baseline, then the box that contains them
        const pts: [number, number][] = [];
        for (const f of [a, b]) for (const up of [0, 1]) {
          const along = len * f, rise = fontH * (up ? 0.95 : -0.25);
          pts.push([tx[4] + along * Math.cos(angle) + rise * Math.sin(angle), tx[5] + along * Math.sin(angle) - rise * Math.cos(angle)]);
        }
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const pad = fontH * 0.08;
        const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
        boxes.push({ x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height });
        at = low.indexOf(q, at + q.length);
      }
    }
    page.cleanup();
    if (boxes.length) found.set(n - 1, boxes);
  }
  return found;
}

/** Render a page, paint the boxes solid, and return it as JPEG plus its visible size in points. */
export async function flattenPage(pdf: any, index: number, boxes: Box[], color: string, dpi = 200) {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  page.cleanup();
  const canvas = await renderPage(pdf, index + 1, dpi);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  for (const b of boxes) {
    ctx.fillRect(Math.floor(b.x * canvas.width) - 1, Math.floor(b.y * canvas.height) - 1, Math.ceil(b.w * canvas.width) + 2, Math.ceil(b.h * canvas.height) + 2);
  }
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode page'))), 'image/jpeg', 0.9));
  canvas.width = canvas.height = 0;
  return { jpeg: await blob.arrayBuffer(), w: vp.width, h: vp.height };
}
