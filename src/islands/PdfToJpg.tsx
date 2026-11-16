import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError, UserError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

type Dpi = '72' | '150' | '300';
type Quality = '0.7' | '0.85' | '0.95';
interface Out { name: string; data: Blob; }

export default function PdfToJpg() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [dpi, setDpi] = useState<Dpi>('150');
  const [q, setQ] = useState<Quality>('0.85');
  const [pagesSel, setPagesSel] = useState('');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [outs, setOuts] = useState<Out[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancel, setCancel] = useState<{ v: boolean }>({ v: false });

  const open = async (files: File[]) => {
    setError(null);
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const pdf = await readPdf(files[0]);
      setFile(files[0]); setBytes(pdf.bytes); setPageCount(pdf.pageCount);
    } catch (e) { setError(friendlyError(e).message); }
  };

  const run = async () => {
    if (!bytes || !file) return;
    setError(null);
    const flag = { v: false }; setCancel(flag);
    try {
      const { parseRanges } = await import('../lib/ranges');
      const list = pagesSel.trim() ? [...new Set(parseRanges(pagesSel, pageCount).flat())].sort((a, b) => a - b) : Array.from({ length: pageCount }, (_, i) => i);
      setPhase('working');
      const { openPdf } = await import('../lib/pdfjs');
      const { renderPage } = await import('../lib/render');
      const pdf = await openPdf(bytes.slice());
      const base = stripExt(file.name);
      const result: Out[] = [];
      try {
        for (let k = 0; k < list.length; k++) {
          if (flag.v) throw new DOMException('Cancelled', 'AbortError');
          setProgress({ label: `Converting page ${list[k] + 1} (${k + 1} of ${list.length})…`, value: k / list.length });
          const c = await renderPage(pdf, list[k] + 1, Number(dpi));
          const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', Number(q)));
          c.width = c.height = 0;
          if (!blob) throw new UserError('Your browser couldn’t create the image. Try a lower DPI.', 'memory');
          result.push({ name: `${base}-page-${list[k] + 1}.jpg`, data: blob });
        }
      } finally { await pdf.destroy(); }
      setOuts(result); setPhase('done');
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e instanceof UserError ? e.message : friendlyError(e).message);
      setPhase('edit');
    }
  };

  const download = async () => {
    if (outs.length === 1) return downloadBlob(outs[0].data, outs[0].name, 'image/jpeg');
    const { makeZip } = await import('../lib/zip');
    downloadBlob(await makeZip(outs), `${stripExt(file!.name)}-jpg.zip`, 'application/zip');
  };
  const reset = () => { setFile(null); setBytes(null); setOuts([]); setPagesSel(''); setPhase('edit'); };

  if (phase === 'done') {
    const total = outs.reduce((s, o) => s + o.data.size, 0);
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`${outs.length} image${outs.length > 1 ? 's' : ''} ready!`} stats={[['Pages', String(outs.length)], ['Resolution', `${dpi} DPI`], ['Total size', formatBytes(total)]]}
          onDownload={download} downloadLabel={outs.length > 1 ? 'Download all (.zip)' : `Download ${outs[0].name.length > 30 ? 'JPG' : outs[0].name}`} onReset={reset} resetLabel="Convert another PDF">
          {outs.length > 1 && outs.length <= 60 && (
            <ul class="mt-3 grid max-h-56 grid-cols-2 gap-1 overflow-auto text-sm sm:grid-cols-3">
              {outs.map((o) => (
                <li key={o.name}><button type="button" class="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-1.5 text-left dark:bg-white/5" onClick={() => downloadBlob(o.data, o.name, 'image/jpeg')}><span class="truncate">{o.name.replace(/^.*-page-/, 'Page ').replace('.jpg', '')}</span><span class="text-xs font-semibold text-brand dark:text-brand-light">Save</span></button></li>
              ))}
            </ul>
          )}
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={open} />
        : <FileRow name={file.name} size={`${pageCount} pages · ${formatBytes(file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={!file ? () => setError(null) : undefined}>{error}</ErrorBox>}
      <div class={`grid gap-4 sm:grid-cols-2 ${phase === 'working' ? 'pointer-events-none opacity-60' : ''}`}>
        <OptionChips label="Resolution" options={[{ value: '72', label: '72 DPI' }, { value: '150', label: '150 DPI' }, { value: '300', label: '300 DPI' }]} value={dpi} onChange={(v) => v && setDpi(v)} />
        <OptionChips label="JPG quality" options={[{ value: '0.7', label: 'Medium' }, { value: '0.85', label: 'High' }, { value: '0.95', label: 'Maximum' }]} value={q} onChange={(v) => v && setQ(v)} />
      </div>
      {file && (
        <label class="block">
          <span class="mb-1.5 block text-sm font-semibold text-ink dark:text-white">Pages <span class="font-normal text-muted dark:text-gray-400">(optional, all by default)</span></span>
          <input type="text" inputMode="numeric" value={pagesSel} onInput={(e) => setPagesSel((e.target as HTMLInputElement).value)} placeholder={`e.g. 1-3, 5 (1–${pageCount})`}
            class="h-12 w-full rounded-control border border-line bg-white px-4 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 dark:border-white/10 dark:bg-night-2" />
        </label>
      )}
      {phase === 'working' ? (
        <div class="space-y-3">
          <ProgressBar label={progress.label} value={progress.value} detail="Rendering on your device…" />
          <button type="button" class="btn-ghost w-full" onClick={() => { cancel.v = true; }}>Cancel</button>
        </div>
      ) : file && (
        <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Convert to JPG</button>
      )}
      <PrivacyNote />
    </div>
  );
}
