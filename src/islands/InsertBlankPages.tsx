import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import PageThumb from '../components/ui/PageThumb';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

type Size = 'match' | 'a4' | 'letter';
type Mode = 'pick' | 'every' | 'odd';

export default function InsertBlankPages() {
  const doc = usePdfDoc();
  /** key = insert after this 0-based page (-1 = before page 1) → number of blank pages */
  const [gaps, setGaps] = useState<Record<number, number>>({});
  const [mode, setMode] = useState<Mode>('pick');
  const [size, setSize] = useState<Size>('match');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ bytes: Uint8Array; added: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan: Record<number, number> = mode === 'every' ? Object.fromEntries(Array.from({ length: doc.pageCount }, (_, i) => [i, 1]))
    : mode === 'odd' ? (doc.pageCount % 2 ? { [doc.pageCount - 1]: 1 } : {})
    : gaps;
  const total = Object.values(plan).reduce((s, n) => s + n, 0);
  const bump = (after: number, d: number) => { setMode('pick'); setGaps((g) => { const n = Math.max(0, Math.min(20, (g[after] ?? 0) + d)); const next = { ...g }; if (n) next[after] = n; else delete next[after]; return next; }); };

  const run = async () => {
    if (!doc.bytes || !total) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const inserts = Object.entries(plan).map(([after, count]) => ({ after: +after, count }));
      setOut(await pdfOp('insertBlankPages', [doc.bytes.slice().buffer, inserts, size]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setGaps({}); setMode('pick'); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`${out.added} blank page${out.added === 1 ? '' : 's'} added!`} stats={[['Before', `${doc.pageCount} pages`], ['After', `${doc.pageCount + out.added} pages`], ['Size', formatBytes(out.bytes.length)]]}
          onDownload={() => downloadBlob(out.bytes, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Use another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change blank pages</button>
        </ResultCard>
      </div>
    );
  }

  const gapBtn = (after: number, label: string) => {
    const n = plan[after] ?? 0;
    return (
      <div class={`flex items-center justify-center gap-1 rounded-control border border-dashed px-1 py-1 text-xs ${n ? 'border-brand bg-brand-soft dark:bg-brand/15' : 'border-line dark:border-white/15'}`}>
        {n > 0 && <button type="button" class="grid h-8 w-8 place-items-center rounded-md bg-white font-bold dark:bg-night-3" onClick={() => bump(after, -1)} aria-label={`One fewer blank page ${label}`}>−</button>}
        <button type="button" class="min-h-8 flex-1 rounded-md px-1 font-semibold text-brand dark:text-brand-light" onClick={() => bump(after, 1)} aria-label={`Add a blank page ${label}`}>
          {n ? `${n} blank` : '+ blank'}
        </button>
      </div>
    );
  };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Then choose where the blank pages go." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <>
          <OptionChips<Mode> label="Where" value={mode} onChange={(v) => v && setMode(v)} variant="cards" options={[
            { value: 'pick', label: 'Choose', sub: 'Tap + between pages' },
            { value: 'every', label: 'After every page', sub: 'For notes / duplex' },
            { value: 'odd', label: 'Make even', sub: doc.pageCount % 2 ? 'Adds 1 at the end' : 'Already even' },
          ]} />
          <OptionChips<Size> label="Blank page size" value={size} onChange={(v) => v && setSize(v)} options={[
            { value: 'match', label: 'Same as nearby page' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' },
          ]} />
          <ul class="grid max-h-[32rem] grid-cols-3 gap-x-2 gap-y-2 overflow-y-auto p-0.5 sm:grid-cols-5 sm:gap-x-3">
            <li class="col-span-full">{gapBtn(-1, 'before page 1')}</li>
            {doc.thumbs.map((t, i) => (
              <li key={i} class="space-y-1.5">
                <PageThumb url={t.url} aspect={t.aspect} caption={`Page ${i + 1}`} />
                {gapBtn(i, `after page ${i + 1}`)}
              </li>
            ))}
          </ul>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Adding blank pages…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!total} onClick={run}>{total ? `Insert ${total} blank page${total > 1 ? 's' : ''}` : mode === 'odd' ? 'Page count is already even' : 'Tap “+ blank” where you want a page'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
