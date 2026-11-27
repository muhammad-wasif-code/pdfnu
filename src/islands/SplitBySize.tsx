import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OutputList, { downloadAll, type OutFile } from '../components/ui/OutputList';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt, MB } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

const PRESETS = [
  { mb: 1, label: '1 MB' }, { mb: 2, label: '2 MB' }, { mb: 5, label: '5 MB' }, { mb: 10, label: '10 MB' },
  { mb: 20, label: '20 MB (Gmail)' }, { mb: 25, label: '25 MB' },
];

export default function SplitBySize() {
  const doc = usePdfDoc(120, true);
  const [mb, setMb] = useState(10);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [outs, setOuts] = useState<OutFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const limit = Math.round(mb * MB);
  const tooSmall = doc.file ? doc.file.size <= limit : false;
  const run = async () => {
    if (!doc.bytes || !doc.file) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const parts = await pdfOp('splitBySize', [doc.bytes.slice().buffer, limit]);
      const base = stripExt(doc.file.name);
      setOuts(parts.map((p, i) => ({
        name: `${base}-part-${i + 1}-of-${parts.length}.pdf`, data: p.bytes, warn: p.tooBig,
        note: `${p.first === p.last ? `page ${p.first + 1}` : `pages ${p.first + 1}–${p.last + 1}`}${p.tooBig ? ' (one page is larger than the limit)' : ''}`,
      })));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOuts([]); setPhase('edit'); };

  if (phase === 'done' && doc.file) {
    const big = outs.filter((o) => o.warn).length;
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`Split into ${outs.length} part${outs.length === 1 ? '' : 's'}!`} stats={[['Limit', `${mb} MB`], ['Parts', String(outs.length)], ['Largest', formatBytes(Math.max(...outs.map((o) => o.data.length)))]]}
          warnings={big ? [`${big} part${big === 1 ? ' is' : 's are'} a single page that is bigger than ${mb} MB on its own. Make it smaller with Compress PDF.`] : undefined}
          onDownload={() => downloadAll(outs, `${stripExt(doc.file!.name)}-parts.zip`)} downloadLabel={outs.length > 1 ? 'Download all (.zip)' : 'Download PDF'} onReset={reset} resetLabel="Split another PDF">
          <OutputList files={outs} />
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change size limit</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your large PDF here" buttonLabel="Select PDF" hint="Split it into parts that fit email or upload limits." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <>
          <fieldset>
            <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Maximum size of each part</legend>
            <div class="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button key={p.mb} type="button" aria-pressed={mb === p.mb} onClick={() => setMb(p.mb)}
                  class={`min-h-11 rounded-control border px-3 text-sm font-semibold ${mb === p.mb ? 'border-brand bg-brand-soft text-brand ring-1 ring-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-surface dark:border-white/10 dark:bg-white/[.03]'}`}>{p.label}</button>
              ))}
              <label class="flex items-center gap-2 text-sm">Custom
                <input type="number" min={0.1} step={0.1} value={mb} onInput={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (v > 0) setMb(v); }}
                  class="h-11 w-24 rounded-control border border-line bg-white px-3 text-[15px] dark:border-white/10 dark:bg-night-2" /> MB</label>
            </div>
          </fieldset>
          <p class="text-sm text-muted dark:text-gray-400">
            {tooSmall ? `This file is already smaller than ${mb} MB, so it fits in one part.` : `About ${Math.ceil(doc.file.size / limit)} or more parts. Pages are never cut, and parts are checked after saving.`}
          </p>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Measuring pages and splitting…" value={null} detail="Large files can take a minute." /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={tooSmall} onClick={run}>{tooSmall ? 'Already under the limit' : `Split into parts under ${mb} MB`}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
