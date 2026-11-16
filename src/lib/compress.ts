/**
 * PDF compression pipeline (all local):
 *   1. lossless   – pdf-lib rewrite with object streams
 *   2. Ghostscript – re-encode/downsample images (≈ /ebook → /screen)
 *   3. rasterize  – last resort for size targets: render pages to JPEG with a quality loop
 * The smallest acceptable candidate wins; the original is returned if nothing beats it.
 */
import { pdfOp } from './pdfWorker';
import { runGhostscript, type GsProfile } from './ghostscript';
import { openPdf } from './pdfjs';
import { renderPage } from './render';
import { UserError } from './errors';

export type Preset = 'smallest' | 'recommended' | 'high';

export interface CompressOptions {
  preset: Preset;
  /** bytes; when set, aim to get under this size with the best possible quality */
  target?: number | null;
}

export interface Progress {
  label: string;
  /** 0..1 or null for indeterminate */
  value: number | null;
  bestSoFar?: number;
}

export interface CompressResult {
  bytes: Uint8Array;
  method: 'original' | 'lossless' | 'ghostscript' | 'raster';
  /** true if text can no longer be selected/searched (rasterized) */
  textLost: boolean;
  /** target was requested but could not be reached at a readable quality */
  targetMissed: boolean;
  /** human description of the quality level used */
  detail: string;
}

const PROFILES: Record<Preset, GsProfile & { name: string }> = {
  high: { res: 220, q: 0.4, autoFilter: true, name: 'High quality (220 dpi images)' },
  recommended: { res: 150, q: 0.76, name: 'Recommended (150 dpi images)' },
  smallest: { res: 96, q: 1.1, name: 'Smallest (96 dpi images)' },
};

/** Ladder for size targets: best quality first. */
const TARGET_LADDER: (GsProfile & { name: string })[] = [
  { res: 150, q: 0.76, name: '150 dpi images' }, // ≈ /ebook
  { res: 110, q: 0.95, name: '110 dpi images' },
  { res: 72, q: 1.3, name: '72 dpi images' }, // ≈ /screen
];

/** Raster fallback: readable floor is 72 dpi @ JPEG 0.36 */
const RASTER_DPI = [150, 120, 96, 72];
const RASTER_Q = [0.82, 0.7, 0.58, 0.46, 0.36];

interface Candidate { bytes: Uint8Array; method: CompressResult['method']; detail: string; textLost: boolean; }

export async function compressPdf(file: File, opts: CompressOptions, onProgress: (p: Progress) => void, signal?: AbortSignal): Promise<CompressResult> {
  const original = new Uint8Array(await file.arrayBuffer());
  const target = opts.target ?? null;
  const check = () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };

  let best: Candidate = { bytes: original, method: 'original', detail: 'Original file', textLost: false };
  let bestWithText: Candidate = best;
  const consider = (c: Candidate) => {
    if (c.bytes.length < best.bytes.length) best = c;
    if (!c.textLost && c.bytes.length < bestWithText.bytes.length) bestWithText = c;
    onProgress({ ...lastProgress, bestSoFar: best.bytes.length });
  };
  let lastProgress: Progress = { label: 'Reading PDF…', value: 0.02 };
  const progress = (p: Progress) => { lastProgress = p; onProgress({ ...p, bestSoFar: best.method === 'original' ? undefined : best.bytes.length }); };
  const fits = () => target !== null && best.bytes.length <= target;

  // 0. Inspect
  progress({ label: 'Reading PDF…', value: 0.03 });
  const info = await pdfOp('inspect', [original.slice().buffer]);
  check();

  if (info.encrypted && target !== null && original.length <= target) return finish(best, target);

  if (info.encrypted) {
    // Owner-password-only PDFs open without a password; anything else is genuinely locked.
    try {
      const doc = await openPdf(original.slice());
      await doc.destroy();
    } catch (e: any) {
      if (e?.name === 'PasswordException') throw new UserError('This PDF is password-protected. Open it with its password and save an unprotected copy first.', 'encrypted');
      throw e;
    }
  }

  // 1. Lossless
  if (!info.encrypted) {
    progress({ label: 'Optimizing PDF structure (lossless)…', value: 0.08 });
    try {
      const out = await pdfOp('lossless', [original.slice().buffer]);
      consider({ bytes: out, method: 'lossless', detail: 'Lossless optimization', textLost: false });
    } catch (e) {
      console.warn('lossless step failed', e);
    }
    check();
    if (target !== null && fits()) return finish(best, target);
  }

  // 2. Ghostscript
  const ladder = target !== null ? TARGET_LADDER : [PROFILES[opts.preset]];
  for (let i = 0; i < ladder.length; i++) {
    const p = ladder[i];
    progress({
      label: i === 0 ? 'Compressing images…' : `Trying stronger compression (${p.name})…`,
      value: null,
    });
    try {
      const out = await runGhostscript(original, p);
      consider({ bytes: out, method: 'ghostscript', detail: p.name, textLost: false });
    } catch (e: any) {
      if (/password/i.test(String(e?.message))) throw new UserError('This PDF is password-protected. Open it with its password and save an unprotected copy first.', 'encrypted');
      console.warn('ghostscript failed', e);
      if (i === 0 && best.method === 'original' && info.encrypted) throw e;
    }
    check();
    if (target !== null && fits()) return finish(best, target);
  }

  if (target === null) return finish(best, null);

  // 3. Rasterize (last resort for size targets)
  const raster = await rasterizeToTarget(original, info.pageCount, target, (p) => progress(p), check);
  if (raster) consider(raster);
  // Target unreachable either way → keep selectable text unless rasterizing is clearly smaller.
  if (best.bytes.length > target && best.textLost && bestWithText.bytes.length <= best.bytes.length * 1.15) best = bestWithText;
  return finish(best, target);
}

function finish(best: Candidate, target: number | null): CompressResult {
  return {
    bytes: best.bytes,
    method: best.method,
    textLost: best.textLost,
    targetMissed: target !== null && best.bytes.length > target,
    detail: best.detail,
  };
}

async function rasterizeToTarget(
  data: Uint8Array,
  pageCount: number,
  target: number,
  progress: (p: Progress) => void,
  check: () => void,
): Promise<Candidate | null> {
  progress({ label: 'Rendering pages for maximum compression…', value: 0 });
  const doc = await openPdf(data.slice());
  const overhead = 2_000 + pageCount * 600;
  try {
    // Estimate per-quality page size from a sample of pages at each dpi, then commit to
    // the best (dpi, quality) combo that is predicted to fit. Verify; step down if not.
    const sample = sampleIndexes(pageCount, 3);
    const combos: { dpi: number; q: number; est: number }[] = [];
    for (const dpi of RASTER_DPI) {
      const sizes = RASTER_Q.map(() => 0);
      for (const idx of sample) {
        const canvas = await renderPage(doc, idx + 1, dpi);
        for (let qi = 0; qi < RASTER_Q.length; qi++) sizes[qi] += (await toJpeg(canvas, RASTER_Q[qi])).byteLength;
        canvas.width = canvas.height = 0;
        check();
      }
      RASTER_Q.forEach((q, qi) => combos.push({ dpi, q, est: (sizes[qi] / sample.length) * pageCount + overhead }));
    }
    // Ordered best quality → worst; first that fits wins (with 5% safety margin)
    const ordered = combos; // already dpi desc, q desc
    let startAt = ordered.findIndex((c) => c.est * 1.05 <= target);
    if (startAt === -1) startAt = ordered.length - 1; // can't fit: produce the smallest readable result

    let smallest: Candidate | null = null;
    for (let ci = startAt; ci < ordered.length; ci++) {
      const { dpi, q } = ordered[ci];
      const pages: { jpeg: ArrayBuffer; w: number; h: number }[] = [];
      for (let n = 1; n <= pageCount; n++) {
        progress({ label: `Rendering page ${n} of ${pageCount} (${dpi} dpi)…`, value: n / pageCount });
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const canvas = await renderPage(doc, n, dpi);
        pages.push({ jpeg: await toJpeg(canvas, q), w: vp.width, h: vp.height });
        canvas.width = canvas.height = 0;
        check();
      }
      progress({ label: 'Building compressed PDF…', value: null });
      const bytes = await pdfOp('jpegsToPdf', [pages], pages.map((p) => p.jpeg));
      const cand: Candidate = { bytes, method: 'raster', detail: `Pages converted to images (${dpi} dpi, ${Math.round(q * 100)}% JPEG)`, textLost: true };
      if (!smallest || bytes.length < smallest.bytes.length) smallest = cand;
      if (bytes.length <= target) return cand;
      // Jump ahead to the next combo predicted to be meaningfully smaller
      const ratio = bytes.length / ordered[ci].est;
      let next = ordered.findIndex((c, k) => k > ci && c.est * ratio * 1.03 <= target);
      if (next === -1) {
        if (ci === ordered.length - 1) break;
        next = ordered.length - 1;
      }
      ci = next - 1;
    }
    return smallest;
  } finally {
    await doc.destroy();
  }
}

function sampleIndexes(n: number, k: number): number[] {
  if (n <= k) return [...Array(n).keys()];
  return [0, Math.floor(n / 2), n - 1].slice(0, k);
}

function toJpeg(canvas: HTMLCanvasElement, q: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', q),
  );
}
