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

type Kind = 'text' | 'markdown' | 'epub' | 'odt';
type Font = 'sans' | 'serif' | 'mono';
const CFG: Record<Kind, { accept: string; re: RegExp; label: string; kind: string; paste: boolean; page: HtmlPage; font: Font; size: number; placeholder?: string }> = {
  text: { accept: '.txt,.text,.log,.csv,.md,.json,.xml,.ini,.cfg,.conf,.yaml,.yml,text/plain', re: /\.(txt|text|log|csv|md|json|xml|ini|cfg|conf|ya?ml|tsv|srt|vtt|nfo|me)$|^readme$/i, label: 'text file', kind: 'TXT', paste: true, page: 'a4', font: 'mono', size: 13, placeholder: 'Type or paste text here…' },
  markdown: { accept: '.md,.markdown,.mdown,.mkd,.txt,text/markdown', re: /\.(md|markdown|mdown|mkd|mdx|txt)$/i, label: 'Markdown file', kind: 'MD', paste: true, page: 'a4', font: 'sans', size: 15, placeholder: '# Title\n\nPaste **Markdown** here…' },
  epub: { accept: '.epub,application/epub+zip', re: /\.epub$/i, label: 'EPUB e-book', kind: 'EPUB', paste: false, page: 'a5', font: 'serif', size: 15 },
  odt: { accept: '.odt,.ott,application/vnd.oasis.opendocument.text', re: /\.(odt|ott)$/i, label: 'ODT document', kind: 'ODT', paste: false, page: 'a4', font: 'sans', size: 15 },
};
const MARGINS = { none: 0, small: 24, normal: 50 } as const;

export default function DocToPdf({ kind }: { kind: Kind }) {
  const cfg = CFG[kind];
  const [source, setSource] = useState<'file' | 'paste'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [page, setPage] = useState<HtmlPage>(cfg.page);
  const [landscape, setLandscape] = useState(false);
  const [margin, setMargin] = useState<keyof typeof MARGINS>('normal');
  const [font, setFont] = useState<Font>(cfg.font);
  const [size, setSize] = useState(cfg.size);
  const [bookCss, setBookCss] = useState(true);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState<{ stage: string; v: number | null }>({ stage: '', v: null });
  const [out, setOut] = useState<{ blob: Blob; pages: number; name: string; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (files: File[]) => {
    const f = files[0];
    setError(null);
    if (kind === 'odt' && /\.(docx?|rtf)$/i.test(f.name)) { setError(/\.docx$/i.test(f.name) ? 'This is a Word file. Use Word to PDF instead.' : 'Only OpenDocument (.odt) files are supported here. Save the file as .odt or .docx first.'); return; }
    if (kind === 'epub' && /\.(mobi|azw3?|kfx)$/i.test(f.name)) { setError('Kindle files (.mobi, .azw) can’t be read here. Use an EPUB without DRM.'); return; }
    if (!cfg.re.test(f.name) && !(kind === 'text' && (f.type.startsWith('text/') || !/\.[a-z0-9]{2,5}$/i.test(f.name)))) { setError(`“${f.name}” is not a ${cfg.label}.`); return; }
    setFile(f);
  };

  const ready = source === 'paste' ? code.trim().length > 0 : !!file;
  const convert = async () => {
    if (!ready) return;
    setError(null); setPhase('working'); setProgress({ stage: 'Reading…', v: null });
    try {
      const { docCss, mdToHtml } = await import('../lib/mdToHtml');
      const docs = await import('../lib/docToHtml');
      let body = '', css = '', title = file ? stripExt(file.name) : 'document', assets = new Map<string, Blob>();
      const warnings: string[] = [];
      if (kind === 'text') {
        const txt = source === 'paste' ? code : await file!.text();
        body = docs.textToHtml(txt);
        css = `pre.plain{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0;background:none;border:0;padding:0}`;
      } else if (kind === 'markdown') {
        body = mdToHtml(source === 'paste' ? code : await file!.text());
        const h1 = /<h1[^>]*>(.*?)<\/h1>/.exec(body); if (h1 && source === 'paste') title = h1[1].replace(/<[^>]+>/g, '');
      } else if (kind === 'odt') {
        const r = await docs.odtToHtml(new Uint8Array(await file!.arrayBuffer()));
        body = r.html; css = r.css; assets = r.assets; if (r.title) title = r.title;
      } else {
        const r = await docs.epubToHtml(new Uint8Array(await file!.arrayBuffer()), { publisherCss: bookCss });
        body = r.html; css = r.css; assets = r.assets; if (r.title) title = r.title;
      }
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><style>${docCss({ font, size })}\n${css}</style></head><body>${body}</body></html>`;
      const { htmlToPdf } = await import('../lib/htmlToPdf');
      const res = await htmlToPdf(html, assets, { page, landscape, margin: MARGINS[margin], viewport: null, backgrounds: true, title, onProgress: (stage, d, t) => setProgress({ stage, v: d !== undefined && t ? d / t : null }) });
      if (res.skippedImages) warnings.push(`${res.skippedImages} picture${res.skippedImages === 1 ? '' : 's'} couldn’t be added.`);
      if (res.missingGlyphs) warnings.push(`${res.missingGlyphs} character${res.missingGlyphs === 1 ? '' : 's'} couldn’t be drawn and may be missing.`);
      setOut({ blob: new Blob([res.pdf as BlobPart], { type: 'application/pdf' }), pages: res.pages, name: `${file ? stripExt(file.name) : 'document'}.pdf`, warnings });
      setPhase('done');
    } catch (e) {
      const m = String((e as Error)?.message ?? '');
      setError(m === 'DRM' ? 'This e-book is protected with DRM, so it can’t be converted. Only DRM-free EPUBs work.'
        : m === 'NOT_EPUB' ? 'This file isn’t a valid EPUB e-book.'
        : m === 'NOT_ODT' || m === 'NOT_ZIP' ? `This file isn’t a valid ${cfg.label}.`
        : m === 'OLE_FILE' ? 'This looks like an old binary document (.doc). Save it as .odt or .docx first.'
        : friendlyError(e).message);
      setPhase('edit');
    }
  };
  const reset = () => { setFile(null); setOut(null); setPhase('edit'); setError(null); };

  if (phase === 'done' && out) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is ready!" stats={[['Pages', String(out.pages)], ['Source', file ? formatBytes(file.size) : `${code.length} chars`], ['PDF', formatBytes(out.blob.size)]]}
          warnings={out.warnings} highlight="Text is real text: you can search, select and copy it."
          onDownload={() => downloadBlob(out.blob, out.name)} downloadLabel="Download PDF" onReset={reset} resetLabel="Convert another file">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change page settings</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {cfg.paste && <OptionChips<'file' | 'paste'> label="Source" hideLabel value={source} onChange={(v) => v && setSource(v)} options={[{ value: 'file', label: `Upload ${cfg.label}` }, { value: 'paste', label: 'Type or paste' }]} />}
      {source === 'file' ? (
        !file ? <Dropzone accept={cfg.accept} title={`Drag & drop your ${cfg.label} here`} buttonLabel={`Select ${cfg.label}`} onFiles={pick} />
          : <FileRow name={file.name} size={formatBytes(file.size)} kind={cfg.kind} onRemove={phase === 'working' ? undefined : reset} />
      ) : (
        <textarea value={code} onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)} rows={12} spellcheck={kind === 'text'} aria-label="Text" placeholder={cfg.placeholder}
          class={`block w-full rounded-control border border-line bg-white p-3 text-[14px] leading-5 outline-none focus:border-brand dark:border-white/10 dark:bg-night-2 ${kind === 'markdown' ? 'font-mono' : ''}`} />
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      <div class="grid gap-4 sm:grid-cols-2">
        <OptionChips<HtmlPage> label="Page size" value={page} onChange={(v) => v && setPage(v)} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'a5', label: 'A5' }, { value: 'legal', label: 'Legal' }]} />
        <OptionChips<'p' | 'l'> label="Orientation" value={landscape ? 'l' : 'p'} onChange={(v) => v && setLandscape(v === 'l')} options={[{ value: 'p', label: 'Portrait' }, { value: 'l', label: 'Landscape' }]} />
        <OptionChips<keyof typeof MARGINS> label="Margins" value={margin} onChange={(v) => v && setMargin(v)} options={[{ value: 'none', label: 'None' }, { value: 'small', label: 'Small' }, { value: 'normal', label: 'Normal' }]} />
        <OptionChips<Font> label="Font" value={font} onChange={(v) => v && setFont(v)} options={[{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Monospace' }]} />
      </div>
      <label class="flex items-center gap-3 text-sm font-semibold">Text size
        <input type="range" min={9} max={24} value={size} onInput={(e) => setSize(+(e.target as HTMLInputElement).value)} class="h-9 min-w-0 flex-1 accent-brand" />
        <span class="w-14 text-right tabular-nums">{Math.round(size * 0.75)} pt</span>
      </label>
      {kind === 'epub' && (
        <label class="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={bookCss} onChange={(e) => setBookCss((e.target as HTMLInputElement).checked)} />
          <span><span class="font-semibold text-ink dark:text-white">Use the book’s own styles</span> <span class="text-muted dark:text-gray-400">(turn off for plain, even formatting)</span></span></label>
      )}
      {phase === 'working' ? <ProgressBar label={progress.stage || 'Converting…'} value={progress.v} />
        : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!ready} onClick={convert}>{ready ? 'Convert to PDF' : source === 'paste' ? 'Type or paste something first' : `Select a ${cfg.label}`}</button>}
      <PrivacyNote />
    </div>
  );
}
