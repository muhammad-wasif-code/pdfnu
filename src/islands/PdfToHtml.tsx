import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

/** One island for PDF → HTML and PDF → EPUB. */
export default function PdfToHtml({ target }: { target: 'html' | 'epub' }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'exact' | 'flow'>('exact');
  const [quality, setQuality] = useState<'96' | '150'>('96');
  const [author, setAuthor] = useState('');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState<{ stage: string; v: number | null }>({ stage: '', v: null });
  const [out, setOut] = useState<{ blob: Blob; name: string; info: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!file) return;
    setPhase('working'); setError(null); setProgress({ stage: 'Reading PDF…', v: null });
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const pdf = await readPdf(file);
      const lib = await import('../lib/pdfToHtml');
      const onProgress = (stage: string, d?: number, t?: number) => setProgress({ stage: t ? `${stage} ${d} of ${t}` : stage, v: d !== undefined && t ? d / t : null });
      if (target === 'html') {
        const html = await lib.pdfToHtml(pdf.bytes, mode, { title: stripExt(file.name), quality: +quality, onProgress });
        if (mode === 'flow' && html.replace(/<[^>]+>|\s/g, '').length < 20) throw new Error('NO_TEXT');
        setOut({ blob: new Blob([html], { type: 'text/html' }), name: `${stripExt(file.name)}.html`, info: `${pdf.pageCount} pages` });
      } else {
        const r = await lib.pdfToEpub(pdf.bytes, { title: stripExt(file.name), author, onProgress });
        setOut({ blob: r.epub, name: `${stripExt(file.name)}.epub`, info: `${r.chapters} chapter${r.chapters === 1 ? '' : 's'}` });
      }
      setPhase('done');
    } catch (e) {
      setError((e as Error)?.message === 'NO_TEXT' ? 'No text was found in this PDF. It is probably a scan: run OCR PDF first to make the text readable.' : friendlyError(e).message);
      setPhase('edit');
    }
  };
  const reset = () => { setFile(null); setOut(null); setPhase('edit'); setError(null); };
  const preview = () => { if (out) { const u = URL.createObjectURL(out.blob); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60000); } };

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={target === 'html' ? 'Your HTML file is ready!' : 'Your e-book is ready!'} stats={[['PDF', formatBytes(file.size)], [target === 'html' ? 'Pages' : 'Chapters', out.info.split(' ')[0]], [target === 'html' ? 'HTML' : 'EPUB', formatBytes(out.blob.size)]]}
          highlight={target === 'html' ? (mode === 'exact' ? 'One self-contained file: looks exactly like the PDF, with text you can search and copy.' : 'Clean HTML that reflows on any screen. Ready to paste into a website or CMS.') : 'Opens in Apple Books, Google Play Books, Kobo, Calibre and other EPUB readers. Send it to a Kindle with “Send to Kindle”.'}
          onDownload={() => downloadBlob(out.blob, out.name, out.blob.type)} downloadLabel={`Download ${out.name.length > 30 ? (target === 'html' ? 'HTML' : 'EPUB') : out.name}`} onReset={reset} resetLabel="Convert another PDF">
          {target === 'html' && <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={preview}>Open preview in a new tab</button>}
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={(f) => { setError(null); setFile(f[0]); }} />
        : <FileRow name={file.name} size={formatBytes(file.size)} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={reset}>{error}</ErrorBox>}
      {file && (
        <>
          {target === 'html' ? (
            <>
              <OptionChips<'exact' | 'flow'> label="Layout" value={mode} onChange={(v) => v && setMode(v)} variant="cards" options={[
                { value: 'exact', label: 'Exact copy', sub: 'Looks like the PDF' },
                { value: 'flow', label: 'Clean HTML', sub: 'Text, headings, lists' },
              ]} />
              {mode === 'exact' && <OptionChips<'96' | '150'> label="Picture quality" value={quality} onChange={(v) => v && setQuality(v)} options={[{ value: '96', label: 'Standard (smaller)' }, { value: '150', label: 'High (sharper)' }]} />}
            </>
          ) : (
            <label class="block text-sm">
              <span class="mb-1 block font-semibold text-ink dark:text-white">Author <span class="font-normal text-muted dark:text-gray-400">(optional; taken from the PDF if empty)</span></span>
              <input type="text" value={author} onInput={(e) => setAuthor((e.target as HTMLInputElement).value)} class="h-11 w-full rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" />
            </label>
          )}
          {phase === 'working' ? <ProgressBar label={progress.stage} value={progress.v} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Convert to {target === 'html' ? 'HTML' : 'EPUB'}</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
