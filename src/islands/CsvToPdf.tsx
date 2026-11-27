import { useEffect, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { Fit, Orientation, Paper } from '../lib/xlsxToPdf';

type Delim = 'auto' | ',' | ';' | '\t' | '|';
type Look = 'header' | 'zebra' | 'plain';

export default function CsvToPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [delim, setDelim] = useState<Delim>('auto');
  const [look, setLook] = useState<Look>('zebra');
  const [fit, setFit] = useState<Fit>('width');
  const [paper, setPaper] = useState<Paper>('a4');
  const [orient, setOrient] = useState<Orientation>('auto');
  const [numbers, setNumbers] = useState(true);
  const [preview, setPreview] = useState<string[][]>([]);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ blob: Blob; pages: number; rows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (files: File[]) => {
    const f = files[0];
    setError(null);
    if (/\.xlsx?$/i.test(f.name)) { setError('This is an Excel file. Use Excel to PDF instead.'); return; }
    if (!/\.(csv|tsv|txt|tab)$/i.test(f.name) && !/csv|text/.test(f.type)) { setError(`“${f.name}” is not a CSV file.`); return; }
    setFile(f); setText(await f.text());
  };
  useEffect(() => {
    if (!text) { setPreview([]); return; }
    import('../lib/xlsxRead').then(({ parseCsv }) => setPreview((delim === 'auto' ? parseCsv(text.slice(0, 20000)) : parseCsv(text.slice(0, 20000), delim)).slice(0, 6)));
  }, [text, delim]);

  const convert = async () => {
    if (!file) return;
    setError(null); setPhase('working');
    try {
      const { csvToWorkbook } = await import('../lib/xlsxRead');
      const wb = csvToWorkbook(text, stripExt(file.name).slice(0, 31), delim === 'auto' ? undefined : delim);
      const s = wb.sheets[0];
      if (!s.cells.size) throw new Error('EMPTY');
      const dark = '1F3864', band = 'EEF2F7', line = { style: 'thin', color: 'C9D1DC' };
      const restyle = new Map<string, any>();
      const styled = (st: any, k: string, f: (x: any) => any) => { const key = k; if (!restyle.has(key)) restyle.set(key, f(st)); return restyle.get(key); };
      for (const [r, row] of s.cells) for (const [, c] of row) {
        if (!numbers && c.kind === 'n') { c.kind = 's'; c.text = String(c.raw ?? c.text); }
        const head = look !== 'plain' && r === 0;
        const zebra = look === 'zebra' && r > 0 && r % 2 === 0;
        c.style = styled(c.style, `${head}-${zebra}-${c.kind}`, (st) => ({
          ...st, wrap: true, v: 'center',
          font: head ? { ...st.font, b: true, color: 'FFFFFF' } : st.font,
          fill: head ? dark : zebra ? band : undefined,
          border: look === 'plain' ? {} : { l: line, r: line, t: line, b: line },
        }));
      }
      if (look !== 'plain') s.repeatRows = [0, 0];
      s.gridLines = look === 'plain';
      s.footer = '&C&P / &N';
      // keep very wide text columns readable: cap at ~45 characters and let text wrap
      s.colW = s.colW.map((w) => Math.min(w, 250));
      const { xlsxToPdf } = await import('../lib/xlsxToPdf');
      const res = await xlsxToPdf(wb, { fit, paper, orientation: orient, gridlines: look === 'plain', title: stripExt(file.name), fileName: file.name });
      setOut({ blob: new Blob([res.pdf as BlobPart], { type: 'application/pdf' }), pages: res.pages, rows: s.maxR + 1 });
      setPhase('done');
    } catch (e) { setError((e as Error)?.message === 'EMPTY' ? 'This CSV file has no data.' : friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setText(''); setOut(null); setPhase('edit'); setError(null); };

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is ready!" stats={[['Rows', out.rows.toLocaleString()], ['Pages', String(out.pages)], ['PDF', formatBytes(out.blob.size)]]}
          highlight={look !== 'plain' ? 'The header row repeats at the top of every page.' : undefined}
          onDownload={() => downloadBlob(out.blob, `${stripExt(file.name)}.pdf`)} downloadLabel="Download PDF" onReset={reset} resetLabel="Convert another CSV">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change layout</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept=".csv,.tsv,.txt,.tab,text/csv" title="Drag & drop your CSV file here" buttonLabel="Select CSV file" hint="Comma, semicolon or tab separated." onFiles={pick} />
        : <FileRow name={file.name} size={formatBytes(file.size)} kind="CSV" onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {file && (
        <>
          {preview.length > 0 && (
            <div class="overflow-x-auto rounded-control border border-line dark:border-white/10">
              <table class="w-full text-left text-xs">
                <tbody>{preview.map((r, i) => <tr key={i} class={i === 0 && look !== 'plain' ? 'bg-[#1f3864] font-semibold text-white' : i % 2 === 0 && look === 'zebra' ? 'bg-surface dark:bg-white/5' : ''}>{r.slice(0, 8).map((c, k) => <td key={k} class="max-w-[10rem] truncate border-b border-line px-2 py-1.5 dark:border-white/10">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          <div class="grid gap-4 sm:grid-cols-2">
            <OptionChips<Delim> label="Separator" value={delim} onChange={(v) => v && setDelim(v)} options={[{ value: 'auto', label: 'Auto' }, { value: ',', label: 'Comma' }, { value: ';', label: 'Semicolon' }, { value: '\t', label: 'Tab' }, { value: '|', label: 'Pipe' }]} />
            <OptionChips<Look> label="Style" value={look} onChange={(v) => v && setLook(v)} options={[{ value: 'zebra', label: 'Striped' }, { value: 'header', label: 'Header only' }, { value: 'plain', label: 'Plain grid' }]} />
            <OptionChips<Fit> label="Fit" value={fit} onChange={(v) => v && setFit(v)} options={[{ value: 'width', label: 'Fit all columns' }, { value: 'actual', label: 'Actual size' }]} />
            <OptionChips<Paper> label="Paper" value={paper} onChange={(v) => v && setPaper(v)} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }]} />
            <OptionChips<Orientation> label="Orientation" value={orient} onChange={(v) => v && setOrient(v)} options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
          </div>
          <label class="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={!numbers} onChange={(e) => setNumbers(!(e.target as HTMLInputElement).checked)} />
            <span><span class="font-semibold text-ink dark:text-white">Keep values exactly as written</span> <span class="text-muted dark:text-gray-400">(e.g. leading zeros, long ID numbers)</span></span></label>
          {phase === 'working' ? <ProgressBar label="Building table…" value={null} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={convert}>Convert to PDF</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
