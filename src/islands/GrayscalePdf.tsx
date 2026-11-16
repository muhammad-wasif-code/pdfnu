import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, percentSaved } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

export default function GrayscalePdf() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState(0);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (files: File[]) => {
    setError(null);
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const pdf = await readPdf(files[0]);
      setFile(files[0]); setBytes(pdf.bytes); setPages(pdf.pageCount);
      import('../lib/ghostscript').then((m) => m.warmupGhostscript());
    } catch (e) { setError(friendlyError(e).message); }
  };

  const run = async () => {
    if (!bytes) return;
    setPhase('working'); setError(null);
    try {
      const { runGhostscriptArgs, grayscaleArgs } = await import('../lib/ghostscript');
      setOut(await runGhostscriptArgs(bytes, grayscaleArgs()));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setBytes(null); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && file) {
    const smaller = out.length < file.size;
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard
          title="Your PDF is now black & white!"
          stats={[['Pages', String(pages)], ['Before', formatBytes(file.size)], ['After', formatBytes(out.length)]]}
          highlight={smaller ? `${percentSaved(file.size, out.length)}% smaller · text stays selectable` : 'Text stays selectable. Size may grow slightly when fonts are embedded for consistent printing.'}
          onDownload={() => downloadBlob(out, file.name)}
          downloadLabel={`Download ${file.name.length > 30 ? 'PDF' : file.name}`}
          onReset={reset}
          resetLabel="Convert another PDF"
        />
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={open} />
        : <FileRow name={file.name} size={`${pages} pages · ${formatBytes(file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={!file ? () => setError(null) : undefined}>{error}</ErrorBox>}
      {file && (phase === 'working'
        ? <ProgressBar label="Converting to grayscale…" value={null} detail="First use downloads the PDF engine once (about 11 MB), then it works offline." />
        : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Convert to grayscale</button>)}
      <PrivacyNote />
    </div>
  );
}
