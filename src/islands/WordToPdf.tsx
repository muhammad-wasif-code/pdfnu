import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

/** GIF, BMP, WebP, TIFF (where supported)… → PNG via the browser's own decoders. EMF/WMF are not decodable. */
async function toPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    c.width = c.height = 0;
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch { return null; }
}

export default function WordToPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ blob: Blob; pages: number; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (files: File[]) => {
    const f = files[0];
    setError(null);
    if (/\.doc$/i.test(f.name)) { setError('Old .doc files (Word 97–2003) aren’t supported. Open the file in Word or Google Docs, save it as .docx, then try again.'); return; }
    if (!/\.(docx|docm|dotx)$/i.test(f.name)) { setError(`“${f.name}” is not a Word (.docx) file.`); return; }
    setFile(f);
  };

  const convert = async () => {
    if (!file) return;
    setError(null); setPhase('working');
    try {
      const [{ docxToPdf }, input] = await Promise.all([import('../lib/docxToPdf'), file.arrayBuffer()]);
      const res = await docxToPdf(input, { convertImage: toPng, title: stripExt(file.name) });
      const warnings: string[] = [];
      if (res.missingGlyphs) warnings.push(`${res.missingGlyphs} character${res.missingGlyphs === 1 ? '' : 's'} couldn’t be drawn and may be missing. Check the PDF before sending it.`);
      if (res.skippedImages) warnings.push(`${res.skippedImages} image${res.skippedImages === 1 ? ' was' : 's were'} skipped (EMF/WMF drawings or unreadable images).`);
      setOut({ blob: new Blob([res.pdf as BlobPart], { type: 'application/pdf' }), pages: res.pages, warnings });
      setPhase('done');
    } catch (e) {
      const msg = String((e as Error)?.message ?? '');
      setError(msg === 'NOT_DOCX' ? 'This file isn’t a valid Word document. If it opens in Word, save it again as .docx and retry.'
        : friendlyError(e).message);
      setPhase('edit');
    }
  };
  const reset = () => { setFile(null); setOut(null); setPhase('edit'); setError(null); };

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is ready!" stats={[['Pages', String(out.pages)], ['Word file', formatBytes(file.size)], ['PDF', formatBytes(out.blob.size)]]}
          warnings={out.warnings}
          highlight="Text stays selectable and searchable. Check the PDF once before you send it: complex layouts can differ slightly from Word."
          onDownload={() => downloadBlob(out.blob, `${stripExt(file.name)}.pdf`)} downloadLabel="Download PDF" onReset={reset} resetLabel="Convert another document" />
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept=".docx,.docm,.dotx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document" title="Drag & drop your Word file here" buttonLabel="Select Word file" hint=".docx files" onFiles={pick} />
        : <FileRow name={file.name} size={formatBytes(file.size)} kind="DOCX" onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={reset}>{error}</ErrorBox>}
      {file && (
        <>
          <p class="rounded-control bg-surface p-3 text-xs leading-5 text-muted dark:bg-white/5 dark:text-gray-400">
            Keeps headings, fonts, lists, tables, images, headers and footers, in any language (English, Urdu, Arabic, Hindi and more). Fonts are matched to look-alikes of Calibri, Arial, Times New Roman and Courier.
          </p>
          {phase === 'working' ? <ProgressBar label="Converting to PDF…" />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={convert}>Convert to PDF</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
