import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { NUpOpts } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

type Per = '2' | '4' | '6' | '8' | '9' | '16';
const GRID: Record<Per, [number, number]> = { 2: [1, 2], 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3], 16: [4, 4] };

export default function NUpPdf() {
  const doc = usePdfDoc(160);
  const [per, setPer] = useState<Per>('4');
  const [sheet, setSheet] = useState<NUpOpts['sheet']>('a4');
  const [orientation, setOrientation] = useState<NUpOpts['orientation']>('auto');
  const [order, setOrder] = useState<NUpOpts['order']>('across');
  const [border, setBorder] = useState(false);
  const [gap, setGap] = useState<'none' | 'small' | 'wide'>('small');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const n = +per;
  const srcLand = (doc.thumbs[0]?.aspect ?? 1.414) < 1;
  let [cols, rows] = GRID[per];
  const land = orientation === 'landscape' || (orientation === 'auto' && ([2, 6, 8].includes(n) ? !srcLand : srcLand));
  if (land) [cols, rows] = [rows, cols];
  const sheets = Math.ceil(doc.pageCount / n);

  const run = async () => {
    if (!doc.bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const g = { none: [12, 0], small: [18, 8], wide: [30, 18] }[gap];
      setOut(await pdfOp('nUp', [doc.bytes.slice().buffer, { perSheet: n as NUpOpts['perSheet'], sheet, orientation, order, margin: g[0], gap: g[1], border }]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOut(null); setPhase('edit'); };
  const name = doc.file ? `${stripExt(doc.file.name)}-${n}-up.pdf` : 'n-up.pdf';

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`${n} pages per sheet!`} stats={[['Pages', String(doc.pageCount)], ['Sheets', String(sheets)], ['Size', formatBytes(out.length)]]}
          highlight={`Print ${sheets} sheet${sheets === 1 ? '' : 's'} instead of ${doc.pageCount}. Text stays sharp: pages are placed as vectors, not pictures.`}
          onDownload={() => downloadBlob(out, name)} downloadLabel="Download PDF" onReset={reset} resetLabel="Use another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change layout</button>
        </ResultCard>
      </div>
    );
  }

  // first sheet preview
  const preview = Array.from({ length: n }, (_, k) => {
    const col = order === 'across' ? k % cols : Math.floor(k / rows), row = order === 'across' ? Math.floor(k / cols) : k % rows;
    return { k, col, row, t: doc.thumbs[k] };
  });
  const sheetAspect = land ? 1 / 1.414 : 1.414;
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Print 2, 4, 6, 9 or 16 pages on one sheet." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div class="space-y-4">
            <OptionChips<Per> label="Pages per sheet" value={per} onChange={(v) => v && setPer(v)} options={(['2', '4', '6', '8', '9', '16'] as Per[]).map((v) => ({ value: v, label: v }))} />
            <OptionChips<NUpOpts['sheet']> label="Sheet size" value={sheet} onChange={(v) => v && setSheet(v)} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'a3', label: 'A3' }, { value: 'source', label: 'Same as PDF' }]} />
            <OptionChips<NUpOpts['orientation']> label="Orientation" value={orientation} onChange={(v) => v && setOrientation(v)} options={[{ value: 'auto', label: 'Best fit' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
            <OptionChips<NUpOpts['order']> label="Order" value={order} onChange={(v) => v && setOrder(v)} options={[{ value: 'across', label: 'Across, then down' }, { value: 'down', label: 'Down, then across' }]} />
            <OptionChips<'none' | 'small' | 'wide'> label="Spacing" value={gap} onChange={(v) => v && setGap(v)} options={[{ value: 'none', label: 'Tight' }, { value: 'small', label: 'Normal' }, { value: 'wide', label: 'Wide' }]} />
            <label class="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" class="h-5 w-5 accent-brand" checked={border} onChange={(e) => setBorder((e.target as HTMLInputElement).checked)} />Thin border around each page</label>
          </div>
          <div>
            <p class="mb-2 text-sm font-semibold text-ink dark:text-white">Sheet 1 of {sheets}</p>
            <div class="mx-auto grid w-full max-w-[220px] gap-1 rounded-md border border-line bg-white p-2 shadow-sm dark:border-white/10" style={{ aspectRatio: `1 / ${sheetAspect}`, gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
              {preview.map((p) => (
                <div key={p.k} class="grid min-h-0 place-items-center overflow-hidden" style={{ gridColumn: p.col + 1, gridRow: p.row + 1 }}>
                  {p.t?.url ? <img src={p.t.url} alt="" class={`max-h-full max-w-full ${border ? 'outline outline-1 outline-gray-400' : 'shadow-sm'}`} /> : p.k < doc.pageCount ? <span class="h-3 w-3 animate-spin rounded-full border border-brand/30 border-t-brand" /> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {doc.file && doc.pageCount > 0 && (
        <StickyActions>
          {phase === 'working' ? <ProgressBar label="Arranging pages…" value={null} /> : (
            <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Create {sheets} sheet{sheets === 1 ? '' : 's'} ({n} per sheet)</button>
          )}
        </StickyActions>
      )}
      <PrivacyNote />
    </div>
  );
}
