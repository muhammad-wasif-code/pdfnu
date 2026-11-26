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
import type { TItem, TPage } from '../lib/pdfToTable';
import type { WSheet } from '../lib/xlsxWrite';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const OCR_DPI = 250;
const LANGS: { value: OcrLang; label: string }[] = [
  { value: 'eng', label: 'English' }, { value: 'urd', label: 'اردو Urdu' }, { value: 'hin', label: 'हिन्दी Hindi' },
];

function fontStyle(f: any): { b: boolean; i: boolean } { const name = String(f?.name ?? f?.loadedName ?? ''); return { b: !!f?.bold || !!f?.black || /bold|black|heavy|semibold|demi/i.test(name), i: !!f?.italic || /italic|oblique/i.test(name) }; }

export default function PdfToExcel() {
  const [file, setFile] = useState<File | null>(null);
  const [perPage, setPerPage] = useState(false);
  const [numbers, setNumbers] = useState(true);
  const [lang, setLang] = useState<OcrLang>('eng');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done' | 'empty'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [out, setOut] = useState<{ blob: Blob; pages: number; rows: number; cols: number; pics: number; ocr: boolean; preview: string[][] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const build = async (pages: TPage[], ocr: boolean, png: Map<string, { bytes: Uint8Array; w: number; h: number }> = new Map()) => {
    const [{ stackPages }, { writeXlsx }] = await Promise.all([import('../lib/pdfToTable'), import('../lib/xlsxWrite')]);
    setProgress({ label: 'Building Excel file…', value: 0.97 });
    const key = (p: number, id: string) => `${p}|${id}`;
    let sheets: WSheet[];
    if (perPage) sheets = pages.map((p, i) => ({ name: `Page ${i + 1}`, ...stackPages([p], numbers, png, (_x, id) => key(i, id)) }));
    else sheets = [{ name: stripExt(file!.name).slice(0, 31) || 'Sheet1', ...stackPages(pages, numbers, png, key) }];
    const bytes = await writeXlsx(sheets, { title: stripExt(file!.name) });
    const all = pages.flatMap((p) => p.rows).filter((r) => r.some((c) => c.text));
    const cols = Math.max(0, ...all.map((r) => r.length));
    const pics = sheets.reduce((n, s) => n + (s.images?.length ?? 0), 0);
    setOut({ blob: new Blob([bytes as BlobPart], { type: XLSX }), pages: pages.length, rows: all.length, cols, pics, ocr, preview: all.slice(0, 8).map((r) => r.slice(0, 6).map((c) => c.text)) });
    setPhase('done');
  };

  const convert = async () => {
    if (!file) return;
    setError(null); setPhase('working');
    try {
      const [{ readPdf }, { openPdf, loadPdfJs }, { itemsFromTextContent, pageTable }, { pageGraphics, colorsForItems }, { imageBytes }] = await Promise.all([
        import('../lib/pdfFile'), import('../lib/pdfjs'), import('../lib/pdfToTable'), import('../lib/pdfGraphics'), import('../lib/pdfImage'),
      ]);
      const pdfjs = await loadPdfJs();
      const pdf = await readPdf(file);
      const doc = await openPdf(pdf.bytes.slice());
      try {
        const pages: TPage[] = [];
        const png = new Map<string, { bytes: Uint8Array; w: number; h: number }>();
        let anyText = false;
        for (let n = 1; n <= doc.numPages; n++) {
          setProgress({ label: `Reading page ${n} of ${doc.numPages}…`, value: (n / doc.numPages) * 0.9 });
          const page = await doc.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          let ops: any = { fnArray: [], argsArray: [] };
          try { ops = await page.getOperatorList(); } catch { /* graphics are optional */ }
          const gfx = pageGraphics(ops, pdfjs.OPS as any, vp);
          const style = (fn: string) => { try { return page.commonObjs.has(fn) ? fontStyle(page.commonObjs.get(fn)) : { b: false, i: false }; } catch { return { b: false, i: false }; } };
          const tc = await page.getTextContent();
          const list = (tc.items as any[]).filter((it) => typeof it.str === 'string');
          const items = itemsFromTextContent(tc, vp, style, colorsForItems(list, gfx.textColors));
          if (items.length) anyText = true;
          const t = pageTable(items, gfx, { w: vp.width, h: vp.height });
          // pictures placed in the table
          for (const im of t.images) {
            const k = `${n - 1}|${im.id}`;
            if (png.has(k)) continue;
            const store = im.id.startsWith('g_') ? page.commonObjs : page.objs;
            const obj = await new Promise<any>((res) => { try { store.get(im.id, res); } catch { res(null); } });
            const bytes = obj ? await imageBytes(obj) : null;
            if (bytes) png.set(k, { bytes, w: obj.width, h: obj.height });
          }
          pages.push(t);
          page.cleanup();
        }
        if (!anyText) { setPhase('empty'); return; }
        await build(pages, false, png);
      } finally { await doc.destroy(); }
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };

  /** Scanned PDF: recognise the words (with positions) first, then find the table in them. */
  const convertOcr = async () => {
    if (!file) return;
    setError(null); setPhase('working');
    let ocr: Awaited<ReturnType<typeof import('../lib/ocr').createOcr>> | null = null;
    try {
      const [{ readPdf }, { openPdf }, { renderPage }, { createOcr }, { pageTable }] = await Promise.all([import('../lib/pdfFile'), import('../lib/pdfjs'), import('../lib/render'), import('../lib/ocr'), import('../lib/pdfToTable')]);
      setProgress({ label: 'Loading text recognition (first time only, a few MB)…', value: 0 });
      let stage = '';
      ocr = await createOcr(lang, (status, p) => {
        if (/loading|initializ/i.test(status)) setProgress({ label: 'Loading text recognition (first time only, a few MB)…', value: p });
        else if (/recogniz/i.test(status)) setProgress({ label: stage, value: p });
      });
      const pdf = await readPdf(file);
      const doc = await openPdf(pdf.bytes.slice());
      try {
        const pages: TPage[] = [];
        const k = 72 / OCR_DPI;
        for (let n = 1; n <= doc.numPages; n++) {
          stage = `Reading page ${n} of ${doc.numPages}…`;
          setProgress({ label: stage, value: 0 });
          const c = await renderPage(doc, n, OCR_DPI);
          const r = await ocr.recognize(c);
          c.width = c.height = 0;
          const items: TItem[] = r.words.filter((w) => w.text.trim()).map((w) => ({ x0: w.x0 * k, x1: w.x1 * k, y: w.y1 * k, size: Math.max(4, (w.y1 - w.y0) * k * 0.9), str: w.text }));
          pages.push(pageTable(items));
        }
        if (!pages.some((p) => p.rows.length)) { setError('No text could be recognised. Check the language, or try a sharper scan.'); setPhase('empty'); return; }
        await build(pages, true);
      } finally { await doc.destroy(); }
    } catch (e) { setError(friendlyError(e).message); setPhase('empty'); }
    finally { await ocr?.terminate(); }
  };

  const reset = () => { setFile(null); setOut(null); setPhase('edit'); setError(null); };

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your Excel file is ready!" stats={[['Pages', String(out.pages)], ['Rows', String(out.rows)], [out.pics ? 'Pictures' : 'Columns', String(out.pics || out.cols)]]}
          highlight={out.ocr ? 'The text was recognised from the scan, so check names and numbers before you rely on them.' : 'Numbers are real numbers you can sum and sort. Open the file in Excel, Google Sheets, Numbers or LibreOffice.'}
          onDownload={() => downloadBlob(out.blob, `${stripExt(file.name)}.xlsx`, XLSX)} downloadLabel="Download .xlsx" onReset={reset} resetLabel="Convert another PDF">
          {out.preview.length > 0 && (
            <div class="overflow-x-auto rounded-control border border-line dark:border-white/10">
              <table class="w-full text-left text-xs">
                <caption class="sr-only">Preview of the first rows</caption>
                <tbody>
                  {out.preview.map((r, i) => (
                    <tr key={i} class="border-b border-line last:border-0 dark:border-white/10">
                      {r.map((c, j) => <td key={j} dir="auto" class="max-w-[12rem] truncate px-2 py-1.5 text-gray-700 dark:text-gray-300">{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ResultCard>
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
            <input type="checkbox" class="h-5 w-5 accent-brand" checked={numbers} disabled={phase === 'working'} onChange={(e) => setNumbers((e.target as HTMLInputElement).checked)} />
            Turn amounts like 1,250.00 and 15% into numbers you can calculate with
          </label>
          <label class="flex min-h-11 items-center gap-3 text-sm text-ink dark:text-gray-100">
            <input type="checkbox" class="h-5 w-5 accent-brand" checked={perPage} disabled={phase === 'working'} onChange={(e) => setPerPage((e.target as HTMLInputElement).checked)} />
            Put each PDF page on its own sheet
          </label>
          <p class="rounded-control bg-surface p-3 text-xs leading-5 text-muted dark:bg-white/5 dark:text-gray-400">
            Works best with tables, bank statements, invoices and reports. Rows and columns are rebuilt from the page, with cell colours, borders, bold text, font sizes, text colours and pictures.
          </p>
          {phase === 'working' ? <ProgressBar label={progress.label || 'Reading PDF…'} value={progress.value} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={convert}>Convert to Excel</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
