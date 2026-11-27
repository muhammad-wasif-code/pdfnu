import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { bookletOrder } from '../lib/booklet';
import type { BookletOpts } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

export default function BookletPdf() {
  const doc = usePdfDoc(120);
  const [sheet, setSheet] = useState<BookletOpts['sheet']>('a4');
  const [rtl, setRtl] = useState(false);
  const [creep, setCreep] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sides = doc.pageCount ? bookletOrder(doc.pageCount, rtl) : [];
  const paper = sides.length / 2;
  const blanks = sides.flat().filter((i) => i < 0).length;

  const run = async () => {
    if (!doc.bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('booklet', [doc.bytes.slice().buffer, { sheet, rtl, margin: 12, creep: creep ? Math.min(12, paper * 0.25) : 0 }]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOut(null); setPhase('edit'); };
  const name = doc.file ? `${stripExt(doc.file.name)}-booklet.pdf` : 'booklet.pdf';

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your booklet is ready to print!" stats={[['Pages', String(doc.pageCount)], ['Paper sheets', String(paper)], ['Size', formatBytes(out.length)]]}
          highlight="Print double-sided, flipping on the short edge. Then fold the stack in half and staple along the fold."
          onDownload={() => downloadBlob(out, name)} downloadLabel="Download booklet PDF" onReset={reset} resetLabel="Make another booklet">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change options</button>
        </ResultCard>
      </div>
    );
  }

  const label = (i: number) => (i < 0 ? 'blank' : String(i + 1));
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Pages are arranged so you can print, fold and staple." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <>
          <OptionChips<BookletOpts['sheet']> label="Paper" value={sheet} onChange={(v) => v && setSheet(v)} options={[{ value: 'a4', label: 'A4 → A5 booklet' }, { value: 'letter', label: 'Letter' }, { value: 'a3', label: 'A3 → A4 booklet' }, { value: 'source', label: 'Keep page size' }]} />
          <OptionChips<'l' | 'r'> label="Binding" value={rtl ? 'r' : 'l'} onChange={(v) => v && setRtl(v === 'r')} options={[{ value: 'l', label: 'Left (English)' }, { value: 'r', label: 'Right (Urdu, Arabic)' }]} />
          <label class="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" class="mt-0.5 h-5 w-5 accent-brand" checked={creep} onChange={(e) => setCreep((e.target as HTMLInputElement).checked)} />
            <span><span class="font-semibold text-ink dark:text-white">Creep compensation</span><br /><span class="text-muted dark:text-gray-400">For thick booklets: inner pages move slightly outward so margins look even after folding.</span></span></label>
          <div>
            <p class="mb-2 text-sm font-semibold text-ink dark:text-white">{paper} sheet{paper === 1 ? '' : 's'} of paper{blanks ? ` · ${blanks} blank page${blanks === 1 ? '' : 's'} added to make a multiple of 4` : ''}</p>
            <ol class="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto text-xs sm:grid-cols-4">
              {sides.map(([l, r], i) => (
                <li key={i} class="rounded-control border border-line p-2 dark:border-white/10">
                  <p class="mb-1 font-semibold">Sheet {Math.floor(i / 2) + 1} · {i % 2 ? 'back' : 'front'}</p>
                  <div class="flex aspect-[1.414] gap-0.5 bg-surface p-1 dark:bg-white/5">
                    {[l, r].map((p, k) => (
                      <div key={k} class="grid flex-1 place-items-center overflow-hidden bg-white text-[11px] font-semibold text-muted dark:bg-night-3">
                        {p >= 0 && doc.thumbs[p]?.url ? <img src={doc.thumbs[p].url} alt={`Page ${p + 1}`} class="max-h-full max-w-full" /> : label(p)}
                      </div>
                    ))}
                  </div>
                  <p class="mt-1 text-center text-muted dark:text-gray-400">{label(l)} | {label(r)}</p>
                </li>
              ))}
            </ol>
          </div>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Arranging booklet…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Make booklet ({paper} sheet{paper === 1 ? '' : 's'})</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
