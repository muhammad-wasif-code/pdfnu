import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

type Quality = 'standard' | 'high';
const DPI: Record<Quality, number> = { standard: 150, high: 220 };
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const toDataUrl = (c: HTMLCanvasElement) => c.toDataURL('image/jpeg', 0.88);

export default function PdfToPpt() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState(0);
  const [quality, setQuality] = useState<Quality>('standard');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [out, setOut] = useState<Blob | null>(null);
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
      const [{ openPdf }, { renderPage }, { default: PptxGenJS }] = await Promise.all([import('../lib/pdfjs'), import('../lib/render'), import('pptxgenjs')]);
      const doc = await openPdf(bytes.slice());
      try {
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        const W = first.width / 72, H = first.height / 72; // slide size in inches = first page size
        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'PDF', width: W, height: H });
        pptx.layout = 'PDF';
        pptx.title = stripExt(file!.name);
        pptx.company = 'PDFSherpa';
        for (let n = 1; n <= doc.numPages; n++) {
          setProgress({ label: `Converting page ${n} of ${doc.numPages}…`, value: (n - 1) / doc.numPages });
          const c = await renderPage(doc, n, DPI[quality]);
          // fit the page inside the slide (pages may differ in size)
          const pa = c.width / c.height, sa = W / H;
          const w = pa > sa ? W : H * pa, h = pa > sa ? W / pa : H;
          const slide = pptx.addSlide();
          slide.background = { color: 'FFFFFF' };
          slide.addImage({ data: toDataUrl(c), x: (W - w) / 2, y: (H - h) / 2, w, h, altText: `Page ${n}` });
          c.width = c.height = 0;
        }
        setProgress({ label: 'Building PowerPoint file…', value: 0.97 });
        const data = (await pptx.write({ outputType: 'blob' })) as Blob;
        setOut(new Blob([data], { type: PPTX }));
      } finally { await doc.destroy(); }
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setBytes(null); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PowerPoint is ready!" stats={[['Slides', String(pages)], ['Quality', quality === 'high' ? 'High' : 'Standard'], ['Size', formatBytes(out.size)]]}
          highlight="Each slide shows one page exactly as it looks. Add text boxes or notes on top in PowerPoint, Keynote or Google Slides."
          onDownload={() => downloadBlob(out, `${stripExt(file.name)}.pptx`, PPTX)} downloadLabel="Download .pptx" onReset={reset} resetLabel="Convert another PDF" />
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={open} />
        : <FileRow name={file.name} size={`${pages} pages · ${formatBytes(file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={!file ? () => setError(null) : undefined}>{error}</ErrorBox>}
      {file && (
        <>
          <OptionChips<Quality> label="Slide quality" value={quality} onChange={(v) => v && setQuality(v)} variant="cards"
            options={[{ value: 'standard', label: 'Standard', sub: 'Smaller file' }, { value: 'high', label: 'High', sub: 'Sharper for big screens' }]} />
          <p class="rounded-control bg-surface p-3 text-xs leading-5 text-muted dark:bg-white/5 dark:text-gray-400">
            Every page becomes one slide that looks exactly like the PDF. The page is placed as a picture, so its existing text isn’t editable. You can add new text on top.
          </p>
          {phase === 'working' ? <ProgressBar label={progress.label} value={progress.value} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Convert to PowerPoint</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
