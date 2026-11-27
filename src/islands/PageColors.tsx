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

/** Two tools in one island: invert colours, or tint the paper. */
type Kind = 'invert' | 'background';
const PAPER = [
  { c: '#fef9c3', n: 'Cream' }, { c: '#fde68a', n: 'Yellow' }, { c: '#dcfce7', n: 'Mint' }, { c: '#dbeafe', n: 'Blue' },
  { c: '#fce7f3', n: 'Pink' }, { c: '#f5f5f4', n: 'Light grey' }, { c: '#ede9fe', n: 'Lavender' }, { c: '#ffedd5', n: 'Peach' },
];

export default function PageColors({ kind }: { kind: Kind }) {
  const doc = usePdfDoc(150);
  const [color, setColor] = useState(PAPER[0].c);
  const [mode, setMode] = useState<'multiply' | 'behind'>('multiply');
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = Array.from({ length: doc.pageCount }, (_, i) => i).filter((i) => !skip.has(i));
  const run = async () => {
    if (!doc.bytes || !chosen.length) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const which = chosen.length === doc.pageCount ? null : chosen;
      setOut(kind === 'invert' ? await pdfOp('invertColors', [doc.bytes.slice().buffer, which]) : await pdfOp('pageBackground', [doc.bytes.slice().buffer, color, mode, which]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOut(null); setPhase('edit'); setSkip(new Set()); };
  const name = doc.file ? `${stripExt(doc.file.name)}-${kind === 'invert' ? 'inverted' : 'colored'}.pdf` : 'output.pdf';

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={kind === 'invert' ? 'Colours inverted!' : 'Page colour changed!'} stats={[['Pages', String(chosen.length)], ['Of', String(doc.pageCount)], ['Size', formatBytes(out.length)]]}
          highlight="Text stays real, selectable text. Nothing was turned into pictures."
          onDownload={() => downloadBlob(out, name)} downloadLabel="Download PDF" onReset={reset} resetLabel="Use another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change options</button>
        </ResultCard>
      </div>
    );
  }

  const tint = kind === 'background' && mode === 'multiply';
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint={kind === 'invert' ? 'White becomes black, black becomes white.' : 'Give the pages a coloured paper look.'} onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <>
          {kind === 'background' && (
            <>
              <fieldset>
                <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Paper colour</legend>
                <div class="flex flex-wrap items-center gap-2">
                  {PAPER.map((p) => (
                    <button key={p.c} type="button" aria-pressed={color === p.c} aria-label={p.n} title={p.n} onClick={() => setColor(p.c)}
                      class={`h-10 w-10 rounded-full border-[3px] ring-1 ring-black/15 ${color === p.c ? 'border-brand' : 'border-white dark:border-night-3'}`} style={{ background: p.c }} />
                  ))}
                  <label class="flex items-center gap-2 text-sm">Custom <input type="color" value={color} onInput={(e) => setColor((e.target as HTMLInputElement).value)} class="h-10 w-12 cursor-pointer rounded border border-line bg-white dark:border-white/10" /></label>
                </div>
              </fieldset>
              <OptionChips<'multiply' | 'behind'> label="How" value={mode} onChange={(v) => v && setMode(v)} variant="cards" options={[
                { value: 'multiply', label: 'Tint the whole page', sub: 'Works on scans too' },
                { value: 'behind', label: 'Behind content only', sub: 'Keeps images unchanged' },
              ]} />
            </>
          )}
          <p class="text-sm"><span class="font-semibold text-ink dark:text-white">{chosen.length} of {doc.pageCount} pages</span> <span class="text-muted dark:text-gray-400">· tap a page to leave it unchanged</span></p>
          <ul class="grid max-h-[30rem] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5 sm:gap-3">
            {doc.thumbs.map((t, i) => {
              const on = !skip.has(i);
              return (
                <li key={i}>
                  <button type="button" class="block w-full rounded-control" aria-pressed={on} onClick={() => setSkip((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}>
                    <PageThumb url={t.url} aspect={t.aspect} caption={`Page ${i + 1}`} sub={on ? 'Change' : 'Unchanged'} selected={on}>
                      {on && t.url && (kind === 'invert'
                        ? <span class="pointer-events-none absolute inset-0 bg-white" style={{ mixBlendMode: 'difference' }} />
                        : <span class="pointer-events-none absolute inset-0" style={{ background: color, mixBlendMode: tint ? 'multiply' : 'multiply', opacity: tint ? 1 : 0.55 }} />)}
                    </PageThumb>
                  </button>
                </li>
              );
            })}
          </ul>
          {kind === 'background' && mode === 'behind' && <p class="text-xs text-muted dark:text-gray-400">“Behind content only” shows only where the page itself has no white background. Scanned pages and many exported PDFs paint their own white background, so use “Tint the whole page” for those.</p>}
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Applying colours…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!chosen.length} onClick={run}>{kind === 'invert' ? `Invert ${chosen.length} page${chosen.length === 1 ? '' : 's'}` : `Colour ${chosen.length} page${chosen.length === 1 ? '' : 's'}`}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
