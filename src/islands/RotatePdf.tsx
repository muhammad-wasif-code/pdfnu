import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import PageThumb from '../components/ui/PageThumb';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import IconButton from '../components/ui/IconButton';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

export default function RotatePdf() {
  const doc = usePdfDoc();
  const [rot, setRot] = useState<Record<number, number>>({});
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const turn = (i: number, d: number) => setRot((r) => ({ ...r, [i]: ((r[i] ?? 0) + d + 360) % 360 }));
  const all = (d: number) => setRot((r) => Object.fromEntries(Array.from({ length: doc.pageCount }, (_, i) => [i, ((r[i] ?? 0) + d + 360) % 360])));
  const changed = Object.values(rot).filter(Boolean).length;

  const apply = async () => {
    if (!doc.bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const spec = Array.from({ length: doc.pageCount }, (_, i) => ({ src: i, rotate: rot[i] ?? 0 }));
      setOut(await pdfOp('rearrange', [doc.bytes.slice().buffer, spec]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setRot({}); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Pages rotated!" stats={[['Pages', String(doc.pageCount)], ['Rotated', String(changed)], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Rotate another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep editing</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}

      {doc.file && (
        <>
          <div class="flex flex-wrap items-center gap-2">
            <span class="mr-auto text-sm font-semibold text-ink dark:text-white">Tap a page to rotate it</span>
            <button type="button" class="btn-secondary min-h-10 px-3" onClick={() => all(-90)}>↺ All left</button>
            <button type="button" class="btn-secondary min-h-10 px-3" onClick={() => all(90)}>↻ All right</button>
            {changed > 0 && <button type="button" class="btn-ghost min-h-10 px-3" onClick={() => setRot({})}>Reset</button>}
          </div>
          <ul class="grid max-h-[32rem] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5 sm:gap-3">
            {doc.thumbs.map((t, i) => (
              <li key={i} class="relative">
                <button type="button" class="block w-full rounded-control" onClick={() => turn(i, 90)} aria-label={`Rotate page ${i + 1} clockwise (now ${rot[i] ?? 0}°)`}>
                  <PageThumb url={t.url} aspect={t.aspect} rotate={rot[i] ?? 0} caption={`Page ${i + 1}`} selected={!!rot[i]} sub={rot[i] ? `${rot[i]}°` : '0°'} />
                </button>
                <span class="absolute right-3 top-3"><IconButton icon="rotateLeft" label={`Rotate page ${i + 1} counter-clockwise`} onClick={() => turn(i, -90)} /></span>
              </li>
            ))}
          </ul>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Rotating pages…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!changed} onClick={apply}>
                {changed ? `Apply rotation to ${changed} page${changed > 1 ? 's' : ''}` : 'Rotate pages first'}
              </button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
