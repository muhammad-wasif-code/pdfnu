import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { toCanvas, hasAlpha } from '../lib/pdfImage';

interface Found { name: string; blob: Blob; url: string; w: number; h: number; page: number; }
const MIN = 24; // skip tiny icons, masks and pattern tiles

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
