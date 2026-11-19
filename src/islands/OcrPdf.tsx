import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { OcrLang } from '../lib/ocr';
import type { OcrPage } from '../lib/pdfOps';

const LANGS: { value: OcrLang; label: string; sub: string }[] = [
  { value: 'eng', label: 'English', sub: 'Searchable PDF' },
  { value: 'urd', label: 'اردو Urdu', sub: 'Text only' },
  { value: 'hin', label: 'हिन्दी Hindi', sub: 'Text only' },
];
const OCR_DPI = 250;
const MAX_OCR_SIDE = 3300;

const toJpeg = (c: HTMLCanvasElement, maxSide: number) => new Promise<{ data: ArrayBuffer; w: number; h: number }>((res, rej) => {
  const s = Math.min(1, maxSide / Math.max(c.width, c.height));
  const out = document.createElement('canvas');
  out.width = Math.round(c.width * s); out.height = Math.round(c.height * s);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, out.width, out.height);
  out.toBlob(async (b) => { if (!b) return rej(new Error('Could not encode page')); const w = out.width, h = out.height; out.width = out.height = 0; res({ data: await b.arrayBuffer(), w, h }); }, 'image/jpeg', 0.8);
});

export default function OcrPdf({ initialMode = 'pdf' }: { initialMode?: 'pdf' | 'image' } = {}) {
  const [files, setFiles] = useState<File[]>([]);
  const [lang, setLang] = useState<OcrLang>('eng');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [text, setText] = useState('');
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [conf, setConf] = useState(0);
  const [pagesDone, setPagesDone] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPdf = files.length === 1 && /\.pdf$/i.test(files[0].name);
  const latin = lang === 'eng';

  const add = (list: File[]) => {
    setError(null);
    const pdfs = list.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    const imgs = list.filter((f) => f.type.startsWith('image/'));
    if (pdfs.length && (pdfs.length > 1 || imgs.length)) { setError('Add one PDF, or one or more images, at a time.'); return; }
    if (!pdfs.length && !imgs.length) { setError('Choose a PDF or JPG, PNG or WebP images.'); return; }
    setFiles(pdfs.length ? pdfs : imgs);
  };

  const run = async () => {
    if (!files.length) return;
    setPhase('working'); setError(null); setPdf(null);
    let ocr: Awaited<ReturnType<typeof import('../lib/ocr').createOcr>> | null = null;
    try {
      const { createOcr } = await import('../lib/ocr');
      setProgress({ label: 'Loading text recognition (first time only, a few MB)…', value: 0 });
      let stage = '';
      ocr = await createOcr(lang, (status, p) => {
        if (/loading|initializ/i.test(status)) setProgress({ label: 'Loading text recognition (first time only, a few MB)…', value: p });
        else if (/recogniz/i.test(status)) setProgress({ label: stage, value: p });
      });
      const texts: string[] = [];
      const pages: OcrPage[] = [];
      let confSum = 0;
      const handle = async (c: HTMLCanvasElement, wPt: number, hPt: number, label: string) => {
        stage = label;
        setProgress({ label, value: 0 });
        const r = await ocr!.recognize(c);
        texts.push(r.text.trim());
        confSum += r.confidence;
        if (latin) { const j = await toJpeg(c, 2000); pages.push({ jpeg: j.data, w: wPt, h: hPt, imgW: c.width, imgH: c.height, words: r.words }); }
        c.width = c.height = 0;
      };
      if (isPdf) {
        const { readPdf } = await import('../lib/pdfFile');
        const { openPdf } = await import('../lib/pdfjs');
        const { renderPage } = await import('../lib/render');
        const src = await readPdf(files[0]);
        const doc = await openPdf(src.bytes.slice());
        try {
          for (let n = 1; n <= doc.numPages; n++) {
            const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
            await handle(await renderPage(doc, n, OCR_DPI), vp.width, vp.height, `Reading page ${n} of ${doc.numPages}…`);
          }
        } finally { await doc.destroy(); }
      } else {
        const { decodeImage, draw } = await import('../lib/image');
        for (let i = 0; i < files.length; i++) {
          const d = await decodeImage(files[i], files[i].name);
          const s = Math.min(1, MAX_OCR_SIDE / Math.max(d.width, d.height));
          const c = draw(d, Math.round(d.width * s), Math.round(d.height * s), 'stretch', '#ffffff');
          d.close();
          await handle(c, (c.width * 72) / 200, (c.height * 72) / 200, `Reading image ${i + 1} of ${files.length}…`);
        }
      }
      const n = texts.length;
      setText(texts.map((t, i) => (n > 1 ? `--- ${isPdf ? 'Page' : 'Image'} ${i + 1} ---\n${t}` : t)).join('\n\n'));
      setConf(n ? confSum / n : 0); setPagesDone(n);
      if (latin && pages.length) {
        setProgress({ label: 'Building searchable PDF…', value: 0.98 });
        const { pdfOp } = await import('../lib/pdfWorker');
        setPdf(await pdfOp('searchablePdf', [pages], pages.map((p) => p.jpeg)));
      }
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
    finally { await ocr?.terminate(); }
  };

  const reset = () => { setFiles([]); setText(''); setPdf(null); setPhase('edit'); setCopied(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };
  const base = files[0] ? stripExt(files[0].name) : 'ocr';
  const empty = phase === 'done' && !text.replace(/--- (Page|Image) \d+ ---/g, '').trim();

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!files.length
        ? <Dropzone accept={initialMode === 'image' ? 'image/jpeg,image/png,image/webp,application/pdf,.pdf' : 'application/pdf,.pdf,image/jpeg,image/png,image/webp'} multiple
            title={initialMode === 'image' ? 'Drag & drop images (or a PDF)' : 'Drag & drop a scanned PDF or images'} buttonLabel={initialMode === 'image' ? 'Select images' : 'Select file'}
            hint="Photos, screenshots and scans. English, Urdu and Hindi." onFiles={add} />
        : <FileRow name={files.length > 1 ? `${files.length} images` : files[0].name} size={formatBytes(files.reduce((s, f) => s + f.size, 0))} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={() => setError(null)}>{error}</ErrorBox>}

      {files.length > 0 && phase !== 'done' && (
        <>
          <OptionChips<OcrLang> label="Language of the text" value={lang} onChange={(v) => v && setLang(v)} variant="cards" options={LANGS} />
          {phase === 'working'
            ? <ProgressBar label={progress.label} value={progress.value} detail="Text recognition runs on your device. Large scans take a little while." />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Recognise text</button>}
        </>
      )}

      {phase === 'done' && (empty ? (
        <ErrorBox>No text was recognised. Make sure the image is sharp, the right way up and the language is correct.</ErrorBox>
      ) : (
        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span class="font-semibold text-ink dark:text-white">{pagesDone} {isPdf ? 'page' : 'image'}{pagesDone > 1 ? 's' : ''} · {text.trim().split(/\s+/).length.toLocaleString()} words</span>
            <span class={conf >= 80 ? 'text-success' : 'text-amber-700 dark:text-amber-300'}>{Math.round(conf)}% confidence{conf < 70 ? ': check the text carefully' : ''}</span>
          </div>
          <label class="sr-only" for="ocr-out">Recognised text</label>
          <textarea id="ocr-out" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} dir="auto"
            class="h-72 w-full resize-y rounded-control border border-line bg-surface p-3 text-[14px] leading-6 text-ink dark:border-white/10 dark:bg-white/[.03] dark:text-gray-100" />
          <div class="grid gap-3 sm:grid-cols-3">
            {pdf && <button type="button" class="btn-primary min-h-12 text-[15px]" onClick={() => downloadBlob(pdf, `${base}-searchable.pdf`)}>Searchable PDF</button>}
            <button type="button" class={`${pdf ? 'btn-secondary' : 'btn-primary'} min-h-12`} onClick={() => downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${base}.txt`, 'text/plain')}>Download .txt</button>
            <button type="button" class="btn-secondary min-h-12" onClick={copy}>{copied ? 'Copied ✓' : 'Copy text'}</button>
          </div>
          {!latin && <p class="text-xs text-muted dark:text-gray-400">Searchable PDF output is available for English. Urdu and Hindi text can be copied or saved as .txt.</p>}
          <button type="button" class="btn-ghost w-full" onClick={reset}>Recognise another file</button>
        </div>
      ))}
      <PrivacyNote />
    </div>
  );
}
