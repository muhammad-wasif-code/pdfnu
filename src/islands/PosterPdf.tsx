import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';

export default function PosterPdf() {
  const doc = usePdfDoc(220);
  const [page, setPage] = useState(0);
  const [across, setAcross] = useState(2);
  const [sheet, setSheet] = useState<'a4' | 'letter' | 'a3'>('a4');
  const [landscape, setLandscape] = useState(false);
  const [overlap, setOverlap] = useState(true);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ bytes: Uint8Array; sheets: number; down: number; sizeCm: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = doc.thumbs[page];
  const aspect = t?.aspect ?? 1.414;
  // estimate of the grid for the preview
  const [sw, sh] = sheet === 'a3' ? [841.89, 1190.55] : sheet === 'letter' ? [612, 792] : [595.28, 841.89];
  const [pw, ph] = landscape ? [sh - 36, sw - 36] : [sw - 36, sh - 36];
  const ov = overlap ? 20 : 0;
  const totalW = across * pw - (across - 1) * ov, down = Math.max(1, Math.ceil((totalW * aspect - ov) / (ph - ov) - 1e-6));
  const run = async () => {
    if (!doc.bytes) return;
    setPhase('working'); setError(null);
    try { const { pdfOp } = await import('../lib/pdfWorker'); setOut(await pdfOp('posterPdf', [doc.bytes.slice().buffer, { page, sheet, across, landscape, overlap: ov, marks: true }])); setPhase('done'); }
    catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  if (phase === 'done' && out && doc.file) return (
    <div class="card p-4 sm:p-6">
      <ResultCard title="Your poster is ready to print!" stats={[['Sheets', `${out.sheets} (${across} × ${out.down})`], ['Poster', `${out.sizeCm[0].toFixed(0)} × ${out.sizeCm[1].toFixed(0)} cm`], ['Size', formatBytes(out.bytes.length)]]}
        highlight="Print at 100% (actual size), trim along the dashed lines and glue each sheet over the red overlap line of its neighbour."
        onDownload={() => downloadBlob(out.bytes, `${stripExt(doc.file!.name)}-poster.pdf`)} downloadLabel="Download poster PDF" onReset={() => { doc.clear(); setOut(null); setPhase('edit'); }} resetLabel="Make another poster">
        <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change size</button>
      </ResultCard>
    </div>
  );
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF (poster, plan, chart)" buttonLabel="Select PDF" hint="Print one page large, across several normal sheets." onFiles={(f) => { setPage(0); doc.open(f); }} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={doc.clear} />}
      {(doc.error || error) && <ErrorBox>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_260px]">
          <div class="relative mx-auto w-full max-w-sm">
            {t?.url && <img src={t.url} alt={`Page ${page + 1}`} class="block w-full rounded border border-line" />}
            <div class="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${across}, 1fr)`, gridTemplateRows: `repeat(${down}, 1fr)` }}>
              {Array.from({ length: across * down }, (_, i) => <span key={i} class="border border-dashed border-red-500/80" />)}
            </div>
          </div>
          <div class="space-y-4">
            {doc.pageCount > 1 && <label class="flex items-center gap-2 text-sm font-semibold">Page<input type="number" min={1} max={doc.pageCount} value={page + 1} onInput={(e) => setPage(Math.max(0, Math.min(doc.pageCount - 1, +(e.target as HTMLInputElement).value - 1)))} class="h-11 w-20 rounded-control border border-line bg-white px-3 dark:border-white/10 dark:bg-night-2" /></label>}
            <label class="block text-sm font-semibold">Sheets across: {across}<input type="range" min={1} max={8} value={across} onInput={(e) => setAcross(+(e.target as HTMLInputElement).value)} class="mt-1 h-9 w-full accent-brand" /></label>
            <OptionChips<typeof sheet> label="Paper" value={sheet} onChange={(v) => v && setSheet(v)} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'a3', label: 'A3' }]} />
            <OptionChips<'p' | 'l'> label="Sheet orientation" value={landscape ? 'l' : 'p'} onChange={(v) => v && setLandscape(v === 'l')} options={[{ value: 'p', label: 'Portrait' }, { value: 'l', label: 'Landscape' }]} />
            <label class="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={overlap} onChange={(e) => setOverlap((e.target as HTMLInputElement).checked)} />Overlap for gluing (7 mm)</label>
            <p class="rounded-control bg-surface p-3 text-sm dark:bg-white/5"><strong>{across * down} sheets</strong> ({across} × {down}) · poster about <strong>{((totalW / 72) * 2.54).toFixed(0)} × {((totalW * aspect / 72) * 2.54).toFixed(0)} cm</strong></p>
            {phase === 'working' ? <ProgressBar label="Tiling…" value={null} /> : <button type="button" class="btn-primary min-h-12 w-full" onClick={run}>Make poster</button>}
          </div>
        </div>
      )}
      <PrivacyNote />
    </div>
  );
}
