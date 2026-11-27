import { useEffect, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { MetaEdit, PdfMeta } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

const EMPTY: MetaEdit = { title: '', author: '', subject: '', keywords: '', creator: '', producer: '', created: null, modified: null };
const FIELDS: { key: keyof Omit<MetaEdit, 'created' | 'modified'>; label: string; hint: string }[] = [
  { key: 'title', label: 'Title', hint: 'Shown in the browser tab and in search results instead of the file name' },
  { key: 'author', label: 'Author', hint: 'Person or company that wrote the document' },
  { key: 'subject', label: 'Subject', hint: 'A one-line description' },
  { key: 'keywords', label: 'Keywords', hint: 'Separate with commas' },
  { key: 'creator', label: 'Creator app', hint: 'The program that made the original, e.g. Microsoft Word' },
  { key: 'producer', label: 'PDF producer', hint: 'The program that wrote the PDF' },
];

/** ISO → value for <input type="datetime-local"> in local time. */
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export default function PdfMetadata() {
  const doc = usePdfDoc(140, true);
  const [orig, setOrig] = useState<PdfMeta | null>(null);
  const [meta, setMeta] = useState<MetaEdit>(EMPTY);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrig(null); setMeta(EMPTY);
    if (!doc.bytes) return;
    import('../lib/pdfWorker').then(({ pdfOp }) => pdfOp('readMetadata', [doc.bytes!.slice().buffer]))
      .then((m) => { setOrig(m); const { hasXmp: _x, ...rest } = m; setMeta(rest); })
      .catch((e) => setError(friendlyError(e).message));
  }, [doc.bytes]);

  const set = (k: keyof MetaEdit, v: string | null) => setMeta((m) => ({ ...m, [k]: v }));
  const changed = orig ? (Object.keys(EMPTY) as (keyof MetaEdit)[]).filter((k) => (meta[k] ?? '') !== (orig[k] ?? '')) : [];
  const dirty = changed.length > 0;

  const run = async () => {
    if (!doc.bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('writeMetadata', [doc.bytes.slice().buffer, meta]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOut(null); setPhase('edit'); setOrig(null); setMeta(EMPTY); };

  if (phase === 'done' && out && doc.file) {
    const cleared = (Object.keys(EMPTY) as (keyof MetaEdit)[]).every((k) => !meta[k]);
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={cleared ? 'All metadata removed!' : 'Properties saved!'} stats={[['Fields changed', String(changed.length)], ['Pages', String(doc.pageCount)], ['Size', formatBytes(out.length)]]}
          highlight="The page content is untouched. Only the document properties changed."
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Edit another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep editing</button>
        </ResultCard>
      </div>
    );
  }

  const inputCls = 'h-11 w-full rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2';
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="See and change title, author, keywords and dates." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && orig && (
        <>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-secondary min-h-11 px-4 text-sm" onClick={() => setMeta(EMPTY)}>Remove all metadata</button>
            {changed.length > 0 && <button type="button" class="btn-secondary min-h-11 px-4 text-sm" onClick={() => { const { hasXmp: _x, ...rest } = orig; setMeta(rest); }}>Undo changes</button>}
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} class={`block ${f.key === 'title' || f.key === 'keywords' ? 'sm:col-span-2' : ''}`}>
                <span class="mb-1 flex items-baseline justify-between gap-2 text-sm font-semibold text-ink dark:text-white">{f.label}
                  {(meta[f.key] ?? '') !== (orig[f.key] ?? '') && <span class="text-xs font-semibold text-brand dark:text-brand-light">changed</span>}
                </span>
                <input type="text" class={inputCls} value={meta[f.key]} placeholder="(empty)" onInput={(e) => set(f.key, (e.target as HTMLInputElement).value)} />
                <span class="mt-1 block text-xs text-muted dark:text-gray-400">{f.hint}</span>
              </label>
            ))}
            {([['created', 'Created'], ['modified', 'Last modified']] as const).map(([k, label]) => (
              <label key={k} class="block">
                <span class="mb-1 block text-sm font-semibold text-ink dark:text-white">{label}</span>
                <div class="flex gap-2">
                  <input type="datetime-local" class={inputCls} value={toLocal(meta[k])} onInput={(e) => set(k, fromLocal((e.target as HTMLInputElement).value))} />
                  {meta[k] && <button type="button" class="btn-secondary min-h-11 shrink-0 px-3 text-sm" onClick={() => set(k, null)} aria-label={`Clear ${label} date`}>Clear</button>}
                </div>
              </label>
            ))}
          </div>
          {orig.hasXmp && <p class="text-xs text-muted dark:text-gray-400">This file also has an XMP metadata block. It is removed when you save, so every viewer shows the values above.</p>}
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Saving properties…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!dirty} onClick={run}>{dirty ? `Save ${changed.length} change${changed.length > 1 ? 's' : ''}` : 'Edit a field to save'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
