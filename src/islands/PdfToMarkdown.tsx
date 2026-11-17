import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { MdLine } from '../lib/markdown';

export default function PdfToMarkdown() {
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<MdLine[]>([]);
  const [pages, setPages] = useState(0);
  const [breaks, setBreaks] = useState(false);
  const [md, setMd] = useState('');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const convert = async (f: File) => {
    setError(null); setPhase('working'); setFile(f);
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const { openPdf } = await import('../lib/pdfjs');
      const { readLines, toMarkdown } = await import('../lib/markdown');
      const pdf = await readPdf(f);
      const doc = await openPdf(pdf.bytes.slice());
      try {
        const l = await readLines(doc, (n, of) => setProgress({ label: `Reading page ${n} of ${of}…`, value: n / of }));
        setLines(l); setPages(doc.numPages); setMd(toMarkdown(l, { pageBreaks: breaks }));
      } finally { await doc.destroy(); }
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); setFile(null); }
  };
  const toggleBreaks = async (v: boolean) => {
    setBreaks(v);
    const { toMarkdown } = await import('../lib/markdown');
    setMd(toMarkdown(lines, { pageBreaks: v }));
  };
  const reset = () => { setFile(null); setLines([]); setMd(''); setPhase('edit'); setCopied(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };
  const headings = (md.match(/^#{1,4} /gm) ?? []).length;

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={(f) => convert(f[0])} />
        : <FileRow name={file.name} size={phase === 'done' ? `${pages} pages · ${formatBytes(file.size)}` : formatBytes(file.size)} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={() => setError(null)}>{error}</ErrorBox>}
      {phase === 'working' && <ProgressBar label={progress.label || 'Reading PDF…'} value={progress.value} />}

      {phase === 'done' && (!md.trim() ? (
        <ErrorBox>No text was found. This PDF is probably a scan or photo, so its "text" is really an image.</ErrorBox>
      ) : (
        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span class="font-semibold text-ink dark:text-white">{headings} heading{headings === 1 ? '' : 's'} · {md.length.toLocaleString()} characters</span>
            <label class="flex min-h-11 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={breaks} onChange={(e) => toggleBreaks((e.target as HTMLInputElement).checked)} /> Page breaks (---)</label>
          </div>
          <label class="sr-only" for="md-out">Markdown</label>
          <textarea id="md-out" readOnly value={md.length > 200_000 ? md.slice(0, 200_000) + '\n\n… (preview truncated; download for the full file)' : md}
            class="h-80 w-full resize-y rounded-control border border-line bg-surface p-3 font-mono text-[13px] leading-5 text-ink dark:border-white/10 dark:bg-white/[.03] dark:text-gray-100" />
          <div class="grid gap-3 sm:grid-cols-2">
            <button type="button" class="btn-primary min-h-12 text-[15px]" onClick={() => downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${stripExt(file!.name)}.md`, 'text/markdown')}>Download .md</button>
            <button type="button" class="btn-secondary min-h-12" onClick={copy}>{copied ? 'Copied ✓' : 'Copy Markdown'}</button>
          </div>
          <button type="button" class="btn-ghost w-full" onClick={reset}>Convert another PDF</button>
        </div>
      ))}
      <PrivacyNote />
    </div>
  );
}
