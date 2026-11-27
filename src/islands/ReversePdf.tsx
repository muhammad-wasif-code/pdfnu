import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import PageThumb from '../components/ui/PageThumb';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

type Mode = 'all' | 'keep-first' | 'range';

/** Order of 0-based page indexes after reversing. */
export function reversedOrder(n: number, mode: Mode, from: number, to: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (mode === 'keep-first') return n < 2 ? idx : [0, ...idx.slice(1).reverse()];
  if (mode === 'range') {
    const a = Math.max(0, Math.min(from, to) - 1), b = Math.min(n - 1, Math.max(from, to) - 1);
    return [...idx.slice(0, a), ...idx.slice(a, b + 1).reverse(), ...idx.slice(b + 1)];
  }
  return idx.reverse();
}

export default function ReversePdf() {
  const doc = usePdfDoc();
  const [mode, setMode] = useState<Mode>('all');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const order = doc.pageCount ? reversedOrder(doc.pageCount, mode, from, mode === 'range' ? to : doc.pageCount) : [];
  const run = async () => {
    if (!doc.bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('rearrange', [doc.bytes.slice().buffer, order.map((src) => ({ src, rotate: 0 }))]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOut(null); setPhase('edit'); setMode('all'); };
  const open = async (files: File[]) => { await doc.open(files); setFrom(1); setTo(1); };
  const name = doc.file ? `${stripExt(doc.file.name)}-reversed.pdf` : 'reversed.pdf';

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Page order reversed!" stats={[['Pages', String(doc.pageCount)], ['First page now', `Page ${order[0] + 1}`], ['Size', formatBytes(out.length)]]}
          highlight="Nothing was re-compressed: text and images keep their quality."
          onDownload={() => downloadBlob(out, name)} downloadLabel="Download reversed PDF" onReset={reset} resetLabel="Reverse another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change options</button>
        </ResultCard>
      </div>
    );
  }

  const numCls = 'h-11 w-20 rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2';
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="The last page becomes the first." onFiles={open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <>
          <OptionChips<Mode> label="What to reverse" value={mode} onChange={(v) => v && setMode(v)} variant="cards" options={[
            { value: 'all', label: 'All pages', sub: 'Last page first' },
            { value: 'keep-first', label: 'Keep cover', sub: 'Page 1 stays first' },
            { value: 'range', label: 'Some pages', sub: 'Only a range' },
          ]} />
          {mode === 'range' && (
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <label class="flex items-center gap-2">From page <input type="number" min={1} max={doc.pageCount} value={from} class={numCls} onInput={(e) => setFrom(Math.max(1, Math.min(doc.pageCount, +(e.target as HTMLInputElement).value || 1)))} /></label>
              <label class="flex items-center gap-2">to <input type="number" min={1} max={doc.pageCount} value={to} class={numCls} onInput={(e) => setTo(Math.max(1, Math.min(doc.pageCount, +(e.target as HTMLInputElement).value || 1)))} /></label>
            </div>
          )}
          <div>
            <p class="mb-2 text-sm font-semibold text-ink dark:text-white">New order</p>
            <ul class="grid max-h-[28rem] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5 sm:gap-3">
              {order.map((src, i) => (
                <li key={src}><PageThumb url={doc.thumbs[src]?.url} aspect={doc.thumbs[src]?.aspect} caption={`Page ${i + 1}`} sub={src !== i ? `was page ${src + 1}` : 'unchanged'} badge={i + 1} /></li>
              ))}
            </ul>
          </div>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Reversing pages…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={doc.pageCount < 2} onClick={run}>{doc.pageCount < 2 ? 'This PDF has only one page' : 'Reverse page order'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
