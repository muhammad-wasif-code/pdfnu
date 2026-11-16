import { openPdf } from './pdfjs';

export interface ThumbJob { cancel(): void; done: Promise<number>; }

/**
 * Render small JPEG thumbnails for pages of a PDF (sequentially, to keep memory low).
 * onThumb(pageIndex, objectUrl, aspect) fires as each page is ready. Returns page count.
 */
export function renderThumbnails(
  data: Uint8Array,
  width: number,
  onThumb: (index: number, url: string, aspect: number) => void,
  onCount?: (n: number) => void,
  only?: number[],
): ThumbJob {
  let cancelled = false;
  const done = (async () => {
    const doc = await openPdf(data.slice()); // pdf.js detaches the buffer it's given
    try {
      onCount?.(doc.numPages);
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const list = only ?? [...Array(doc.numPages).keys()];
      for (const i of list) {
        if (cancelled) break;
        const page = await doc.getPage(i + 1);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (width * dpr) / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d', { alpha: false })!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, canvas } as any).promise;
        page.cleanup();
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.75));
        canvas.width = canvas.height = 0;
        if (blob && !cancelled) onThumb(i, URL.createObjectURL(blob), base.height / base.width);
      }
      return doc.numPages;
    } finally {
      await doc.destroy();
    }
  })();
  return { cancel: () => { cancelled = true; }, done };
}
