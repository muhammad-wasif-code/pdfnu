import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, percentSaved, KB } from '../lib/format';
import { assertPdf, friendlyError, isPdfName, UserError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { CompressResult, Preset, Progress } from '../lib/compress';

type Target = '100' | '200' | '500' | '1024' | '2048';
type Phase = 'idle' | 'ready' | 'working' | 'done' | 'error';

const PRESETS = [
  { value: 'smallest' as const, label: 'Smallest', sub: 'Highest compression' },
  { value: 'recommended' as const, label: 'Recommended', sub: 'Balanced' },
  { value: 'high' as const, label: 'High Quality', sub: 'Better quality' },
];
const TARGETS = [
  { value: '100' as const, label: '100KB' },
  { value: '200' as const, label: '200KB' },
  { value: '500' as const, label: '500KB' },
  { value: '1024' as const, label: '1MB' },
  { value: '2048' as const, label: '2MB' },
];

export default function CompressPdf() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<Preset>('recommended');
  const [target, setTarget] = useState<Target | null>(null);
  const [progress, setProgress] = useState<Progress>({ label: '', value: 0 });
  const [result, setResult] = useState<CompressResult | null>(null);
  const [error, setError] = useState<UserError | null>(null);
  const abort = useRef<AbortController | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // Allow "?target=200" deep links from guides
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('target');
    if (t && TARGETS.some((x) => x.value === t)) setTarget(t as Target);
  }, []);

  const pick = async (files: File[]) => {
    const f = files[0];
    setError(null);
    setResult(null);
    if (!isPdfName(f)) {
      setError(new UserError(`“${f.name}” is not a PDF. Please choose a .pdf file.`, 'type'));
      setPhase('error');
      return;
    }
    try { await assertPdf(f); } catch (e) { setError(friendlyError(e)); setPhase('error'); return; }
    setFile(f);
    setPhase('ready');
    // Lazy-load: start fetching the Ghostscript WASM only once a file is chosen.
    import('../lib/ghostscript').then((m) => m.warmupGhostscript());
  };

  const run = async () => {
    if (!file) return;
    setPhase('working');
    setError(null);
    setProgress({ label: 'Starting…', value: 0 });
    abort.current = new AbortController();
    try {
      const { compressPdf } = await import('../lib/compress');
      const res = await compressPdf(file, { preset, target: target ? Number(target) * KB : null }, setProgress, abort.current.signal);
      setResult(res);
      setPhase('done');
      top.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e: any) {
      if (e?.name === 'AbortError') { setPhase('ready'); return; }
      setError(friendlyError(e));
      setPhase('error');
    }
  };

  const cancel = () => {
    abort.current?.abort();
    // Ghostscript can't be interrupted mid-run → kill the worker; it respawns on next use.
    import('../lib/ghostscript').then((m) => m.resetGhostscript());
    import('../lib/pdfWorker').then((m) => m.resetPdfWorker());
    setPhase('ready');
  };

  const reset = () => { setFile(null); setResult(null); setError(null); setPhase('idle'); };

  const download = () => {
    if (!file || !result) return;
    downloadBlob(result.bytes, file.name);
  };

  const targetBytes = target ? Number(target) * KB : null;

  return (
    <div ref={top} class="card space-y-5 p-4 sm:p-6">
      {phase === 'done' && file && result ? (
        <Done file={file} result={result} targetBytes={targetBytes} onDownload={download} onReset={reset} />
      ) : (
        <>
          {!file ? (
            <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Works offline · No size limit except your device’s memory" onFiles={pick} />
          ) : (
            <FileRow name={file.name} size={formatBytes(file.size)} onRemove={phase === 'working' ? undefined : reset} />
          )}

          {phase === 'error' && error && <ErrorBox onRetry={reset}>{error.message}</ErrorBox>}

          <div class={`space-y-4 ${phase === 'working' ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={phase === 'working'}>
            <OptionChips label="Compression level" variant="cards" options={PRESETS} value={target ? null : preset} onChange={(v) => { if (v) { setPreset(v); setTarget(null); } }} />
            <OptionChips label="Or pick an exact target size" options={TARGETS} value={target} onChange={setTarget} clearable />
          </div>

          {phase === 'working' ? (
            <div class="space-y-3">
              <ProgressBar
                value={progress.value}
                label={progress.label}
                detail={progress.bestSoFar ? `Before ${formatBytes(file!.size)} → best so far ${formatBytes(progress.bestSoFar)} (${percentSaved(file!.size, progress.bestSoFar)}% smaller)` : 'Processing on your device…'}
              />
              <button type="button" class="btn-ghost w-full" onClick={cancel}>Cancel</button>
            </div>
          ) : (
            file && phase !== 'error' && (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>
                {target ? `Compress to under ${TARGETS.find((t) => t.value === target)!.label}` : 'Compress PDF'}
              </button>
            )
          )}

          <PrivacyNote />
        </>
      )}
    </div>
  );
}

function Done({ file, result, targetBytes, onDownload, onReset }: { file: File; result: CompressResult; targetBytes: number | null; onDownload: () => void; onReset: () => void }) {
  const before = file.size;
  const after = result.bytes.length;
  const saved = percentSaved(before, after);
  const warnings: string[] = [];
  if (result.textLost) warnings.push('To reach this size, pages were converted to images. Text can no longer be selected or searched. Use a larger target to keep text selectable.');
  if (result.targetMissed && targetBytes) {
    warnings.push(
      `${formatBytes(targetBytes)} isn’t reachable without making this PDF unreadable. This is the smallest readable version (${formatBytes(after)}). Try splitting the PDF or removing pages you don’t need.`,
    );
  }
  const already = result.method === 'original';
  const underTarget = already && targetBytes !== null && before <= targetBytes;
  return (
    <ResultCard
      title={underTarget ? `Already under ${formatBytes(targetBytes!)}` : already ? 'This PDF is already well optimized' : 'Compression complete!'}
      stats={[['Before', formatBytes(before)], ['After', formatBytes(after)], ['Saved', `${saved}%`]]}
      highlight={
        underTarget
          ? 'Your PDF already meets the size limit, so it’s unchanged.'
          : already
            ? 'We couldn’t make it smaller without losing quality, so your original file is unchanged.'
            : `${saved}% smaller · ${result.detail}`
      }
      warnings={warnings}
      onDownload={onDownload}
      downloadLabel={`Download ${file.name.length > 28 ? 'PDF' : file.name}`}
      onReset={onReset}
      resetLabel="Compress another PDF"
    />
  );
}
