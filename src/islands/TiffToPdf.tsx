import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

export default function TiffToPdf() {
  const [files, setFiles] = useState<File[]>([]);
  const [page, setPage] = useState<'image' | 'a4' | 'letter'>('image');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ bytes: Uint8Array; pages: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = (fs: File[]) => {
    setError(null);
    const ok = fs.filter((f) => /\.tiff?$/i.test(f.name) || f.type === 'image/tiff');
    if (ok.length < fs.length) setError('Only .tif / .tiff files can be added here. For JPG or PNG pictures, use JPG to PDF.');
    setFiles((c) => [...c, ...ok]);
  };
  const run = async () => {
    if (!files.length) return;
    setPhase('working'); setError(null);
    try {
      const bufs = await Promise.all(files.map((f) => f.arrayBuffer()));
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('tiffToPdf', [bufs, { page, margin: page === 'image' ? 0 : 18 }], bufs));
      setPhase('done');
    } catch (e) {
      const m = String((e as Error)?.message ?? '');
      setError(m === 'NOT_TIFF' ? 'One of the files isn’t a valid TIFF image.' : m === 'BIGTIFF' ? 'BigTIFF files (over 4 GB format) aren’t supported.'
        : m === 'UNSUPPORTED_COMPRESSION' ? 'This TIFF uses a compression that can’t be read here (for example old-style JPEG). Open it in an image viewer and save it again as TIFF or PNG.'
        : friendlyError(e).message);
      setPhase('edit');
    }
  };
  const reset = () => { setFiles([]); setOut(null); setPhase('edit'); setError(null); };
  const name = files.length === 1 ? `${stripExt(files[0].name)}.pdf` : 'tiff-images.pdf';

  if (phase === 'done' && out) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is ready!" stats={[['TIFF files', String(files.length)], ['Pages', String(out.pages)], ['PDF', formatBytes(out.bytes.length)]]}
          highlight="Image data was copied without re-compression, so scans keep their exact quality."
          warnings={out.skipped ? [`${out.skipped} page${out.skipped === 1 ? '' : 's'} couldn’t be read and ${out.skipped === 1 ? 'was' : 'were'} left out.`] : undefined}
          onDownload={() => downloadBlob(out.bytes, name)} downloadLabel="Download PDF" onReset={reset} resetLabel="Convert more TIFFs" />
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <Dropzone accept=".tif,.tiff,image/tiff" multiple compact={files.length > 0} title={files.length ? 'Add more TIFF files' : 'Drag & drop your TIFF files here'} buttonLabel={files.length ? 'Add TIFFs' : 'Select TIFF files'} hint={files.length ? undefined : 'Multi-page scans and faxes work too.'} onFiles={add} />
      {error && <ErrorBox>{error}</ErrorBox>}
      {files.length > 0 && (
        <>
          <ul class="space-y-1 text-sm">
            {files.map((f, i) => (
              <li key={i} class="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 dark:bg-white/5">
                <span class="truncate">{i + 1}. {f.name} <span class="text-muted dark:text-gray-400">· {formatBytes(f.size)}</span></span>
                <button type="button" class="grid h-8 w-8 shrink-0 place-items-center text-muted hover:text-danger" aria-label={`Remove ${f.name}`} onClick={() => setFiles((c) => c.filter((_, k) => k !== i))}>✕</button>
              </li>
            ))}
          </ul>
          <OptionChips<'image' | 'a4' | 'letter'> label="Page size" value={page} onChange={(v) => v && setPage(v)} options={[{ value: 'image', label: 'Same as image' }, { value: 'a4', label: 'A4 (fit)' }, { value: 'letter', label: 'Letter (fit)' }]} />
          {phase === 'working' ? <ProgressBar label="Converting…" value={null} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Convert to PDF</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
