import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

/** GIF, BMP, WebP, TIFF, SVG (where the browser can decode them) → PNG. EMF/WMF can't be decoded. */
async function toPng(bytes: Uint8Array, ext: string): Promise<Uint8Array | null> {
  try {
    const type = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    c.width = c.height = 0;
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch { return null; }
}

export default function PptToPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [hidden, setHidden] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [out, setOut] = useState<{ blob: Blob; slides: number; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (files: File[]) => {
    const f = files[0];
    setError(null);
    if (/\.(ppt|pps|pot)$/i.test(f.name)) { setError('Old .ppt files (PowerPoint 97–2003) aren’t supported. Open the file in PowerPoint, Keynote or Google Slides, save it as .pptx, then try again.'); return; }
    if (/\.key$/i.test(f.name)) { setError('Keynote files can’t be read here. In Keynote choose File → Export To → PowerPoint, then convert the .pptx.'); return; }
    if (/\.odp$/i.test(f.name)) { setError('OpenDocument (.odp) files aren’t supported. Save the presentation as .pptx first.'); return; }
    if (!/\.(pptx|pptm|ppsx|potx)$/i.test(f.name)) { setError(`“${f.name}” is not a PowerPoint (.pptx) file.`); return; }
    setFile(f);
  };

  const convert = async () => {
    if (!file) return;
    setError(null); setPhase('working'); setProgress(null);
    try {
      const [{ pptxToPdf }, input] = await Promise.all([import('../lib/pptxToPdf'), file.arrayBuffer()]);
      const res = await pptxToPdf(input, { convertImage: toPng, includeHidden: hidden, title: stripExt(file.name), onProgress: (d, t) => setProgress([d, t]) });
      const warnings: string[] = [];
      if (res.hiddenSkipped) warnings.push(`${res.hiddenSkipped} hidden slide${res.hiddenSkipped === 1 ? ' was' : 's were'} left out. Turn on “Include hidden slides” to keep ${res.hiddenSkipped === 1 ? 'it' : 'them'}.`);
      if (res.skippedObjects) warnings.push(`${res.skippedObjects} item${res.skippedObjects === 1 ? '' : 's'} couldn’t be drawn (for example EMF/WMF pictures, videos or 3D models).`);
      if (res.missingGlyphs) warnings.push(`${res.missingGlyphs} character${res.missingGlyphs === 1 ? '' : 's'} couldn’t be drawn and may be missing.`);
      setOut({ blob: new Blob([res.pdf as BlobPart], { type: 'application/pdf' }), slides: res.slides, warnings });
      setPhase('done');
    } catch (e) {
      const msg = String((e as Error)?.message ?? '');
      setError(msg === 'OLE_FILE' ? 'This is an old-format or password-protected PowerPoint file. Remove the password or save it as .pptx, then try again.'
        : msg === 'NOT_PPTX' ? 'This file isn’t a valid PowerPoint presentation. If it opens in PowerPoint, save it again as .pptx and retry.'
        : msg === 'ALL_HIDDEN' ? 'Every slide in this presentation is hidden. Turn on “Include hidden slides” and convert again.'
        : msg === 'NO_SLIDES' ? 'This presentation has no slides.'
        : friendlyError(e).message);
      setPhase('edit');
    }
  };
  const reset = () => { setFile(null); setOut(null); setPhase('edit'); setError(null); };

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is ready!" stats={[['Slides', String(out.slides)], ['PowerPoint', formatBytes(file.size)], ['PDF', formatBytes(out.blob.size)]]}
          warnings={out.warnings}
          highlight="One page per slide, at the slide’s own size. Text stays selectable and searchable."
          onDownload={() => downloadBlob(out.blob, `${stripExt(file.name)}.pdf`)} downloadLabel="Download PDF" onReset={reset} resetLabel="Convert another presentation" />
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept=".pptx,.pptm,.ppsx,.potx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation" title="Drag & drop your PowerPoint file here" buttonLabel="Select PowerPoint file" hint=".pptx files" onFiles={pick} />
        : <FileRow name={file.name} size={formatBytes(file.size)} kind="PPTX" onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={reset}>{error}</ErrorBox>}
      {file && (
        <>
          <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" class="h-5 w-5 accent-brand" checked={hidden} onChange={(e) => setHidden((e.target as HTMLInputElement).checked)} />
            <span><span class="font-semibold text-ink dark:text-white">Include hidden slides</span> <span class="text-muted dark:text-gray-400">(left out by default, like PowerPoint)</span></span>
          </label>
          <p class="rounded-control bg-surface p-3 text-xs leading-5 text-muted dark:bg-white/5 dark:text-gray-400">
            Keeps slide backgrounds, themes, text, bullets, pictures, shapes, tables, charts and SmartArt, in any language. Animations and videos become still slides.
          </p>
          {phase === 'working' ? <ProgressBar label="Converting slides…" value={progress ? progress[0] / progress[1] : null} detail={progress ? `Slide ${progress[0]} of ${progress[1]}` : 'Reading the presentation…'} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={convert}>Convert to PDF</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
