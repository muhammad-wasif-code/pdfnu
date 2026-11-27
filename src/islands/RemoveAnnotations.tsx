import { useEffect, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { AnnotGroup } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

const GROUPS: { g: AnnotGroup; label: string; hint: string; def: boolean }[] = [
  { g: 'comments', label: 'Comments & markup', hint: 'Sticky notes, text comments, highlights, underlines, strikethroughs', def: true },
  { g: 'drawings', label: 'Drawings & shapes', hint: 'Pen marks, boxes, circles, lines, arrows', def: true },
  { g: 'stamps', label: 'Stamps', hint: 'Approved, Draft and other stamp comments', def: true },
  { g: 'attachments', label: 'Attachments & media', hint: 'Attached files, sounds, videos', def: false },
  { g: 'links', label: 'Links', hint: 'Clickable web links and jumps inside the document', def: false },
  { g: 'forms', label: 'Form fields', hint: 'Fillable boxes, checkboxes, buttons (their typed values disappear too)', def: false },
  { g: 'other', label: 'Other annotations', hint: 'Anything else, such as printer marks or 3D content', def: false },
];

export default function RemoveAnnotations() {
  const doc = usePdfDoc(120, true);
  const [counts, setCounts] = useState<Record<AnnotGroup, number> | null>(null);
  const [pick, setPick] = useState<Set<AnnotGroup>>(new Set(GROUPS.filter((g) => g.def).map((g) => g.g)));
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ bytes: Uint8Array; removed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCounts(null);
    if (!doc.bytes) return;
    import('../lib/pdfWorker').then(({ pdfOp }) => pdfOp('annotationSummary', [doc.bytes!.slice().buffer])).then(setCounts).catch((e) => setError(friendlyError(e).message));
  }, [doc.bytes]);

  const sel = GROUPS.filter((g) => pick.has(g.g) && (counts?.[g.g] ?? 0) > 0);
  const total = sel.reduce((t, g) => t + (counts?.[g.g] ?? 0), 0);
  const all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  const run = async () => {
    if (!doc.bytes || !total) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('removeAnnotations', [doc.bytes.slice().buffer, sel.map((g) => g.g)]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOut(null); setPhase('edit'); setCounts(null); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`${out.removed} annotation${out.removed === 1 ? '' : 's'} removed!`} stats={[['Removed', String(out.removed)], ['Kept', String(all - out.removed)], ['Size', formatBytes(out.bytes.length)]]}
          highlight="The page content itself is untouched."
          onDownload={() => downloadBlob(out.bytes, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'clean PDF' : doc.file.name}`} onReset={reset} resetLabel="Clean another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change selection</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Remove comments, highlights, drawings and more." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {(doc.loading || (doc.file && !counts && !error)) && <ProgressBar label="Looking for annotations…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && counts && all === 0 && <p class="rounded-control bg-surface p-4 text-sm dark:bg-white/5">This PDF has no annotations. Marks that look like comments are part of the page itself; cover them with <a class="underline" href="/edit-pdf">Edit PDF</a> or remove text with <a class="underline" href="/redact-pdf">Redact PDF</a>.</p>}
      {doc.file && counts && all > 0 && (
        <>
          <fieldset class="space-y-2">
            <legend class="mb-1 text-sm font-semibold text-ink dark:text-white">Found {all} annotation{all === 1 ? '' : 's'}. Remove:</legend>
            {GROUPS.filter((g) => counts[g.g] > 0).map((g) => (
              <label key={g.g} class="flex min-h-11 cursor-pointer items-start gap-3 rounded-control border border-line p-3 text-sm dark:border-white/10">
                <input type="checkbox" class="mt-0.5 h-5 w-5 accent-brand" checked={pick.has(g.g)} onChange={() => setPick((s) => { const n = new Set(s); n.has(g.g) ? n.delete(g.g) : n.add(g.g); return n; })} />
                <span class="flex-1"><span class="font-semibold text-ink dark:text-white">{g.label}</span> <span class="rounded bg-surface px-1.5 text-xs font-semibold dark:bg-white/10">{counts[g.g]}</span><br /><span class="text-muted dark:text-gray-400">{g.hint}</span></span>
              </label>
            ))}
          </fieldset>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Removing…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!total} onClick={run}>{total ? `Remove ${total} annotation${total === 1 ? '' : 's'}` : 'Choose what to remove'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
