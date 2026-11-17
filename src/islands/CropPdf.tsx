import { useEffect, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import Cropper from '../components/ui/Cropper';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { StickyActions } from '../components/ui/Sticky';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { Rect } from '../lib/image';
import { usePdfDoc } from './usePdfDoc';

type Scope = 'all' | 'this';
const N = 1000; // crop rect is kept in a 1000-wide virtual pixel space
const full = (h: number): Rect => ({ x: 0, y: 0, w: N, h });

/** Bounding box of non-white pixels in an <img>, in 0..1 fractions; null if the page is blank. */
async function contentBox(url: string): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  const s = Math.min(1, 500 / img.naturalWidth);
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  c.width = c.height = 0;
  if (x1 < 0) return null;
  const pad = Math.round(Math.min(width, height) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  return { x: x0 / width, y: y0 / height, w: (x1 - x0 + 1) / width, h: (y1 - y0 + 1) / height };
}

export default function CropPdf() {
  const doc = usePdfDoc(900);
  const [page, setPage] = useState(0);
  const [scope, setScope] = useState<Scope>('all');
  const [rect, setRect] = useState<Rect | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const t = doc.thumbs[page];
  const H = Math.round(N * (t?.aspect ?? 1.414));

  useEffect(() => { setPage(0); setRect(null); }, [doc.bytes]);
  // start with a gentle 5% margin crop once the preview exists
  useEffect(() => { if (t?.url && !rect) setRect({ x: N * 0.05, y: H * 0.05, w: N * 0.9, h: H * 0.9 }); }, [t?.url]);

  const autoDetect = async () => {
    if (!t?.url) return;
    setBusy(true);
    try {
      const b = await contentBox(t.url);
      setRect(b ? { x: b.x * N, y: b.y * H, w: b.w * N, h: b.h * H } : full(H));
    } finally { setBusy(false); }
  };

  const apply = async () => {
    if (!doc.bytes || !rect) return;
    setPhase('working'); setError(null);
    try {
      const frac = { x: rect.x / N, y: rect.y / H, w: rect.w / N, h: rect.h / H };
      const boxes = Array.from({ length: doc.pageCount }, (_, i) => (scope === 'all' || i === page ? frac : null));
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('cropPdf', [doc.bytes.slice().buffer, boxes]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOut(null); setRect(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    const pct = rect ? Math.round((rect.w * rect.h) / (N * H) * 100) : 100;
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is cropped!" stats={[['Pages cropped', scope === 'all' ? String(doc.pageCount) : '1'], ['Area kept', `${pct}%`], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'cropped PDF' : doc.file.name}`} onReset={reset} resetLabel="Crop another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Adjust crop</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop the PDF to crop" buttonLabel="Select PDF" onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}

      {doc.file && doc.pageCount > 0 && (
        <>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn-secondary min-h-11 px-3" disabled={!t?.url || busy} onClick={autoDetect}>✨ Auto-detect margins</button>
            <button type="button" class="btn-ghost min-h-11 px-3" disabled={!t?.url} onClick={() => setRect(full(H))}>Reset</button>
            {doc.pageCount > 1 && (
              <div class="ml-auto flex items-center gap-1">
                <button type="button" class="btn-ghost min-h-11 px-3" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
                <span class="text-sm font-semibold tabular-nums">Page {page + 1}/{doc.pageCount}</span>
                <button type="button" class="btn-ghost min-h-11 px-3" disabled={page >= doc.pageCount - 1} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
              </div>
            )}
          </div>

          {t?.url && rect ? (
            <Cropper src={t.url} naturalW={N} naturalH={H} aspect={null} value={rect} onChange={setRect} />
          ) : <div class="grid h-72 place-items-center"><span class="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" /></div>}
          <p class="text-center text-xs text-muted dark:text-gray-400">Drag the corners to choose the area to keep · drag inside to move it</p>

          {doc.pageCount > 1 && (
            <OptionChips<Scope> label="Apply crop to" value={scope} onChange={(v) => v && setScope(v)}
              options={[{ value: 'all', label: `All ${doc.pageCount} pages` }, { value: 'this', label: `Only page ${page + 1}` }]} />
          )}

          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Cropping…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!rect} onClick={apply}>Crop PDF</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
