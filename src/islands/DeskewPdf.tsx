import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import PageThumb from '../components/ui/PageThumb';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

/** Smallest tilt worth fixing, in degrees. */
const MIN = 0.15;

export default function DeskewPdf() {
  const doc = usePdfDoc(150);
  const [angles, setAngles] = useState<(number | null | undefined)[]>([]);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef(false);

  useEffect(() => {
    setAngles([]); setOff(new Set());
    if (!doc.bytes) return;
    cancel.current = false;
    (async () => {
      try {
        const [{ openPdf }, { renderPage }, { detectSkew }] = await Promise.all([import('../lib/pdfjs'), import('../lib/render'), import('../lib/deskew')]);
        const pdf = await openPdf(doc.bytes!.slice());
        try {
          const res: (number | null | undefined)[] = Array(pdf.numPages).fill(undefined);
          for (let i = 0; i < pdf.numPages && !cancel.current; i++) {
            const c = await renderPage(pdf, i + 1, 100);
            const ctx = c.getContext('2d')!;
            const { data } = ctx.getImageData(0, 0, c.width, c.height);
            const g = new Uint8Array(c.width * c.height);
            for (let p = 0, q = 0; p < data.length; p += 4, q++) g[q] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
            res[i] = detectSkew(g, c.width, c.height);
            c.width = c.height = 0;
            setAngles(res.slice());
          }
        } finally { await pdf.destroy(); }
      } catch (e) { setError(friendlyError(e).message); }
    })();
    return () => { cancel.current = true; };
  }, [doc.bytes]);

  const fix = (i: number) => { const a = angles[i]; return typeof a === 'number' && Math.abs(a) >= MIN && !off.has(i); };
  const todo = angles.map((_, i) => i).filter(fix);
  const checked = angles.filter((a) => a !== undefined).length;
  const scanning = doc.pageCount > 0 && checked < doc.pageCount && !error;

  const run = async () => {
    if (!doc.bytes || !todo.length) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('rotateContent', [doc.bytes.slice().buffer, angles.map((a, i) => (fix(i) ? (a as number) : null))]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { cancel.current = true; doc.clear(); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`${todo.length} page${todo.length === 1 ? '' : 's'} straightened!`} stats={[['Pages', String(doc.pageCount)], ['Straightened', String(todo.length)], ['Size', formatBytes(out.length)]]}
          highlight="Pages were turned, not re-scanned: quality is unchanged."
          onDownload={() => downloadBlob(out, `${stripExt(doc.file!.name)}-straight.pdf`)} downloadLabel="Download PDF" onReset={reset} resetLabel="Straighten another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change selection</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your scanned PDF here" buttonLabel="Select PDF" hint="Tilted pages are found and straightened automatically." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <>
          {scanning && <ProgressBar label="Measuring page tilt…" value={checked / doc.pageCount} detail={`${checked} of ${doc.pageCount} pages`} />}
          <p class="text-sm"><span class="font-semibold text-ink dark:text-white">{todo.length} tilted page{todo.length === 1 ? '' : 's'}</span> <span class="text-muted dark:text-gray-400">· previews show the straightened page · tap to skip one</span></p>
          <ul class="grid max-h-[32rem] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5 sm:gap-3">
            {doc.thumbs.map((t, i) => {
              const a = angles[i];
              const tilted = typeof a === 'number' && Math.abs(a) >= MIN;
              const on = fix(i);
              return (
                <li key={i}>
                  <button type="button" class="block w-full rounded-control" disabled={!tilted} aria-pressed={on} onClick={() => setOff((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}>
                    <PageThumb url={t.url} aspect={t.aspect} rotate={on ? -(a as number) : 0} caption={`Page ${i + 1}`} selected={on}
                      sub={a === undefined ? 'Checking…' : a === null ? 'No text lines' : tilted ? `${Math.abs(a).toFixed(1)}° ${a > 0 ? '↺' : '↻'}${on ? '' : ' · skipped'}` : 'Straight'} />
                  </button>
                </li>
              );
            })}
          </ul>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Straightening pages…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!todo.length} onClick={run}>{todo.length ? `Straighten ${todo.length} page${todo.length === 1 ? '' : 's'}` : scanning ? 'Checking pages…' : 'No tilted pages found'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
