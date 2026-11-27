import { useEffect, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { Bookmark } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

type Row = Bookmark & { id: number };
let seq = 0;

export default function EditBookmarks() {
  const doc = usePdfDoc(110);
  const [rows, setRows] = useState<Row[]>([]);
  const [orig, setOrig] = useState<number | null>(null);
  const [detecting, setDetecting] = useState<[number, number] | null>(null);
  const [expand, setExpand] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows([]); setOrig(null);
    if (!doc.bytes) return;
    import('../lib/outline').then(({ readOutline }) => readOutline(doc.bytes!))
      .then((m) => { setRows(m.map((b) => ({ ...b, id: seq++ }))); setOrig(m.length); })
      .catch((e) => setError(friendlyError(e).message));
  }, [doc.bytes]);

  const upd = (id: number, p: Partial<Row>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setRows((r) => { const n = r.slice(); const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = (page = 0) => setRows((r) => {
    const n = r.slice();
    const at = n.findIndex((x) => x.page > page);
    const row = { id: seq++, title: `Page ${page + 1}`, page, level: 0 };
    if (at < 0) n.push(row); else n.splice(at, 0, row);
    return n;
  });
  const detect = async () => {
    if (!doc.bytes) return;
    setError(null); setDetecting([0, doc.pageCount]);
    try {
      const { detectHeadings } = await import('../lib/outline');
      const h = await detectHeadings(doc.bytes, (d, t) => setDetecting([d, t]));
      if (!h.length) setError('No headings were found. They are detected from larger or bold text; scanned pages need OCR first.');
      else setRows(h.map((b) => ({ ...b, id: seq++ })));
    } catch (e) { setError(friendlyError(e).message); }
    setDetecting(null);
  };
  const sortByPage = () => setRows((r) => r.slice().sort((a, b) => a.page - b.page));

  const run = async () => {
    if (!doc.bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      // a child can't be more than one level deeper than the entry above it
      const fixed = rows.map((r, i, all) => ({ title: r.title, page: r.page, level: i === 0 ? 0 : Math.min(r.level, all[i - 1].level + 1) }));
      setOut(await pdfOp('writeBookmarks', [doc.bytes.slice().buffer, fixed, expand ? 3 : 1]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setRows([]); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={rows.length ? 'Bookmarks saved!' : 'Bookmarks removed!'} stats={[['Bookmarks', String(rows.length)], ['Pages', String(doc.pageCount)], ['Size', formatBytes(out.length)]]}
          highlight={rows.length ? 'The bookmarks panel opens automatically when the PDF is opened.' : undefined}
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Use another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep editing</button>
        </ResultCard>
      </div>
    );
  }

  const inputCls = 'h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2';
  const small = 'grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-sm disabled:opacity-40 dark:border-white/10 dark:bg-night-3';
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Add, edit or generate a clickable table of contents." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}${orig !== null ? ` · ${orig} bookmark${orig === 1 ? '' : 's'}` : ''}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && orig !== null && (
        <>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-secondary min-h-11 px-4 text-sm" onClick={detect} disabled={!!detecting}>✨ Find headings automatically</button>
            <button type="button" class="btn-secondary min-h-11 px-4 text-sm" onClick={() => add(rows.length ? Math.min(doc.pageCount - 1, rows[rows.length - 1].page + 1) : 0)}>+ Add bookmark</button>
            {rows.length > 1 && <button type="button" class="btn-secondary min-h-11 px-4 text-sm" onClick={sortByPage}>Sort by page</button>}
            {rows.length > 0 && <button type="button" class="btn-secondary min-h-11 px-4 text-sm text-danger" onClick={() => setRows([])}>Remove all</button>}
          </div>
          {detecting && <ProgressBar label="Looking for headings…" value={detecting[1] ? detecting[0] / detecting[1] : null} />}
          {rows.length === 0 && !detecting && <p class="rounded-control bg-surface p-3 text-sm text-muted dark:bg-white/5 dark:text-gray-400">No bookmarks yet. Find headings automatically, or add bookmarks one by one.</p>}
          <ol class="max-h-[28rem] space-y-1.5 overflow-y-auto">
            {rows.map((r, i) => (
              <li key={r.id} class="flex flex-wrap items-center gap-1.5 rounded-lg bg-surface p-1.5 sm:flex-nowrap dark:bg-white/5" style={{ marginLeft: `${Math.min(r.level, 4) * 16}px` }}>
                {doc.thumbs[r.page]?.url && <img src={doc.thumbs[r.page].url} alt="" class="hidden h-10 w-auto rounded border border-line sm:block dark:border-white/10" />}
                <input type="text" value={r.title} class={`${inputCls} basis-full sm:basis-auto`} aria-label={`Bookmark ${i + 1} title`} onInput={(e) => upd(r.id, { title: (e.target as HTMLInputElement).value })} />
                <label class="mr-auto flex shrink-0 items-center gap-1 text-xs text-muted sm:mr-0 dark:text-gray-400">p.
                  <input type="number" min={1} max={doc.pageCount} value={r.page + 1} aria-label={`Bookmark ${i + 1} page`} class="h-10 w-16 rounded-lg border border-line bg-white px-2 text-[15px] text-ink dark:border-white/10 dark:bg-night-2 dark:text-white"
                    onInput={(e) => { const v = parseInt((e.target as HTMLInputElement).value, 10); if (v >= 1 && v <= doc.pageCount) upd(r.id, { page: v - 1 }); }} />
                </label>
                <button type="button" class={small} disabled={r.level === 0} onClick={() => upd(r.id, { level: r.level - 1 })} aria-label="Move left (higher level)">⇤</button>
                <button type="button" class={small} disabled={i === 0 || r.level > rows[i - 1].level} onClick={() => upd(r.id, { level: r.level + 1 })} aria-label="Move right (sub-bookmark)">⇥</button>
                <button type="button" class={`${small} hidden sm:grid`} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button type="button" class={`${small} hidden sm:grid`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button type="button" class={`${small} text-danger`} onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))} aria-label="Delete bookmark">✕</button>
              </li>
            ))}
          </ol>
          {rows.some((r) => r.level > 0) && (
            <label class="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" class="h-5 w-5 accent-brand" checked={expand} onChange={(e) => setExpand((e.target as HTMLInputElement).checked)} />Show sub-bookmarks expanded</label>
          )}
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Saving bookmarks…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!rows.length && !orig} onClick={run}>{rows.length ? `Save ${rows.length} bookmark${rows.length === 1 ? '' : 's'}` : orig ? 'Save without bookmarks' : 'Add a bookmark first'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
