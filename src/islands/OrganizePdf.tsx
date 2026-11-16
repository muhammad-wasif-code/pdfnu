import { useEffect, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import PageThumb from '../components/ui/PageThumb';
import SortableGrid from '../components/ui/SortableGrid';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import IconButton from '../components/ui/IconButton';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

interface P { id: string; src: number; rotate: number; }

export default function OrganizePdf() {
  const doc = usePdfDoc();
  const [pages, setPages] = useState<P[]>([]);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initial = () => Array.from({ length: doc.pageCount }, (_, i) => ({ id: `p${i}`, src: i, rotate: 0 }));
  useEffect(() => { setPages(initial()); }, [doc.pageCount, doc.file]);

  const deleted = doc.pageCount - pages.length;
  const moved = pages.some((p, i) => p.src !== i) || pages.some((p) => p.rotate) || deleted > 0;

  const apply = async () => {
    if (!doc.bytes || !pages.length) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('rearrange', [doc.bytes.slice().buffer, pages.map(({ src, rotate }) => ({ src, rotate }))]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setPages([]); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is organized!" stats={[['Pages before', String(doc.pageCount)], ['Pages now', String(pages.length)], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Organize another PDF">
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

      {doc.file && pages.length + deleted > 0 && (
        <>
          <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span class="font-semibold text-ink dark:text-white">{pages.length} pages{deleted ? ` · ${deleted} deleted` : ''}</span>
            <span class="flex items-center gap-3">
              <span class="text-xs text-muted dark:text-gray-400"><span class="hidden sm:inline">Drag</span><span class="sm:hidden">Press & hold</span> to move</span>
              {moved && <button type="button" class="min-h-9 font-semibold text-brand dark:text-brand-light" onClick={() => setPages(initial())}>Reset</button>}
            </span>
          </div>
          <SortableGrid
            class="max-h-[34rem] grid-cols-3 overflow-y-auto p-0.5 sm:grid-cols-5"
            items={pages}
            getKey={(p) => p.id}
            onReorder={setPages}
            label={(p) => `page ${p.src + 1}`}
            render={(p, idx) => {
              const t = doc.thumbs[p.src] ?? {};
              return (
                <PageThumb url={t.url} aspect={t.aspect} rotate={p.rotate} caption={`Page ${p.src + 1}`} badge={idx >= 0 ? idx + 1 : undefined}>
                  {idx >= 0 && (
                    <span class="absolute right-1 top-1 flex flex-col gap-1">
                      <IconButton icon="trash" tone="danger" label={`Delete page ${p.src + 1}`} onClick={() => setPages((c) => c.filter((x) => x.id !== p.id))} />
                      <IconButton icon="rotateRight" label={`Rotate page ${p.src + 1}`} onClick={() => setPages((c) => c.map((x) => (x.id === p.id ? { ...x, rotate: (x.rotate + 90) % 360 } : x)))} />
                    </span>
                  )}
                </PageThumb>
              );
            }}
          />
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Saving your PDF…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!moved || !pages.length} onClick={apply}>
                {!pages.length ? 'Keep at least one page' : moved ? 'Save changes' : 'Move, rotate or delete pages first'}
              </button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
