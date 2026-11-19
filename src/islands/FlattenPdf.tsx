import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

export default function FlattenPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState(0);
  const [forms, setForms] = useState(true);
  const [annotations, setAnnotations] = useState(true);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ bytes: Uint8Array; fields: number; annots: number } | null>(null);
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
      setOut(await pdfOp('flattenPdf', [bytes.slice().buffer, { forms, annotations }]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setBytes(null); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && file) {
    const nothing = !out.fields && !out.annots;
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={nothing ? 'Nothing needed flattening' : 'Your PDF is flattened!'} stats={[['Form fields', String(out.fields)], ['Comments & markup', String(out.annots)], ['Size', formatBytes(out.bytes.length)]]}
          highlight={nothing ? 'This PDF has no form fields or comments, so it already looks the same everywhere.' : 'Answers and markup are now part of the page and can’t be edited. Links still work.'}
          onDownload={() => downloadBlob(out.bytes, file.name)} downloadLabel={`Download ${file.name.length > 30 ? 'PDF' : file.name}`} onReset={reset} resetLabel="Flatten another PDF" />
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
          <fieldset class="space-y-1">
            <legend class="mb-1 text-sm font-semibold text-ink dark:text-white">What to flatten</legend>
            <label class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={forms} onChange={(e) => setForms((e.target as HTMLInputElement).checked)} /> Form fields (typed answers, checkboxes, dropdowns)</label>
            <label class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={annotations} onChange={(e) => setAnnotations((e.target as HTMLInputElement).checked)} /> Comments, highlights, stamps and drawings</label>
          </fieldset>
          {phase === 'working' ? <ProgressBar label="Flattening…" value={null} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!forms && !annotations} onClick={run}>Flatten PDF</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
