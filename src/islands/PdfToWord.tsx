import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { OcrLang } from '../lib/ocr';
import type { Block } from '../lib/markdown';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OCR_DPI = 250;
const LANGS: { value: OcrLang; label: string }[] = [
  { value: 'eng', label: 'English' }, { value: 'urd', label: 'اردو Urdu' }, { value: 'hin', label: 'हिन्दी Hindi' },
];

/** OCR text of one page → paragraphs (Tesseract separates paragraphs with blank lines). */
function ocrBlocks(text: string): Block[] {
  return text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map((t) => ({ type: 'p', text: t }));
}

export default function PdfToWord() {
  const [file, setFile] = useState<File | null>(null);
  const [pageBreaks, setPageBreaks] = useState(true);
  const [lang, setLang] = useState<OcrLang>('eng');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done' | 'empty'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [out, setOut] = useState<{ blob: Blob; pages: number; headings: number; ocr: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const build = async (blocks: Block[], pages: number, size: { w: number; h: number }, ocr: boolean) => {
    const { blocksToDocx } = await import('../lib/docxWrite');
    setProgress({ label: 'Building Word file…', value: 0.97 });
    const bytes = await blocksToDocx(blocks, { pageWidth: size.w, pageHeight: size.h, pageBreaks, title: stripExt(file!.name) });
    setOut({ blob: new Blob([bytes as BlobPart], { type: DOCX }), pages, headings: blocks.filter((b) => b.type === 'h').length, ocr });
    setPhase('done');
  };

  const convert = async () => {
    if (!file) return;
    setError(null); setPhase('working');
    try {
      const [{ readPdf }, { openPdf }, { readLines, toBlocks }] = await Promise.all([import('../lib/pdfFile'), import('../lib/pdfjs'), import('../lib/markdown')]);
      const pdf = await readPdf(file);
      const doc = await openPdf(pdf.bytes.slice());
      try {
        const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
        const lines = await readLines(doc, (n, of) => setProgress({ label: `Reading page ${n} of ${of}…`, value: (n / of) * 0.9 }), { styles: true });
        const blocks = toBlocks(lines);
        if (!blocks.some((b) => b.type !== 'page')) { setPhase('empty'); return; }
        await build(blocks, doc.numPages, { w: vp.width, h: vp.height }, false);
      } finally { await doc.destroy(); }
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };

  /** Scanned PDF: recognise the text first (English, Urdu or Hindi). */
  const convertOcr = async () => {
    if (!file) return;
    setError(null); setPhase('working');
    let ocr: Awaited<ReturnType<typeof import('../lib/ocr').createOcr>> | null = null;
    try {
      const [{ readPdf }, { openPdf }, { renderPage }, { createOcr }] = await Promise.all([import('../lib/pdfFile'), import('../lib/pdfjs'), import('../lib/render'), import('../lib/ocr')]);
      setProgress({ label: 'Loading text recognition (first time only, a few MB)…', value: 0 });
      let stage = '';
      ocr = await createOcr(lang, (status, p) => {
        if (/loading|initializ/i.test(status)) setProgress({ label: 'Loading text recognition (first time only, a few MB)…', value: p });
        else if (/recogniz/i.test(status)) setProgress({ label: stage, value: p });
      });
      const pdf = await readPdf(file);
      const doc = await openPdf(pdf.bytes.slice());
      try {
        const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
        const blocks: Block[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          stage = `Reading page ${n} of ${doc.numPages}…`;
          setProgress({ label: stage, value: 0 });
          const c = await renderPage(doc, n, OCR_DPI);
          const r = await ocr.recognize(c);
          c.width = c.height = 0;
          if (n > 1) blocks.push({ type: 'page' });
          blocks.push(...ocrBlocks(r.text));
        }
        if (!blocks.some((b) => b.type !== 'page')) { setError('No text could be recognised. Check the language, or try a sharper scan.'); setPhase('empty'); return; }
        await build(blocks, doc.numPages, { w: vp.width, h: vp.height }, true);
      } finally { await doc.destroy(); }
    } catch (e) { setError(friendlyError(e).message); setPhase('empty'); }
    finally { await ocr?.terminate(); }
  };

  const reset = () => { setFile(null); setOut(null); setPhase('edit'); setError(null); };

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your Word document is ready!" stats={[['Pages', String(out.pages)], [out.ocr ? 'Source' : 'Headings', out.ocr ? 'OCR' : String(out.headings)], ['Size', formatBytes(out.blob.size)]]}
          highlight={out.ocr ? 'The text was recognised from the scan, so check names and numbers before you use it.' : 'Text, headings, bold and italic are fully editable. Open the file in Word, Google Docs, Pages or LibreOffice.'}
          onDownload={() => downloadBlob(out.blob, `${stripExt(file.name)}.docx`, DOCX)} downloadLabel="Download .docx" onReset={reset} resetLabel="Convert another PDF" />
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={(f) => { setError(null); setFile(f[0]); }} />
        : <FileRow name={file.name} size={formatBytes(file.size)} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={reset}>{error}</ErrorBox>}
      {file && phase === 'empty' && (
        <div class="space-y-4">
          <p class="rounded-control border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
            This PDF has no text layer. It’s probably a scan or photo. PDFSherpa can read the text with OCR first. Choose the language of the document.
          </p>
          <OptionChips<OcrLang> label="Language of the text" value={lang} onChange={(v) => v && setLang(v)} options={LANGS} />
          <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={convertOcr}>Recognise text and convert</button>
        </div>
      )}
      {file && (phase === 'edit' || phase === 'working') && (
        <>
          <label class="flex min-h-11 items-center gap-3 text-sm text-ink dark:text-gray-100">
            <input type="checkbox" class="h-5 w-5 accent-brand" checked={pageBreaks} disabled={phase === 'working'} onChange={(e) => setPageBreaks((e.target as HTMLInputElement).checked)} />
            Start a new Word page where each PDF page begins
          </label>
          <p class="rounded-control bg-surface p-3 text-xs leading-5 text-muted dark:bg-white/5 dark:text-gray-400">
            You get editable text with headings, paragraphs, lists, bold and italic, in any language. Exact positions, columns, tables and images are not copied, so complex layouts will look simpler than the PDF.
          </p>
          {phase === 'working' ? <ProgressBar label={progress.label || 'Reading PDF…'} value={progress.value} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={convert}>Convert to Word</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
