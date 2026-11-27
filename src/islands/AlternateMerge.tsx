import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import PageThumb from '../components/ui/PageThumb';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

type Mode = 'two' | 'one';

/** Final page sequence as [file, page] pairs (file 0 = fronts, 1 = backs), mirroring pdfOps.alternateMerge. */
export function interleave(nA: number, nB: number | null, reverseB: boolean): [number, number][] {
  let a = Array.from({ length: nA }, (_, i): [number, number] => [0, i]);
  let b = nB === null ? [] : Array.from({ length: nB }, (_, i): [number, number] => [1, i]);
  if (nB === null) { const h = Math.ceil(nA / 2); b = a.slice(h); a = a.slice(0, h); }
  if (reverseB) b.reverse();
  const out: [number, number][] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
  return out;
}

export default function AlternateMerge() {
  const fronts = usePdfDoc(120);
  const backs = usePdfDoc(120);
  const [mode, setMode] = useState<Mode>('two');
  const [reverseB, setReverseB] = useState(true);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = fronts.pageCount > 0 && (mode === 'one' ? fronts.pageCount > 1 : backs.pageCount > 0);
  const seq = ready ? interleave(fronts.pageCount, mode === 'one' ? null : backs.pageCount, reverseB) : [];
  const mismatch = mode === 'two' && ready && fronts.pageCount !== backs.pageCount;

  const run = async () => {
    if (!fronts.bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('alternateMerge', [fronts.bytes.slice().buffer, mode === 'two' && backs.bytes ? backs.bytes.slice().buffer : null, reverseB]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { fronts.clear(); backs.clear(); setOut(null); setPhase('edit'); };
  const name = fronts.file ? `${stripExt(fronts.file.name)}-double-sided.pdf` : 'double-sided.pdf';

  if (phase === 'done' && out) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Pages merged in alternating order!" stats={[['Pages', String(seq.length)], ['Order', mode === 'one' ? '1 file' : '2 files'], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, name)} downloadLabel="Download merged PDF" onReset={reset} resetLabel="Merge other scans">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change options</button>
        </ResultCard>
      </div>
    );
  }

  const thumb = (f: number, p: number) => (f === 0 || mode === 'one' ? fronts.thumbs[p] : backs.thumbs[p]);
  const slot = (d: ReturnType<typeof usePdfDoc>, label: string, hint: string) => (
    !d.file ? <Dropzone compact accept="application/pdf,.pdf" title={label} buttonLabel="Select PDF" hint={hint} onFiles={d.open} />
      : <FileRow name={d.file.name} size={`${label} · ${d.pageCount} pages · ${formatBytes(d.file.size)}`} onRemove={phase === 'working' ? undefined : d.clear} />
  );

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <OptionChips<Mode> label="Your scans" value={mode} onChange={(v) => { if (v) { setMode(v); backs.clear(); } }} variant="cards" options={[
        { value: 'two', label: 'Two PDFs', sub: 'Fronts + backs' },
        { value: 'one', label: 'One PDF', sub: 'All fronts, then backs' },
      ]} />
      {slot(fronts, mode === 'one' ? 'Scanned PDF' : 'Odd pages (fronts)', mode === 'one' ? 'First half = fronts, second half = backs' : 'Pages 1, 3, 5…')}
      {mode === 'two' && slot(backs, 'Even pages (backs)', 'Pages 2, 4, 6…')}
      {(fronts.loading || backs.loading) && <ProgressBar label="Reading PDF…" value={null} />}
      {[fronts.error, backs.error, error].filter(Boolean).map((m) => <ErrorBox key={m}>{m}</ErrorBox>)}
      <label class="flex min-h-11 cursor-pointer items-start gap-3 rounded-control border border-line p-3 text-sm dark:border-white/10">
        <input type="checkbox" class="mt-0.5 h-5 w-5 accent-brand" checked={reverseB} onChange={(e) => setReverseB((e.target as HTMLInputElement).checked)} />
        <span><span class="font-semibold text-ink dark:text-white">Backs are in reverse order</span><br /><span class="text-muted dark:text-gray-400">Turn on if you flipped the whole stack to scan the back sides, so the last back came out first.</span></span>
      </label>
      {mismatch && <p class="rounded-control bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">The files have different page counts ({fronts.pageCount} and {backs.pageCount}). Extra pages are added at the end.</p>}
      {seq.length > 0 && (
        <div>
          <p class="mb-2 text-sm font-semibold text-ink dark:text-white">Result preview</p>
          <ul class="grid max-h-[28rem] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-6 sm:gap-3">
            {seq.map(([f, p], i) => {
              const t = thumb(f, p);
              const back = mode === 'one' ? p >= Math.ceil(fronts.pageCount / 2) : f === 1;
              return <li key={i}><PageThumb url={t?.url} aspect={t?.aspect} badge={i + 1} caption={back ? 'Back' : 'Front'} sub={`${mode === 'one' ? '' : back ? 'B · ' : 'A · '}page ${p + 1}`} /></li>;
            })}
          </ul>
        </div>
      )}
      <StickyActions>
        {phase === 'working' ? <ProgressBar label="Merging pages…" value={null} /> : (
          <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!ready} onClick={run}>{ready ? `Merge into ${seq.length} pages` : mode === 'one' ? 'Select your scanned PDF' : 'Select both PDFs'}</button>
        )}
      </StickyActions>
      <PrivacyNote />
    </div>
  );
}
