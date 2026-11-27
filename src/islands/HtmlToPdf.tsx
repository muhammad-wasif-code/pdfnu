import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { HtmlPage } from '../lib/htmlToPdf';

type Source = 'file' | 'paste';
type Margin = 'none' | 'small' | 'normal';
type Width = 'page' | 'desktop';
const MARGINS: Record<Margin, number> = { none: 0, small: 18, normal: 40 };

export default function HtmlToPdf() {
  const [source, setSource] = useState<Source>('file');
  const [page, setPage] = useState<HtmlPage>('a4');
  const [landscape, setLandscape] = useState(false);
  const [margin, setMargin] = useState<Margin>('normal');
  const [width, setWidth] = useState<Width>('page');
  const [backgrounds, setBackgrounds] = useState(true);
  const [main, setMain] = useState<File | null>(null);
  const [assets, setAssets] = useState<File[]>([]);
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState<{ stage: string; v: number | null }>({ stage: '', v: null });
  const [out, setOut] = useState<{ blob: Blob; pages: number; links: number; warnings: string[]; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = (files: File[]) => {
    setError(null);
    const html = files.filter((f) => /\.(html?|xhtml|mhtml?)$/i.test(f.name) || f.type === 'text/html');
    if (html.some((f) => /\.mhtml?$/i.test(f.name))) { setError('MHTML “web archive” files aren’t supported. In your browser choose Save as → “Webpage, HTML only” or “Webpage, complete”, then add the .html file and its images.'); return; }
    const rest = files.filter((f) => !html.includes(f));
    if (!main && !html.length) { setError('Add an .html or .htm file first. You can add its images and .css files with it.'); return; }
    if (html.length) setMain(html[0]);
    setAssets((cur) => [...cur, ...rest, ...html.slice(1)]);
  };

  const ready = source === 'file' ? !!main : code.trim().length > 0;
  const convert = async () => {
    if (!ready) return;
    setError(null); setPhase('working'); setProgress({ stage: 'Starting…', v: null });
    try {
      const html = source === 'file' ? await main!.text() : code;
      const map = new Map<string, Blob>(source === 'file' ? assets.map((f) => [(f as any).webkitRelativePath || f.name, f]) : []);
      const { htmlToPdf } = await import('../lib/htmlToPdf');
      const name = source === 'file' ? stripExt(main!.name) : 'page';
      const res = await htmlToPdf(html, map, {
        page, landscape, margin: MARGINS[margin], viewport: width === 'desktop' ? 1200 : null, backgrounds, title: source === 'file' ? '' : undefined,
        onProgress: (stage, d, t) => setProgress({ stage, v: d !== undefined && t ? d / t : null }),
      });
      const warnings: string[] = [];
      if (res.skippedImages) warnings.push(`${res.skippedImages} picture${res.skippedImages === 1 ? '' : 's'} couldn’t be added. Pictures linked from other websites can’t be read here: add the image files together with the HTML file.`);
      if (res.missingGlyphs) warnings.push(`${res.missingGlyphs} character${res.missingGlyphs === 1 ? '' : 's'} couldn’t be drawn and may be missing.`);
      setOut({ blob: new Blob([res.pdf as BlobPart], { type: 'application/pdf' }), pages: res.pages, links: res.links, warnings, name: `${name}.pdf` });
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setMain(null); setAssets([]); setOut(null); setPhase('edit'); setError(null); };

  if (phase === 'done' && out) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is ready!" stats={[['Pages', String(out.pages)], ['Links', String(out.links)], ['PDF', formatBytes(out.blob.size)]]}
          warnings={out.warnings} highlight="Text is real text: you can search, select and copy it, and links stay clickable."
          onDownload={() => downloadBlob(out.blob, out.name)} downloadLabel="Download PDF" onReset={reset} resetLabel="Convert another page">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change page settings</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <OptionChips<Source> label="Source" hideLabel value={source} onChange={(v) => v && setSource(v)} options={[{ value: 'file', label: 'Upload HTML file' }, { value: 'paste', label: 'Paste HTML code' }]} />
      {source === 'file' ? (
        <>
          {!main ? <Dropzone accept=".html,.htm,.xhtml,.css,image/*,text/html" multiple title="Drag & drop your HTML file here" buttonLabel="Select HTML file" hint="Add its images and .css files too, so they appear in the PDF." onFiles={add} />
            : <>
              <FileRow name={main.name} size={`${formatBytes(main.size)}${assets.length ? ` · ${assets.length} extra file${assets.length > 1 ? 's' : ''}` : ''}`} kind="HTML" onRemove={phase === 'working' ? undefined : reset} />
              <Dropzone compact accept=".css,image/*,.html,.htm" multiple title="Add images or CSS files" buttonLabel="Add files" onFiles={add} />
              {assets.length > 0 && <p class="truncate text-xs text-muted dark:text-gray-400">{assets.map((a) => a.name).join(', ')}</p>}
            </>}
        </>
      ) : (
        <textarea value={code} onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)} rows={10} spellcheck={false} aria-label="HTML code"
          placeholder={'<h1>Invoice #1024</h1>\n<p>Paste any HTML here, with <style> if you like.</p>'}
          class="block w-full rounded-control border border-line bg-white p-3 font-mono text-[13px] leading-5 outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" />
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      <div class="grid gap-4 sm:grid-cols-2">
        <OptionChips<HtmlPage> label="Page size" value={page} onChange={(v) => v && setPage(v)} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'legal', label: 'Legal' }, { value: 'a3', label: 'A3' }]} />
        <OptionChips<'p' | 'l'> label="Orientation" value={landscape ? 'l' : 'p'} onChange={(v) => v && setLandscape(v === 'l')} options={[{ value: 'p', label: 'Portrait' }, { value: 'l', label: 'Landscape' }]} />
        <OptionChips<Margin> label="Margins" value={margin} onChange={(v) => v && setMargin(v)} options={[{ value: 'none', label: 'None' }, { value: 'small', label: 'Small' }, { value: 'normal', label: 'Normal' }]} />
        <OptionChips<Width> label="Layout" value={width} onChange={(v) => v && setWidth(v)} options={[{ value: 'page', label: 'Fit page width' }, { value: 'desktop', label: 'Desktop (1200 px)' }]} />
      </div>
      <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" class="h-5 w-5 accent-brand" checked={backgrounds} onChange={(e) => setBackgrounds((e.target as HTMLInputElement).checked)} />
        <span><span class="font-semibold text-ink dark:text-white">Background colours</span> <span class="text-muted dark:text-gray-400">(turn off to save ink)</span></span>
      </label>
      {phase === 'working' ? <ProgressBar label={progress.stage || 'Converting…'} value={progress.v} />
        : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!ready} onClick={convert}>{ready ? 'Convert to PDF' : source === 'file' ? 'Select an HTML file' : 'Paste some HTML'}</button>}
      <p class="text-xs text-muted dark:text-gray-400">Scripts in the page don’t run, and nothing is uploaded. To convert a live website, open it, press <kbd>Ctrl</kbd>+<kbd>S</kbd> (<kbd>⌘</kbd>+<kbd>S</kbd> on Mac) to save it as HTML, then add the file here.</p>
      <PrivacyNote />
    </div>
  );
}
