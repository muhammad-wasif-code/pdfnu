import { MAX_CANVAS_PIXELS } from './pdfjs';

/** Render a 1-based page of a pdf.js document to a white-backed canvas at `dpi`. */
export async function renderPage(doc: any, pageNo: number, dpi: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNo);
  let scale = dpi / 72;
  const base = page.getViewport({ scale: 1 });
  const px = base.width * base.height * scale * scale;
  if (px > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / px);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas } as any).promise;
  page.cleanup();
  return canvas;
}
