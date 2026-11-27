import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

type Q = '100' | '150' | '200' | '300';
export default function RasterizePdf() {
  const [file, setFile] = useState<File | null>(null);
  const [dpi, setDpi] = useState<Q>('150');
  const [gray, setGray] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!file) return;
    setPhase('working'); setError(null);
    try {
      const [{ readPdf }, { openPdf }, { renderPage }, { pdfOp }] = await Promise.all([import('../lib/pdfFile'), import('../lib/pdfjs'), import('../lib/render'), import('../lib/pdfWorker')]);
      const pdf = await readPdf(file);
      const d = await openPdf(pdf.bytes.slice());
      const pages: { jpeg: ArrayBuffer; w: number; h: number }[] = [];
      try {
        for (let n = 1; n <= d.numPages; n++) {
          setProgress([n, d.numPages]);
          const pg = await d.getPage(n); const vp = pg.getViewport({ scale: 1 }); pg.cleanup();
          const c = await renderPage(d, n, +dpi);
          if (gray) { const ctx = c.getContext('2d')!; const im = ctx.getImageData(0, 0, c.width, c.height); const a = im.data; for (let i = 0; i < a.length; i += 4) { const l = (a[i] * 299 + a[i + 1] * 587 + a[i + 2] * 114) / 1000; a[i] = a[i + 1] = a[i + 2] = l; } ctx.putImageData(im, 0, 0); }
          const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
          c.width = c.height = 0;
          if (!blob) throw new Error('ENCODE');
          pages.push({ jpeg: await blob.arrayBuffer(), w: vp.width, h: vp.height });
        }
      } finally { await d.destroy(); }
      setOut(await pdfOp('jpegsToPdf', [pages], pages.map((p) => p.jpeg)));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  if (phase === 'done' && out && file) return (
    <div class="card p-4 sm:p-6">
      <ResultCard title="PDF flattened to images!" stats={[['Pages', String(progress[1])], ['Quality', `${dpi} DPI`], ['Size', formatBytes(out.length)]]}
        highlight="Every page is now a picture: text can’t be selected, copied or edited, and hidden layers, form fields and comments are gone."
        onDownload={() => downloadBlob(out, `${stripExt(file.name)}-flat.pdf`)} downloadLabel="Download PDF" onReset={() => { setFile(null); setOut(null); setPhase('edit'); }} resetLabel="Flatten another PDF" />
    </div>
  );
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Turn every page into an image." onFiles={(f) => setFile(f[0])} /> : <FileRow name={file.name} size={formatBytes(file.size)} onRemove={() => setFile(null)} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {file && (
        <>
          <OptionChips<Q> label="Image quality" value={dpi} onChange={(v) => v && setDpi(v)} options={[{ value: '100', label: '100 DPI (small)' }, { value: '150', label: '150 DPI' }, { value: '200', label: '200 DPI' }, { value: '300', label: '300 DPI (print)' }]} />
          <label class="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={gray} onChange={(e) => setGray((e.target as HTMLInputElement).checked)} />Black & white</label>
          <p class="text-xs text-muted dark:text-gray-400">Note: this is not a security feature on its own. Hidden text is removed, but anything visible on the page remains visible. To black out details first, use Redact PDF.</p>
          {phase === 'working' ? <ProgressBar label="Rendering pages…" value={progress[1] ? progress[0] / progress[1] : null} detail={progress[1] ? `Page ${progress[0]} of ${progress[1]}` : undefined} /> : <button type="button" class="btn-primary min-h-12 w-full" onClick={run}>Flatten to images</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
