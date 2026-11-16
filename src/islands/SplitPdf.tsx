import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import PageThumb from '../components/ui/PageThumb';
import OptionChips from '../components/ui/OptionChips';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

type Mode = 'ranges' | 'select' | 'each';
interface Out { name: string; data: Uint8Array; }

export default function SplitPdf({ initialMode = 'ranges' }: { initialMode?: Mode }) {
  const doc = usePdfDoc();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [ranges, setRanges] = useState('');
  const [mergeRanges, setMergeRanges] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [outputs, setOutputs] = useState<Out[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggle = (i: number) => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const run = async () => {
    if (!doc.bytes || !doc.file) return;
    setError(null);
    try {
      const { parseRanges, formatPages } = await import('../lib/ranges');
      const base = stripExt(doc.file.name);
      let groups: number[][];
      let names: string[];
      if (mode === 'ranges') {
        groups = parseRanges(ranges, doc.pageCount);
        if (mergeRanges) { groups = [groups.flat()]; names = [`${base}-pages-${formatPages(groups[0]).replace(/, /g, '_')}.pdf`]; }
        else names = groups.map((g) => `${base}-pages-${formatPages(g)}.pdf`);
      } else if (mode === 'select') {
        if (!selected.size) throw new Error('Tap the pages you want to extract.');
        groups = [[...selected].sort((a, b) => a - b)];
        names = [`${base}-pages-${formatPages(groups[0]).replace(/, /g, '_')}.pdf`];
      } else {
        groups = Array.from({ length: doc.pageCount }, (_, i) => [i]);
        names = groups.map((g) => `${base}-page-${g[0] + 1}.pdf`);
      }
      setPhase('working');
      const { pdfOp } = await import('../lib/pdfWorker');
      const datas = await pdfOp('extractGroups', [doc.bytes.slice().buffer, groups]);
      setOutputs(datas.map((data, i) => ({ name: names[i], data })));
      setPhase('done');
    } catch (e: any) {
      setError(e?.code ? e.message : e?.message?.startsWith('Tap') ? e.message : friendlyError(e).message);
      setPhase('edit');
    }
  };

  const download = async () => {
    if (outputs.length === 1) return downloadBlob(outputs[0].data, outputs[0].name);
    const { makeZip } = await import('../lib/zip');
    downloadBlob(await makeZip(outputs), `${stripExt(doc.file!.name)}-split.zip`, 'application/zip');
  };

  const reset = () => { doc.clear(); setOutputs([]); setSelected(new Set()); setRanges(''); setPhase('edit'); };

  if (phase === 'done') {
    const total = outputs.reduce((s, o) => s + o.data.length, 0);
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard
          title={outputs.length > 1 ? `Split into ${outputs.length} PDFs` : 'Pages extracted!'}
          stats={[['Original', `${doc.pageCount} pages`], ['Files', String(outputs.length)], ['Total size', formatBytes(total)]]}
          onDownload={download}
          downloadLabel={outputs.length > 1 ? `Download all (.zip)` : `Download ${outputs[0].name.length > 30 ? 'PDF' : outputs[0].name}`}
          onReset={reset}
          resetLabel="Split another PDF"
        >
          {outputs.length > 1 && (
            <ul class="mt-3 max-h-48 space-y-1 overflow-auto text-sm">
              {outputs.map((o) => (
                <li key={o.name} class="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-1.5 dark:bg-white/5">
                  <span class="truncate">{o.name}</span>
                  <button type="button" class="min-h-9 shrink-0 font-semibold text-brand dark:text-brand-light" onClick={() => downloadBlob(o.data, o.name)}>Save</button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change selection</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? (
        <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={doc.open} />
      ) : (
        <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={reset} />
      )}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}

      {doc.file && (
        <>
          <OptionChips
            label="How do you want to split?"
            variant="cards"
            options={[
              { value: 'ranges', label: 'By ranges', sub: 'e.g. 1-3, 5' },
              { value: 'select', label: 'Select pages', sub: 'Tap to pick' },
              { value: 'each', label: 'Every page', sub: 'One PDF each' },
            ]}
            value={mode}
            onChange={(v) => v && setMode(v)}
          />

          {mode === 'ranges' && (
            <div class="space-y-3">
              <label class="block">
                <span class="mb-1.5 block text-sm font-semibold text-ink dark:text-white">Page ranges</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={ranges}
                  onInput={(e) => setRanges((e.target as HTMLInputElement).value)}
                  placeholder={`e.g. 1-3, 5, 8-${doc.pageCount}`}
                  class="h-12 w-full rounded-control border border-line bg-white px-4 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 dark:border-white/10 dark:bg-night-2"
                />
                <span class="mt-1 block text-xs text-muted dark:text-gray-400">Each range becomes a separate PDF. This file has {doc.pageCount} pages.</span>
              </label>
              <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" class="h-5 w-5 accent-brand" checked={mergeRanges} onChange={(e) => setMergeRanges((e.target as HTMLInputElement).checked)} />
                Put all ranges into one PDF
              </label>
            </div>
          )}

          {mode !== 'each' && doc.pageCount > 0 && (
            <div>
              {mode === 'select' && (
                <div class="mb-2 flex items-center justify-between text-sm">
                  <span class="font-semibold text-ink dark:text-white">{selected.size} of {doc.pageCount} selected</span>
                  <span class="flex gap-3">
                    <button type="button" class="min-h-9 font-semibold text-brand dark:text-brand-light" onClick={() => setSelected(new Set(Array.from({ length: doc.pageCount }, (_, i) => i)))}>All</button>
                    <button type="button" class="min-h-9 font-semibold text-brand dark:text-brand-light" onClick={() => setSelected(new Set())}>None</button>
                  </span>
                </div>
              )}
              <ul class="grid max-h-[28rem] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5 sm:gap-3" aria-label="Pages">
                {doc.thumbs.map((t, i) => (
                  <li key={i}>
                    {mode === 'select' ? (
                      <button type="button" class="block w-full rounded-control text-left" aria-pressed={selected.has(i)} aria-label={`Page ${i + 1}`} onClick={() => toggle(i)}>
                        <PageThumb url={t.url} aspect={t.aspect} caption={`Page ${i + 1}`} selected={selected.has(i)}>
                          {selected.has(i) && <span class="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-brand text-white"><svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor" aria-hidden="true"><path d="M8.2 13.6 4.6 10l-1.1 1.1 4.7 4.7 9.4-9.4-1.1-1.1z" /></svg></span>}
                        </PageThumb>
                      </button>
                    ) : (
                      <PageThumb url={t.url} aspect={t.aspect} caption={`Page ${i + 1}`} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mode === 'each' && <p class="rounded-control bg-surface px-4 py-3 text-sm text-gray-700 dark:bg-white/5 dark:text-gray-300">You’ll get {doc.pageCount} PDFs, one per page, in a single .zip download.</p>}

          <StickyActions>
            {phase === 'working' ? (
              <ProgressBar label="Splitting PDF…" value={null} detail="Processing on your device…" />
            ) : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run} disabled={(mode === 'ranges' && !ranges.trim()) || (mode === 'select' && !selected.size)}>
                {mode === 'each' ? `Split into ${doc.pageCount} PDFs` : mode === 'select' ? `Extract ${selected.size || ''} page${selected.size === 1 ? '' : 's'}` : 'Split PDF'}
              </button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
