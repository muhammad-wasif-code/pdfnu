import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { PageSizeName, ResizeOpts } from '../lib/pdfOps';

type Margin = '0' | '18' | '36';
const SIZES: { value: PageSizeName; label: string; sub: string }[] = [
  { value: 'a4', label: 'A4', sub: '210×297 mm' },
  { value: 'letter', label: 'Letter', sub: '8.5×11 in' },
  { value: 'legal', label: 'Legal', sub: '8.5×14 in' },
  { value: 'a3', label: 'A3', sub: '297×420 mm' },
  { value: 'a5', label: 'A5', sub: '148×210 mm' },
];

export default function ResizePdf() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState(0);
  const [size, setSize] = useState<PageSizeName>('a4');
  const [orientation, setOrientation] = useState<ResizeOpts['orientation']>('auto');
  const [margin, setMargin] = useState<Margin>('0');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (files: File[]) => {
    setError(null);
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const pdf = await readPdf(files[0]);
      setFile(files[0]); setBytes(pdf.bytes); setPages(pdf.pageCount);
    } catch (e) { setError(friendlyError(e).message); }
  };
  const run = async () => {
    if (!bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('resizePages', [bytes.slice().buffer, { size, orientation, margin: Number(margin) }]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setBytes(null); setOut(null); setPhase('edit'); };
  const label = SIZES.find((s) => s.value === size)!.label;

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`Every page is now ${label}`} stats={[['Pages', String(pages)], ['Size', label], ['File', formatBytes(out.length)]]}
          highlight="Pages are scaled to fit and centred. Text stays sharp and selectable."
          onDownload={() => downloadBlob(out, file.name)} downloadLabel={`Download ${file.name.length > 30 ? 'PDF' : file.name}`} onReset={reset} resetLabel="Resize another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change settings</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={open} />
        : <FileRow name={file.name} size={`${pages} page${pages === 1 ? '' : 's'} · ${formatBytes(file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={!file ? () => setError(null) : undefined}>{error}</ErrorBox>}
      {file && (
        <>
          <OptionChips<PageSizeName> label="New page size" value={size} onChange={(v) => v && setSize(v)} options={SIZES} />
          <OptionChips<ResizeOpts['orientation']> label="Orientation" value={orientation} onChange={(v) => v && setOrientation(v)}
            options={[{ value: 'auto', label: 'Auto', sub: 'Follow each page' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
          <OptionChips<Margin> label="Margin" value={margin} onChange={(v) => v && setMargin(v)}
            options={[{ value: '0', label: 'None' }, { value: '18', label: 'Small' }, { value: '36', label: 'Large' }]} />
          {phase === 'working' ? <ProgressBar label="Resizing pages…" value={null} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Resize to {label}</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
