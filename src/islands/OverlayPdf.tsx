import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { OverlayOpts } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';

export default function OverlayPdf() {
  const doc = usePdfDoc(160, true);
  const lay = usePdfDoc(160, true);
  const [o, setO] = useState<OverlayOpts>({ layer: 'under', pages: 'all', repeat: 'first', opacity: 1, fit: 'stretch' });
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<OverlayOpts>) => setO((x) => ({ ...x, ...p }));
  const run = async () => {
    if (!doc.bytes || !lay.bytes) return;
    setPhase('working'); setError(null);
    try { const { pdfOp } = await import('../lib/pdfWorker'); setOut(await pdfOp('overlayPdf', [doc.bytes.slice().buffer, lay.bytes.slice().buffer, o])); setPhase('done'); }
    catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  if (phase === 'done' && out && doc.file) return (
    <div class="card p-4 sm:p-6">
      <ResultCard title={o.layer === 'under' ? 'Letterhead added!' : 'Overlay added!'} stats={[['Pages', String(doc.pageCount)], ['Layer', o.layer === 'under' ? 'Behind' : 'On top'], ['Size', formatBytes(out.length)]]}
        highlight="Text and graphics stay vector and selectable on both layers."
        onDownload={() => downloadBlob(out, `${stripExt(doc.file!.name)}-letterhead.pdf`)} downloadLabel="Download PDF" onReset={() => { doc.clear(); lay.clear(); setOut(null); setPhase('edit'); }} resetLabel="Start again">
        <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change options</button>
      </ResultCard>
    </div>
  );
  const slot = (d: ReturnType<typeof usePdfDoc>, title: string, hint: string) => !d.file ? <Dropzone compact accept="application/pdf,.pdf" title={title} buttonLabel="Select PDF" hint={hint} onFiles={d.open} /> : <FileRow name={d.file.name} size={`${title} · ${d.pageCount} pages · ${formatBytes(d.file.size)}`} onRemove={d.clear} />;
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {slot(doc, 'Your document', 'The pages that get the letterhead')}
      {slot(lay, 'Letterhead or template PDF', 'Logo, header and footer design, form background or stamp')}
      {[doc.error, lay.error, error].filter(Boolean).map((m) => <ErrorBox key={m}>{m}</ErrorBox>)}
      {doc.thumbs[0]?.url && lay.thumbs[0]?.url && (
        <div class="relative mx-auto aspect-[1/1.414] w-48 overflow-hidden rounded border border-line bg-white shadow-sm">
          {o.layer === 'under' && <img src={lay.thumbs[0].url} alt="" class="absolute inset-0 h-full w-full object-fill" style={{ opacity: o.opacity }} />}
          <img src={doc.thumbs[0].url} alt="" class="absolute inset-0 h-full w-full object-fill" style={{ mixBlendMode: 'multiply' }} />
          {o.layer === 'over' && <img src={lay.thumbs[0].url} alt="" class="absolute inset-0 h-full w-full object-fill" style={{ opacity: o.opacity, mixBlendMode: 'multiply' }} />}
        </div>
      )}
      <div class="grid gap-4 sm:grid-cols-2">
        <OptionChips<OverlayOpts['layer']> label="Place it" value={o.layer} onChange={(v) => v && set({ layer: v })} options={[{ value: 'under', label: 'Behind the text' }, { value: 'over', label: 'On top' }]} />
        <OptionChips<OverlayOpts['pages']> label="On pages" value={o.pages} onChange={(v) => v && set({ pages: v })} options={[{ value: 'all', label: 'All' }, { value: 'first', label: 'First only' }, { value: 'not-first', label: 'All but first' }]} />
        {lay.pageCount > 1 && <OptionChips<OverlayOpts['repeat']> label="Template has several pages" value={o.repeat} onChange={(v) => v && set({ repeat: v })} options={[{ value: 'first', label: 'Use page 1' }, { value: 'cycle', label: 'Match page by page' }]} />}
        <OptionChips<OverlayOpts['fit']> label="Size" value={o.fit} onChange={(v) => v && set({ fit: v })} options={[{ value: 'stretch', label: 'Fill the page' }, { value: 'fit', label: 'Keep proportions' }]} />
        <label class="block text-sm font-semibold">Opacity {Math.round(o.opacity * 100)}%<input type="range" min={10} max={100} step={5} value={o.opacity * 100} onInput={(e) => set({ opacity: +(e.target as HTMLInputElement).value / 100 })} class="mt-1 h-9 w-full accent-brand" /></label>
      </div>
      {o.layer === 'under' && <p class="text-xs text-muted dark:text-gray-400">“Behind the text” only shows where your document has no white background. Scanned pages cover it: use “On top” for scans.</p>}
      {phase === 'working' ? <ProgressBar label="Combining…" value={null} /> : <button type="button" class="btn-primary min-h-12 w-full" disabled={!doc.bytes || !lay.bytes} onClick={run}>{doc.bytes && lay.bytes ? 'Apply letterhead' : 'Select both PDFs'}</button>}
      <PrivacyNote />
    </div>
  );
}
