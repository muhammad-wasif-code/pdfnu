import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import PageThumb from '../components/ui/PageThumb';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';

export default function DeletePages() {
  const doc = usePdfDoc();
  const [del, setDel] = useState<Set<number>>(new Set());
  const [range, setRange] = useState('');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (i: number) => setDel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const applyRange = async () => {
    setError(null);
    try {
      const { parseRanges } = await import('../lib/ranges');
      setDel(new Set(parseRanges(range, doc.pageCount).flat()));
    } catch (e: any) { setError(e.message); }
  };

  const run = async () => {
    if (!doc.bytes) return;
    if (del.size >= doc.pageCount) { setError('You can’t delete every page. Keep at least one.'); return; }
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const keep = Array.from({ length: doc.pageCount }, (_, i) => i).filter((i) => !del.has(i)).map((src) => ({ src, rotate: 0 }));
      setOut(await pdfOp('rearrange', [doc.bytes.slice().buffer, keep]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setDel(new Set()); setRange(''); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`${del.size} page${del.size > 1 ? 's' : ''} deleted!`} stats={[['Before', `${doc.pageCount} pages`], ['After', `${doc.pageCount - del.size} pages`], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Delete pages from another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change selection</button>
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
      {doc.file && doc.pageCount > 0 && (
        <>
          <form class="flex gap-2" onSubmit={(e) => { e.preventDefault(); applyRange(); }}>
            <input type="text" inputMode="numeric" value={range} onInput={(e) => setRange((e.target as HTMLInputElement).value)} placeholder={`Pages to delete, e.g. 2, 5-7 (1–${doc.pageCount})`}
              class="h-11 min-w-0 flex-1 rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" aria-label="Pages to delete" />
            <button type="submit" class="btn-secondary min-h-11 px-4">Select</button>
          </form>
          <p class="text-sm"><span class="font-semibold text-ink dark:text-white">{del.size} selected</span> <span class="text-muted dark:text-gray-400">· tap pages to mark them for deletion</span></p>
          <ul class="grid max-h-[32rem] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5 sm:gap-3">
            {doc.thumbs.map((t, i) => (
              <li key={i}>
                <button type="button" class="block w-full rounded-control" aria-pressed={del.has(i)} aria-label={`Page ${i + 1}${del.has(i) ? ', marked for deletion' : ''}`} onClick={() => toggle(i)}>
                  <PageThumb url={t.url} aspect={t.aspect} caption={`Page ${i + 1}`} dimmed={del.has(i)}>
                    {del.has(i) && <span class="absolute inset-0 grid place-items-center"><span class="grid h-10 w-10 place-items-center rounded-full bg-danger text-white shadow"><svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></span></span>}
                  </PageThumb>
                </button>
              </li>
            ))}
          </ul>
          {phase === 'working' ? <ProgressBar label="Deleting pages…" value={null} /> : (
            <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!del.size} onClick={run}>{del.size ? `Delete ${del.size} page${del.size > 1 ? 's' : ''}` : 'Select pages to delete'}</button>
          )}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
