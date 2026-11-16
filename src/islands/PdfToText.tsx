import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

export default function PdfToText() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [text, setText] = useState('');
  const [pages, setPages] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breaks, setBreaks] = useState(true);

  const extract = async (f: File) => {
    setError(null); setPhase('working'); setFile(f);
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const { openPdf } = await import('../lib/pdfjs');
      const pdf = await readPdf(f);
      const doc = await openPdf(pdf.bytes.slice());
      const parts: string[] = [];
      try {
        for (let n = 1; n <= doc.numPages; n++) {
          setProgress({ label: `Reading page ${n} of ${doc.numPages}…`, value: n / doc.numPages });
          const page = await doc.getPage(n);
          const content = await page.getTextContent();
          let line = '';
          const lines: string[] = [];
          for (const item of content.items as any[]) {
            if (typeof item.str !== 'string') continue;
            line += item.str;
            if (item.hasEOL) { lines.push(line.trimEnd()); line = ''; }
          }
          if (line) lines.push(line.trimEnd());
          parts.push(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
          page.cleanup();
        }
        setPages(doc.numPages);
      } finally { await doc.destroy(); }
      setText(parts.map((p, i) => (parts.length > 1 ? `--- Page ${i + 1} ---\n${p}` : p)).join('\n\n'));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); setFile(null); }
  };

  const output = breaks ? text : text.replace(/^--- Page \d+ ---\n/gm, '');
  const words = output.trim() ? output.trim().split(/\s+/).length : 0;
  const empty = phase === 'done' && !text.replace(/--- Page \d+ ---/g, '').trim();
  const reset = () => { setFile(null); setText(''); setPhase('edit'); setCopied(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={(f) => extract(f[0])} />
        : <FileRow name={file.name} size={phase === 'done' ? `${pages} pages · ${formatBytes(file.size)}` : formatBytes(file.size)} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={() => setError(null)}>{error}</ErrorBox>}
      {phase === 'working' && <ProgressBar label={progress.label || 'Reading PDF…'} value={progress.value} />}

      {phase === 'done' && (empty ? (
        <ErrorBox>
          No text was found. This PDF is probably a scan or photo, so its "text" is really an image. Text recognition (OCR) is coming to PDFSherpa soon.
        </ErrorBox>
      ) : (
        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span class="font-semibold text-ink dark:text-white">{words.toLocaleString()} words · {output.length.toLocaleString()} characters</span>
            <label class="flex min-h-11 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={breaks} onChange={(e) => setBreaks((e.target as HTMLInputElement).checked)} /> Page markers</label>
          </div>
          <label class="sr-only" for="pdf-text-out">Extracted text</label>
          <textarea id="pdf-text-out" readOnly value={output.length > 200_000 ? output.slice(0, 200_000) + '\n\n… (preview truncated; download for full text)' : output}
            class="h-72 w-full resize-y rounded-control border border-line bg-surface p-3 font-mono text-[13px] leading-5 text-ink dark:border-white/10 dark:bg-white/[.03] dark:text-gray-100" />
          <div class="grid gap-3 sm:grid-cols-2">
            <button type="button" class="btn-primary min-h-12 text-[15px]" onClick={() => downloadBlob(new Blob([output], { type: 'text/plain;charset=utf-8' }), `${stripExt(file!.name)}.txt`, 'text/plain')}>Download .txt</button>
            <button type="button" class="btn-secondary min-h-12" onClick={copy}>{copied ? 'Copied ✓' : 'Copy all text'}</button>
          </div>
          <button type="button" class="btn-ghost w-full" onClick={reset}>Extract from another PDF</button>
        </div>
      ))}
      <PrivacyNote />
    </div>
  );
}
