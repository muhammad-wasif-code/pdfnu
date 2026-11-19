import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

type Six = [string, string, string, string, string, string];
const SLOTS = ['Header left', 'Header centre', 'Header right', 'Footer left', 'Footer centre', 'Footer right'];
const TOKENS = ['[page]', '[pages]', '[date]', '[file]'];

export default function HeaderFooter() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState(0);
  const [slots, setSlots] = useState<Six>(['', '', '', '[file]', '', 'Page [page] of [pages]']);
  const [focus, setFocus] = useState(5);
  const [size, setSize] = useState(9);
  const [skipFirst, setSkipFirst] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (files: File[]) => {
    setError(null);
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const pdf = await readPdf(files[0]);
      setFile(files[0]); setBytes(pdf.bytes); setPages(pdf.pageCount);
    } catch (e) { setError(friendlyError(e).message); }
  };
  const set = (i: number, v: string) => setSlots((c) => { const n = c.slice() as Six; n[i] = v; return n; });
  const run = async () => {
    if (!bytes || !file) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      setOut(await pdfOp('headerFooter', [bytes.slice().buffer, {
        header: [slots[0], slots[1], slots[2]], footer: [slots[3], slots[4], slots[5]],
        fontSize: size, color: '#333333', start: 1, skipFirst, fileName: file.name.replace(/\.pdf$/i, ''), date,
      }]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setBytes(null); setOut(null); setPhase('edit'); };
  const filled = slots.filter((s) => s.trim()).length;

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Header & footer added!" stats={[['Pages', String(pages)], ['Text slots', String(filled)], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, file.name)} downloadLabel={`Download ${file.name.length > 30 ? 'PDF' : file.name}`} onReset={reset} resetLabel="Use another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change text</button>
        </ResultCard>
      </div>
    );
  }

  const input = (i: number) => (
    <label class="block min-w-0">
      <span class="mb-1 block text-xs font-semibold text-muted dark:text-gray-400">{SLOTS[i]}</span>
      <input type="text" maxLength={80} value={slots[i]} onFocus={() => setFocus(i)} onInput={(e) => set(i, (e.target as HTMLInputElement).value)}
        class="h-11 w-full rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" />
    </label>
  );

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={open} />
        : <FileRow name={file.name} size={`${pages} page${pages === 1 ? '' : 's'} · ${formatBytes(file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={!file ? () => setError(null) : undefined}>{error}</ErrorBox>}
      {file && (
        <>
          <div class="grid gap-3 sm:grid-cols-3">{input(0)}{input(1)}{input(2)}</div>
          <div class="grid gap-3 sm:grid-cols-3">{input(3)}{input(4)}{input(5)}</div>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-muted dark:text-gray-400">Insert into {SLOTS[focus].toLowerCase()}:</span>
            {TOKENS.map((t) => <button key={t} type="button" class="min-h-9 rounded-lg border border-line px-2.5 font-mono text-xs dark:border-white/10" onClick={() => set(focus, (slots[focus] ? slots[focus] + ' ' : '') + t)}>{t}</button>)}
          </div>
          <div class="flex flex-wrap items-center gap-4 text-sm">
            <label class="flex items-center gap-2">Text size
              <input type="range" min={7} max={16} value={size} onInput={(e) => setSize(Number((e.target as HTMLInputElement).value))} class="accent-brand" /> <span class="w-8 tabular-nums">{size}pt</span>
            </label>
            <label class="flex min-h-11 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={skipFirst} onChange={(e) => setSkipFirst((e.target as HTMLInputElement).checked)} /> Skip the first page</label>
          </div>
          {phase === 'working' ? <ProgressBar label="Adding header & footer…" value={null} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!filled} onClick={run}>Add header & footer</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
