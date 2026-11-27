import { useEffect, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OutputList, { downloadAll, safeName, type OutFile } from '../components/ui/OutputList';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import type { Bookmark } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

interface Part { title: string; first: number; last: number; }

/** Chapters at a level: each runs from its bookmark to the page before the next one at that level (or higher). */
export function chapters(marks: Bookmark[], level: number, pages: number): Part[] {
  const at = marks.filter((m) => m.level <= level).sort((a, b) => a.page - b.page);
  const out: Part[] = [];
  if (at.length && at[0].page > 0) out.push({ title: 'Front matter', first: 0, last: at[0].page - 1 });
  at.forEach((m, i) => {
    const next = at.slice(i + 1).find((n) => n.page > m.page);
    const last = next ? next.page - 1 : pages - 1;
    if (at[i + 1] && at[i + 1].page === m.page) return; // several bookmarks on one page: the last one wins the range
    out.push({ title: m.title, first: m.page, last: Math.max(m.page, last) });
  });
  return out;
}

export default function SplitByBookmarks() {
  const doc = usePdfDoc(100, true);
  const [marks, setMarks] = useState<Bookmark[] | null>(null);
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [outs, setOuts] = useState<OutFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMarks(null); setLevel(0);
    if (!doc.bytes) return;
    import('../lib/outline').then(({ readOutline }) => readOutline(doc.bytes!)).then(setMarks).catch((e) => setError(friendlyError(e).message));
  }, [doc.bytes]);

  const levels = marks ? Math.max(0, ...marks.map((m) => m.level)) + 1 : 0;
  const parts = marks && doc.pageCount ? chapters(marks, level, doc.pageCount) : [];

  const run = async () => {
    if (!doc.bytes || !doc.file || !parts.length) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const datas = await pdfOp('extractGroups', [doc.bytes.slice().buffer, parts.map((p) => Array.from({ length: p.last - p.first + 1 }, (_, i) => p.first + i))]);
      const pad = String(parts.length).length;
      setOuts(parts.map((p, i) => ({ name: `${String(i + 1).padStart(pad, '0')} ${safeName(p.title)}.pdf`, data: datas[i], note: p.first === p.last ? `page ${p.first + 1}` : `pages ${p.first + 1}–${p.last + 1}` })));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOuts([]); setPhase('edit'); };

  if (phase === 'done' && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`Split into ${outs.length} chapter${outs.length === 1 ? '' : 's'}!`} stats={[['Pages', String(doc.pageCount)], ['Files', String(outs.length)], ['Level', String(level + 1)]]}
          highlight="Each file is named after its bookmark."
          onDownload={() => downloadAll(outs, `${stripExt(doc.file!.name)}-chapters.zip`)} downloadLabel={outs.length > 1 ? 'Download all (.zip)' : 'Download PDF'} onReset={reset} resetLabel="Split another PDF">
          <OutputList files={outs} />
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change level</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop a PDF with bookmarks" buttonLabel="Select PDF" hint="One file per chapter or section." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {(doc.loading || (doc.file && !marks && !error)) && <ProgressBar label="Reading bookmarks…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && marks && marks.length === 0 && (
        <ErrorBox>This PDF has no bookmarks. Add them first with <a class="underline" href="/add-bookmarks-to-pdf">Add Bookmarks</a> (it can find headings for you), or split by page numbers with <a class="underline" href="/split-pdf">Split PDF</a>.</ErrorBox>
      )}
      {doc.file && marks && marks.length > 0 && (
        <>
          {levels > 1 && (
            <fieldset>
              <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Split at bookmark level</legend>
              <div class="flex flex-wrap gap-2">
                {Array.from({ length: Math.min(levels, 4) }, (_, l) => (
                  <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}
                    class={`min-h-11 rounded-control border px-4 text-sm font-semibold ${level === l ? 'border-brand bg-brand-soft text-brand ring-1 ring-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-surface dark:border-white/10 dark:bg-white/[.03]'}`}>
                    {l === 0 ? 'Top level (chapters)' : `Level ${l + 1}`} · {chapters(marks, l, doc.pageCount).length} files
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <ol class="max-h-80 space-y-1 overflow-y-auto text-sm">
            {parts.map((p, i) => (
              <li key={i} class="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 dark:bg-white/5">
                <span class="truncate font-semibold text-ink dark:text-white">{i + 1}. {p.title}</span>
                <span class="shrink-0 text-xs text-muted dark:text-gray-400">{p.first === p.last ? `p. ${p.first + 1}` : `pp. ${p.first + 1}–${p.last + 1}`}</span>
              </li>
            ))}
          </ol>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Splitting…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={parts.length < 2} onClick={run}>{parts.length < 2 ? 'Only one section at this level' : `Split into ${parts.length} files`}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
