import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { XWorkbook } from '../lib/xlsxRead';
import type { Fit, Orientation, Paper } from '../lib/xlsxToPdf';

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

const FITS: { value: Fit; label: string; sub: string }[] = [
  { value: 'width', label: 'Fit to width', sub: 'All columns on the page' },
  { value: 'page', label: 'One page', sub: 'Each sheet on one page' },
  { value: 'actual', label: 'Actual size', sub: '100%, may split' },
];
const PAPERS: { value: Paper; label: string }[] = [{ value: 'auto', label: 'As in file' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }];
const ORIENT: { value: Orientation; label: string }[] = [{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }];

export default function ExcelToPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [wb, setWb] = useState<XWorkbook | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [fit, setFit] = useState<Fit>('width');
  const [paper, setPaper] = useState<Paper>('auto');
  const [orient, setOrient] = useState<Orientation>('auto');
  const [grid, setGrid] = useState<'auto' | 'on' | 'off'>('auto');
  const [phase, setPhase] = useState<'edit' | 'reading' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [out, setOut] = useState<{ blob: Blob; pages: number; sheets: number; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (files: File[]) => {
    const f = files[0];
    setError(null);
    if (/\.(xls|xlsb)$/i.test(f.name)) { setError('Old .xls and binary .xlsb files aren’t supported. Open the file in Excel, Google Sheets or LibreOffice, save it as .xlsx, then try again.'); return; }
    if (/\.(ods|numbers)$/i.test(f.name)) { setError('This is not an Excel file. Export it as .xlsx (File → Export or Download → Microsoft Excel) and try again.'); return; }
    if (!/\.(xlsx|xlsm|xltx|xltm|csv|tsv|txt)$/i.test(f.name)) { setError(`“${f.name}” is not an Excel (.xlsx) or CSV file.`); return; }
    setFile(f); setPhase('reading');
    try {
      const { readXlsx, csvToWorkbook } = await import('../lib/xlsxRead');
      const book = /\.(csv|tsv|txt)$/i.test(f.name) ? csvToWorkbook(await f.text(), stripExt(f.name).slice(0, 31)) : await readXlsx(await f.arrayBuffer(), { convertImage: toPng });
      setWb(book);
      setPicked(new Set(book.sheets.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0)));
      setPhase('edit');
    } catch (e) {
      const msg = String((e as Error)?.message ?? '');
      setError(msg === 'OLE_FILE' ? 'This workbook is password-protected or saved in the old .xls format. Open it in Excel, remove the password (File → Info → Protect Workbook) or save it as .xlsx, then try again.'
        : msg === 'NOT_XLSX' ? 'This file isn’t a valid Excel workbook. If it opens in Excel, save it again as .xlsx and retry.'
        : friendlyError(e).message);
      setFile(null); setWb(null); setPhase('edit');
    }
  };

  const convert = async () => {
    if (!file || !wb) return;
    setError(null); setPhase('working'); setProgress({ label: 'Loading fonts…', value: 0.05 });
    try {
      const { xlsxToPdf } = await import('../lib/xlsxToPdf');
      const res = await xlsxToPdf(wb, {
        sheets: [...picked].sort((a, b) => a - b), fit, paper, orientation: orient, gridlines: grid === 'auto' ? 'auto' : grid === 'on',
        title: stripExt(file.name), fileName: file.name,
        onProgress: (n, of) => setProgress({ label: `Drawing page ${n} of ${of}…`, value: 0.1 + (n / of) * 0.85 }),
      });
      const warnings: string[] = [];
      if (res.skippedObjects) warnings.push(`${res.skippedObjects} object${res.skippedObjects === 1 ? ' was' : 's were'} not included (SmartArt, embedded files, or Excel 2016 chart types such as waterfall and treemap). Charts, pictures, shapes and text boxes are included.`);
      if (wb.formulasWithoutValue) warnings.push(`${wb.formulasWithoutValue} formula${wb.formulasWithoutValue === 1 ? ' has' : 's have'} no saved result and print empty. Open the file in Excel, let it recalculate, save, and convert again.`);
      if (res.missingGlyphs) warnings.push(`${res.missingGlyphs} character${res.missingGlyphs === 1 ? '' : 's'} couldn’t be drawn and may be missing.`);
      setOut({ blob: new Blob([res.pdf as BlobPart], { type: 'application/pdf' }), pages: res.pages, sheets: res.sheets, warnings });
      setPhase('done');
    } catch (e) {
      setError(String((e as Error)?.message) === 'EMPTY' ? 'The selected sheets are empty, so there is nothing to print.' : friendlyError(e).message);
      setPhase('edit');
    }
  };
  const reset = () => { setFile(null); setWb(null); setOut(null); setPhase('edit'); setError(null); };
  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is ready!" stats={[['Pages', String(out.pages)], ['Sheets', String(out.sheets)], ['PDF', formatBytes(out.blob.size)]]}
          warnings={out.warnings}
          highlight="Text and numbers stay selectable and searchable. Open the PDF once to check the page breaks before you send it."
          onDownload={() => downloadBlob(out.blob, `${stripExt(file.name)}.pdf`)} downloadLabel="Download PDF" onReset={reset} resetLabel="Convert another spreadsheet" />
      </div>
    );
  }

  const busy = phase === 'working' || phase === 'reading';
  const isCsv = !!file && /\.(csv|tsv|txt)$/i.test(file.name);
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept=".xlsx,.xlsm,.xltx,.xltm,.csv,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" title="Drag & drop your Excel file here" buttonLabel="Select Excel file" hint=".xlsx or .csv files" onFiles={pick} />
        : <FileRow name={file.name} size={formatBytes(file.size)} kind={isCsv ? 'CSV' : 'XLSX'} onRemove={busy ? undefined : reset} />}
      {error && <ErrorBox onRetry={reset}>{error}</ErrorBox>}
      {phase === 'reading' && <ProgressBar label="Reading workbook…" />}
      {file && wb && phase !== 'reading' && (
        <>
          {wb.sheets.length > 1 && (
            <fieldset>
              <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Sheets to include</legend>
              <div class="flex flex-wrap gap-2">
                {wb.sheets.map((s, i) => (
                  <label key={i} class={`flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm ${picked.has(i) ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-surface text-gray-800 dark:border-white/10 dark:bg-white/[.03] dark:text-gray-200'}`}>
                    <input type="checkbox" class="h-4 w-4 accent-brand" checked={picked.has(i)} disabled={busy} onChange={() => toggle(i)} />
                    <span dir="auto">{s.name}</span>{s.hidden && <span class="text-xs text-muted">(hidden)</span>}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <OptionChips<Fit> label="Page fit" variant="cards" value={fit} onChange={(v) => v && setFit(v)} options={FITS} />
          <div class="grid gap-5 sm:grid-cols-2">
            <OptionChips<Paper> label="Paper size" value={paper} onChange={(v) => v && setPaper(v)} options={PAPERS} />
            <OptionChips<Orientation> label="Orientation" value={orient} onChange={(v) => v && setOrient(v)} options={ORIENT} />
          </div>
          <OptionChips<'auto' | 'on' | 'off'> label="Gridlines" value={grid} onChange={(v) => v && setGrid(v)} options={[{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'Always' }, { value: 'off', label: 'Never' }]} />
          {phase === 'working' ? <ProgressBar label={progress.label || 'Converting…'} value={progress.value} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!picked.size} onClick={convert}>{picked.size ? 'Convert to PDF' : 'Select at least one sheet'}</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
