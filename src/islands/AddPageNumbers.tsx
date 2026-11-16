import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import PositionPicker, { previewStyle } from '../components/ui/PositionPicker';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { PageNumberOpts, Position } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';

type Format = PageNumberOpts['format'];
const FORMATS: { value: Format; label: string }[] = [
  { value: 'n', label: '1' }, { value: 'page-n', label: 'Page 1' }, { value: 'n-of-total', label: '1 / 10' }, { value: 'page-n-of-total', label: 'Page 1 of 10' },
];

export default function AddPageNumbers() {
  const doc = usePdfDoc(320, true);
  const [position, setPosition] = useState<Position>('bottom-center');
  const [format, setFormat] = useState<Format>('n');
  const [start, setStart] = useState(1);
  const [size, setSize] = useState<'9' | '11' | '14'>('11');
  const [skipFirst, setSkipFirst] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!doc.bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('pageNumbers', [doc.bytes.slice().buffer, { position: position as PageNumberOpts['position'], format, start: Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 1, fontSize: Number(size), skipFirst }]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    const last = start + doc.pageCount - 1 - (skipFirst ? 1 : 0);
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Page numbers added!" stats={[['Pages', String(doc.pageCount)], ['Numbered', `${start}–${last}`], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Number another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Adjust options</button>
        </ResultCard>
      </div>
    );
  }

  const total = start + doc.pageCount - 1 - (skipFirst ? 1 : 0);
  const sample = { n: `${start}`, 'page-n': `Page ${start}`, 'n-of-total': `${start} / ${total}`, 'page-n-of-total': `Page ${start} of ${total}` }[format];
  const first = doc.thumbs[0];

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}

      {doc.file && (
        <div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_220px]">
          <div class="space-y-4">
            <OptionChips label="Format" options={FORMATS} value={format} onChange={(v) => v && setFormat(v)} />
            <div class="flex flex-wrap gap-6">
              <PositionPicker value={position} onChange={setPosition} allowCenter={false} />
              <div class="space-y-4">
                <label class="block">
                  <span class="mb-1.5 block text-sm font-semibold text-ink dark:text-white">Start at</span>
                  <input type="number" min={0} max={99999} value={start} onInput={(e) => setStart(Number((e.target as HTMLInputElement).value))}
                    class="h-11 w-28 rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 dark:border-white/10 dark:bg-night-2" />
                </label>
                <OptionChips label="Text size" options={[{ value: '9', label: 'S' }, { value: '11', label: 'M' }, { value: '14', label: 'L' }]} value={size} onChange={(v) => v && setSize(v)} />
              </div>
            </div>
            <label class="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" class="h-5 w-5 accent-brand" checked={skipFirst} onChange={(e) => setSkipFirst((e.target as HTMLInputElement).checked)} />
              Don’t number the first page (cover)
            </label>
          </div>
          <div>
            <p class="mb-2 text-sm font-semibold text-ink dark:text-white">Preview</p>
            <div class="relative mx-auto w-full max-w-[220px] overflow-hidden rounded-md border border-line bg-white shadow-sm dark:border-white/10" style={{ aspectRatio: first?.aspect ? `1 / ${first.aspect}` : '1 / 1.414', containerType: 'inline-size' }} aria-hidden="true">
              {first?.url && <img src={first.url} alt="" class="absolute inset-0 h-full w-full object-contain" />}
              {!skipFirst && <span style={{ ...previewStyle(position), fontSize: `${Number(size) * 0.62}cqw`, color: '#333', fontFamily: 'Helvetica, Arial, sans-serif', whiteSpace: 'nowrap', background: 'rgba(255,255,255,.6)', padding: '0 2px' }}>{sample}</span>}
            </div>
            <p class="mt-2 text-center text-xs text-muted dark:text-gray-400">{skipFirst ? 'Page 1 stays unnumbered' : 'Page 1 shown'}</p>
          </div>
        </div>
      )}

      {doc.file && (phase === 'working' ? <ProgressBar label="Adding page numbers…" value={null} /> : (
        <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Add page numbers</button>
      ))}
      <PrivacyNote />
    </div>
  );
}
