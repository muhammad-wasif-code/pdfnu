import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import PageThumb from '../components/ui/PageThumb';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

/** Share of "ink" pixels on a page (0..1), ignoring a thin border where scanner edges and punch holes sit. */
async function inkRatio(page: any): Promise<number> {
  const base = page.getViewport({ scale: 1 });
  const scale = 200 / Math.max(base.width, base.height);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d', { alpha: false, willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as any).promise;
  const mx = Math.round(c.width * 0.04), my = Math.round(c.height * 0.04);
  const { data } = ctx.getImageData(mx, my, c.width - 2 * mx, c.height - 2 * my);
  // background = the most common light level, so off-white scans count as blank too
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) hist[(data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 | 0]++;
  let bg = 255; for (let v = 255, best = 0; v >= 128; v--) if (hist[v] > best) { best = hist[v]; bg = v; }
  let ink = 0;
  const px = data.length / 4;
  for (let v = 0; v < 256; v++) if (v < bg - 40) ink += hist[v];
  c.width = c.height = 0;
  return ink / px;
}

const LEVELS = [
  { label: 'Only truly empty', max: 0.0005 },
  { label: 'Normal', max: 0.004 },
  { label: 'Include near-empty scans', max: 0.015 },
];

export default function RemoveBlankPages() {
  const doc = usePdfDoc();
  const [ratios, setRatios] = useState<(number | null)[]>([]);
  const [hasText, setHasText] = useState<boolean[]>([]);
  const [level, setLevel] = useState(1);
  const [manual, setManual] = useState<Record<number, boolean>>({});
  const [scanning, setScanning] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef(false);

  useEffect(() => {
    setRatios([]); setHasText([]); setManual({});
    if (!doc.bytes) return;
    cancel.current = false;
    (async () => {
      setScanning(true);
      try {
        const { openPdf } = await import('../lib/pdfjs');
        const pdf = await openPdf(doc.bytes!.slice());
        try {
          const r: (number | null)[] = Array(pdf.numPages).fill(null), t: boolean[] = Array(pdf.numPages).fill(false);
          for (let i = 0; i < pdf.numPages && !cancel.current; i++) {
            const page = await pdf.getPage(i + 1);
            const tc = await page.getTextContent();
            t[i] = tc.items.some((it: any) => it.str?.trim());
            r[i] = await inkRatio(page);
            page.cleanup();
            setRatios(r.slice()); setHasText(t.slice());
          }
        } finally { await pdf.destroy(); }
      } catch (e) { setError(friendlyError(e).message); }
      setScanning(false);
    })();
    return () => { cancel.current = true; };
  }, [doc.bytes]);

  const auto = (i: number) => ratios[i] !== null && ratios[i] !== undefined && !hasText[i] && ratios[i]! <= LEVELS[level].max;
  const isBlank = (i: number) => manual[i] ?? auto(i);
  const blanks = Array.from({ length: doc.pageCount }, (_, i) => i).filter(isBlank);

  const run = async () => {
    if (!doc.bytes || !blanks.length) return;
    if (blanks.length >= doc.pageCount) { setError('Every page is marked as blank. Keep at least one page.'); return; }
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const keep = Array.from({ length: doc.pageCount }, (_, i) => i).filter((i) => !isBlank(i)).map((src) => ({ src, rotate: 0 }));
      setOut(await pdfOp('rearrange', [doc.bytes.slice().buffer, keep]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { cancel.current = true; doc.clear(); setOut(null); setPhase('edit'); setError(null); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`${blanks.length} blank page${blanks.length === 1 ? '' : 's'} removed!`} stats={[['Before', `${doc.pageCount} pages`], ['After', `${doc.pageCount - blanks.length} pages`], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Clean another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change selection</button>
        </ResultCard>
      </div>
    );
  }

  const done = ratios.filter((r) => r !== null).length;
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Blank pages are found automatically." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <>
          {scanning && <ProgressBar label="Looking for blank pages…" value={doc.pageCount ? done / doc.pageCount : null} detail={`${done} of ${doc.pageCount} pages checked`} />}
          <fieldset>
            <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Sensitivity</legend>
            <div class="flex flex-wrap gap-2" role="radiogroup">
              {LEVELS.map((l, i) => (
                <button key={l.label} type="button" role="radio" aria-checked={level === i} onClick={() => { setLevel(i); setManual({}); }}
                  class={`min-h-11 flex-1 rounded-control border px-3 text-sm font-semibold sm:flex-none ${level === i ? 'border-brand bg-brand-soft text-brand ring-1 ring-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-surface dark:border-white/10 dark:bg-white/[.03]'}`}>{l.label}</button>
              ))}
            </div>
          </fieldset>
          <p class="text-sm"><span class="font-semibold text-ink dark:text-white">{blanks.length} blank page{blanks.length === 1 ? '' : 's'} found</span> <span class="text-muted dark:text-gray-400">· tap a page to keep or remove it</span></p>
          <ul class="grid max-h-[32rem] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5 sm:gap-3">
            {doc.thumbs.map((t, i) => {
              const b = isBlank(i);
              return (
                <li key={i}>
                  <button type="button" class="block w-full rounded-control" aria-pressed={b} aria-label={`Page ${i + 1}${b ? ', will be removed' : ''}`} onClick={() => setManual((m) => ({ ...m, [i]: !b }))}>
                    <PageThumb url={t.url} aspect={t.aspect} caption={`Page ${i + 1}`} sub={ratios[i] === null || ratios[i] === undefined ? 'Checking…' : b ? 'Blank: remove' : 'Keep'} dimmed={b}>
                      {b && <span class="absolute inset-0 grid place-items-center"><span class="grid h-10 w-10 place-items-center rounded-full bg-danger text-white shadow"><svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></span></span>}
                    </PageThumb>
                  </button>
                </li>
              );
            })}
          </ul>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Removing pages…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!blanks.length} onClick={run}>{blanks.length ? `Remove ${blanks.length} blank page${blanks.length > 1 ? 's' : ''}` : scanning ? 'Checking pages…' : 'No blank pages found'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
