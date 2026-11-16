import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import SortableGrid from '../components/ui/SortableGrid';
import PageThumb from '../components/ui/PageThumb';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

interface Item { id: string; file: File; bytes?: Uint8Array; pages?: number; thumb?: string; aspect?: number; }

export default function MergePdf() {
  const [items, setItems] = useState<Item[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [result, setResult] = useState<Uint8Array | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const add = async (files: File[]) => {
    setErrors([]);
    const { readPdf, uid } = await import('../lib/pdfFile');
    const { renderThumbnails } = await import('../lib/thumbs');
    const fresh: Item[] = files.map((file) => ({ id: uid(), file }));
    setItems((cur) => [...cur, ...fresh]);
    for (const it of fresh) {
      try {
        const { bytes, pageCount } = await readPdf(it.file);
        setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, bytes, pages: pageCount } : x)));
        renderThumbnails(bytes, 160, (_i, url, aspect) => {
          urls.current.push(url);
          setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, thumb: url, aspect } : x)));
        }, undefined, [0]).done.catch(() => {});
      } catch (e) {
        setItems((cur) => cur.filter((x) => x.id !== it.id));
        setErrors((cur) => [...cur, friendlyError(e).message]);
      }
    }
  };

  const ready = items.filter((i) => i.bytes);
  const loading = items.length !== ready.length;
  const totalPages = ready.reduce((s, i) => s + (i.pages ?? 0), 0);

  const merge = async () => {
    setPhase('working');
    setFailed(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const out = await pdfOp('merge', [ready.map((i) => i.bytes!.slice().buffer)]);
      setResult(out);
      setPhase('done');
    } catch (e) {
      setFailed(friendlyError(e).message);
      setPhase('edit');
    }
  };

  const reset = () => { setItems([]); setResult(null); setErrors([]); setPhase('edit'); };
  const name = items[0] ? `${stripExt(items[0].file.name)}-merged.pdf` : 'merged.pdf';

  if (phase === 'done' && result) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard
          title="Your PDFs are merged!"
          stats={[['Files', String(ready.length)], ['Pages', String(totalPages)], ['Size', formatBytes(result.length)]]}
          onDownload={() => downloadBlob(result, name)}
          downloadLabel={`Download ${name.length > 30 ? 'merged PDF' : name}`}
          onReset={reset}
          resetLabel="Merge more PDFs"
        >
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change order</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <Dropzone
        accept="application/pdf,.pdf"
        multiple
        compact={items.length > 0}
        title={items.length ? 'Add more PDFs' : 'Drag & drop your PDFs here'}
        buttonLabel={items.length ? 'Add PDFs' : 'Select PDFs'}
        hint={items.length ? undefined : 'Select two or more files. You can reorder them next.'}
        onFiles={add}
      />

      {errors.map((m) => <ErrorBox key={m}>{m}</ErrorBox>)}
      {failed && <ErrorBox>{failed}</ErrorBox>}

      {items.length > 0 && (
        <div>
          <div class="mb-3 flex items-center justify-between gap-3">
            <p class="text-sm font-semibold text-ink dark:text-white">{items.length} file{items.length > 1 ? 's' : ''} · {totalPages} pages</p>
            <p class="text-xs text-muted dark:text-gray-400"><span class="hidden sm:inline">Drag</span><span class="sm:hidden">Press & hold</span> to reorder</p>
          </div>
          <SortableGrid
            class="grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
            items={items}
            getKey={(i) => i.id}
            onReorder={setItems}
            label={(i) => i.file.name}
            render={(it, idx) => (
              <PageThumb url={it.thumb} aspect={it.aspect} caption={it.file.name} sub={it.pages ? `${it.pages} page${it.pages > 1 ? 's' : ''} · ${formatBytes(it.file.size)}` : 'Reading…'} badge={idx >= 0 ? idx + 1 : undefined}>
                {idx >= 0 && (
                  <button
                    type="button"
                    class="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-gray-600 shadow hover:text-danger dark:bg-night-3 dark:text-gray-300"
                    onClick={() => setItems((cur) => cur.filter((x) => x.id !== it.id))}
                    aria-label={`Remove ${it.file.name}`}
                  >
                    <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
                  </button>
                )}
              </PageThumb>
            )}
          />
        </div>
      )}

      {phase === 'working' && <ProgressBar label="Merging PDFs…" value={null} detail="Processing on your device…" />}

      {items.length > 0 && phase !== 'working' && (
        <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={ready.length < 2 || loading} onClick={merge}>
          {loading ? 'Reading files…' : ready.length < 2 ? 'Add at least 2 PDFs' : `Merge ${ready.length} PDFs`}
        </button>
      )}

      <PrivacyNote />
    </div>
  );
}
