import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

interface Found { name: string; blob: Blob; url: string; w: number; h: number; page: number; }
const MIN = 24; // skip tiny icons, masks and pattern tiles

/** Convert a pdf.js image object to a canvas, whatever internal form it has. */
function toCanvas(img: any): HTMLCanvasElement | null {
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

function hasAlpha(c: HTMLCanvasElement) {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) return true;
  return false;
}

export default function ExtractImages() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [found, setFound] = useState<Found[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(found);
  ref.current = found;
  useEffect(() => () => ref.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  const run = async (f: File) => {
    setError(null); setFile(f); setPhase('working'); setFound([]);
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const { openPdf, loadPdfJs } = await import('../lib/pdfjs');
      const pdfjs = await loadPdfJs();
      const pdf = await readPdf(f);
      const doc = await openPdf(pdf.bytes.slice());
      const base = stripExt(f.name);
      const seen = new Set<string>();
      const results: Found[] = [];
      try {
        for (let n = 1; n <= doc.numPages; n++) {
          setProgress({ label: `Scanning page ${n} of ${doc.numPages}… (${results.length} found)`, value: n / doc.numPages });
          const page = await doc.getPage(n);
          const ops = await page.getOperatorList();
          for (let i = 0; i < ops.fnArray.length; i++) {
            const fn = ops.fnArray[i];
            if (fn !== pdfjs.OPS.paintImageXObject && fn !== pdfjs.OPS.paintImageXObjectRepeat) continue;
            const id = ops.argsArray[i][0] as string;
            if (seen.has(id)) continue;
            seen.add(id);
            const store = id.startsWith('g_') ? page.commonObjs : page.objs;
            const img = await new Promise<any>((res) => { try { store.get(id, res); } catch { res(null); } });
            if (!img || img.width < MIN || img.height < MIN) continue;
            const c = toCanvas(img);
            if (!c) continue;
            const png = hasAlpha(c);
            const blob = await new Promise<Blob | null>((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.95));
            if (blob) results.push({ name: `${base}-page${n}-image${results.length + 1}.${png ? 'png' : 'jpg'}`, blob, url: URL.createObjectURL(blob), w: c.width, h: c.height, page: n });
            c.width = c.height = 0;
          }
          page.cleanup();
        }
      } finally { await doc.destroy(); }
      setFound(results); setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); setFile(null); }
  };

  const downloadAll = async () => {
    if (found.length === 1) return downloadBlob(found[0].blob, found[0].name, found[0].blob.type);
    const { makeZip } = await import('../lib/zip');
    downloadBlob(await makeZip(found.map((f) => ({ name: f.name, data: f.blob }))), `${stripExt(file!.name)}-images.zip`, 'application/zip');
  };
  const reset = () => { found.forEach((f) => URL.revokeObjectURL(f.url)); setFound([]); setFile(null); setPhase('edit'); };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Saves every photo and picture inside the PDF" onFiles={(f) => run(f[0])} />
        : <FileRow name={file.name} size={formatBytes(file.size)} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={() => setError(null)}>{error}</ErrorBox>}
      {phase === 'working' && <ProgressBar label={progress.label} value={progress.value} />}

      {phase === 'done' && (found.length === 0 ? (
        <p class="rounded-control bg-surface px-4 py-3 text-sm text-gray-700 dark:bg-white/5 dark:text-gray-300">
          No images were found in this PDF. It may contain only text and vector graphics. To save whole pages as pictures, use <a class="font-semibold text-brand underline dark:text-brand-light" href="/pdf-to-jpg">PDF to JPG</a>.
        </p>
      ) : (
        <div class="space-y-4">
          <p class="text-sm font-semibold text-ink dark:text-white">{found.length} image{found.length > 1 ? 's' : ''} found · {formatBytes(found.reduce((s, f) => s + f.blob.size, 0))}</p>
          <ul class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {found.map((f) => (
              <li key={f.name} class="rounded-control border border-line p-2 text-center dark:border-white/10">
                <div class="grid aspect-square place-items-center overflow-hidden rounded-md bg-[repeating-conic-gradient(#e5e7eb_0_25%,#fff_0_50%)] bg-[length:12px_12px]">
                  <img src={f.url} alt={`Image from page ${f.page}`} class="max-h-full max-w-full object-contain" loading="lazy" />
                </div>
                <p class="mt-1 text-[11px] tabular-nums text-muted dark:text-gray-400">Page {f.page} · {f.w}×{f.h}</p>
                <button type="button" class="mt-1 min-h-9 text-xs font-semibold text-brand dark:text-brand-light" onClick={() => downloadBlob(f.blob, f.name, f.blob.type)}>Save</button>
              </li>
            ))}
          </ul>
          <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={downloadAll}>{found.length > 1 ? `Download all (${found.length}) as .zip` : 'Download image'}</button>
          <button type="button" class="btn-ghost w-full" onClick={reset}>Extract from another PDF</button>
        </div>
      ))}
      <PrivacyNote />
    </div>
  );
}
