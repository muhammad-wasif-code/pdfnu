import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';

type Dir = 'auto' | 'vertical' | 'horizontal';
export default function SplitHalves() {
  const doc = usePdfDoc(150);
  const [dir, setDir] = useState<Dir>('auto');
  const [rtl, setRtl] = useState(false);
  const [skipFirst, setSkipFirst] = useState(false);
  const [skipLast, setSkipLast] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!doc.bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const r = await pdfOp('splitHalves', [doc.bytes.slice().buffer, { direction: dir, rtl, skipFirst, skipLast }]);
      const whole = (skipFirst ? 1 : 0) + (skipLast && doc.pageCount > 1 ? 1 : 0);
      setPages(doc.pageCount * 2 - whole);
      setOut(r); setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  if (phase === 'done' && out && doc.file) return (
    <div class="card p-4 sm:p-6">
      <ResultCard title="Pages split in half!" stats={[['Before', `${doc.pageCount} pages`], ['After', `${pages} pages`], ['Size', formatBytes(out.length)]]} highlight="Lossless: the halves are cut with the page crop box, nothing is re-compressed."
        onDownload={() => downloadBlob(out, `${stripExt(doc.file!.name)}-split.pdf`)} downloadLabel="Download PDF" onReset={() => { doc.clear(); setOut(null); setPhase('edit'); }} resetLabel="Split another PDF">
        <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change options</button>
      </ResultCard>
    </div>
  );
  const lr = (aspect?: number) => dir === 'vertical' || (dir === 'auto' && (aspect ?? 1.4) < 1);
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your scanned PDF" buttonLabel="Select PDF" hint="Two book pages on each sheet? Split them into single pages." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={doc.clear} />}
      {(doc.error || error) && <ErrorBox>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <>
          <div class="grid gap-4 sm:grid-cols-2">
            <OptionChips<Dir> label="Cut" value={dir} onChange={(v) => v && setDir(v)} options={[{ value: 'auto', label: 'Auto' }, { value: 'vertical', label: 'Left | right' }, { value: 'horizontal', label: 'Top / bottom' }]} />
            <OptionChips<'l' | 'r'> label="Reading order" value={rtl ? 'r' : 'l'} onChange={(v) => v && setRtl(v === 'r')} options={[{ value: 'l', label: 'Left page first' }, { value: 'r', label: 'Right first (Urdu, Arabic)' }]} />
          </div>
          <div class="flex flex-wrap gap-4 text-sm">
            <label class="flex min-h-9 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={skipFirst} onChange={(e) => setSkipFirst((e.target as HTMLInputElement).checked)} />Keep first page whole (cover)</label>
            <label class="flex min-h-9 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={skipLast} onChange={(e) => setSkipLast((e.target as HTMLInputElement).checked)} />Keep last page whole</label>
          </div>
          <ul class="grid max-h-[26rem] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
            {doc.thumbs.map((t, i) => (
              <li key={i} class="relative">
                <div class="relative overflow-hidden rounded border border-line bg-white"><img src={t.url} alt={`Page ${i + 1}`} class="block w-full" />
                  {!((skipFirst && i === 0) || (skipLast && i === doc.pageCount - 1)) && <span class={`absolute bg-danger ${lr(t.aspect) ? 'inset-y-0 left-1/2 w-0.5' : 'inset-x-0 top-1/2 h-0.5'}`} />}
                </div>
                <p class="mt-1 text-center text-xs">Page {i + 1}</p>
              </li>
            ))}
          </ul>
          {phase === 'working' ? <ProgressBar label="Splitting…" value={null} /> : <button type="button" class="btn-primary min-h-12 w-full" onClick={run}>Split pages in half</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
