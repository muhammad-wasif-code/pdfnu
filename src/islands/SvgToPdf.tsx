import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

interface Item { id: number; file: File; url: string; }
let seq = 0;

export default function SvgToPdf() {
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState<'svg' | 'a4' | 'letter'>('svg');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ blob: Blob; pages: number; raster: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = (files: File[]) => {
    setError(null);
    const ok = files.filter((f) => /\.svgz?$/i.test(f.name) || f.type === 'image/svg+xml');
    if (ok.length < files.length) setError('Only .svg files can be added here. For PNG or JPG pictures, use JPG to PDF.');
    setItems((c) => [...c, ...ok.map((file) => ({ id: seq++, file, url: URL.createObjectURL(file) }))]);
  };
  const run = async () => {
    if (!items.length) return;
    setPhase('working'); setError(null);
    try {
      const files = await Promise.all(items.map(async (i) => {
        if (/\.svgz$/i.test(i.file.name)) {
          const ds = new DecompressionStream('gzip');
          return { name: i.file.name, text: await new Response(i.file.stream().pipeThrough(ds)).text() };
        }
        return { name: i.file.name, text: await i.file.text() };
      }));
      const { svgToPdf } = await import('../lib/svgToPdf');
      const r = await svgToPdf(files, { page, margin: 36 });
      setOut({ blob: new Blob([r.pdf as BlobPart], { type: 'application/pdf' }), pages: r.pages, raster: r.rasterised });
      setPhase('done');
    } catch (e) { setError((e as Error)?.message === 'NOT_SVG' ? 'One of the files isn’t a valid SVG image.' : friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { items.forEach((i) => URL.revokeObjectURL(i.url)); setItems([]); setOut(null); setPhase('edit'); };
  const name = items.length === 1 ? `${stripExt(items[0].file.name)}.pdf` : 'svg-images.pdf';

  if (phase === 'done' && out) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is ready!" stats={[['Images', String(items.length)], ['Pages', String(out.pages)], ['PDF', formatBytes(out.blob.size)]]}
          highlight={out.raster < items.length ? 'Shapes, gradients and text stay vector: sharp at any zoom and in print.' : undefined}
          warnings={out.raster ? [`${out.raster} drawing${out.raster === 1 ? ' uses' : 's use'} filters, masks or clipping, so ${out.raster === 1 ? 'it was' : 'they were'} added as a high-resolution picture instead of vectors.`] : undefined}
          onDownload={() => downloadBlob(out.blob, name)} downloadLabel="Download PDF" onReset={reset} resetLabel="Convert more SVGs">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change options</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <Dropzone accept=".svg,.svgz,image/svg+xml" multiple compact={items.length > 0} title={items.length ? 'Add more SVG files' : 'Drag & drop your SVG files here'} buttonLabel={items.length ? 'Add SVGs' : 'Select SVG files'} hint={items.length ? undefined : 'Logos, icons, charts, diagrams. Several files become several pages.'} onFiles={add} />
      {error && <ErrorBox>{error}</ErrorBox>}
      {items.length > 0 && (
        <>
          <ul class="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {items.map((it, i) => (
              <li key={it.id} class="relative rounded-control border border-line bg-white p-2 text-center dark:border-white/10 dark:bg-night-2">
                <div class="grid aspect-square place-items-center overflow-hidden rounded bg-[conic-gradient(#f3f4f6_25%,#fff_0_50%,#f3f4f6_0_75%,#fff_0)] bg-[length:16px_16px]"><img src={it.url} alt="" class="max-h-full max-w-full" /></div>
                <p class="mt-1 truncate text-xs font-semibold">{i + 1}. {it.file.name}</p>
                <button type="button" class="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-gray-600 shadow hover:text-danger dark:bg-night-3" aria-label={`Remove ${it.file.name}`} onClick={() => { URL.revokeObjectURL(it.url); setItems((c) => c.filter((x) => x.id !== it.id)); }}>✕</button>
              </li>
            ))}
          </ul>
          <OptionChips<'svg' | 'a4' | 'letter'> label="Page size" value={page} onChange={(v) => v && setPage(v)} options={[{ value: 'svg', label: 'Same as SVG' }, { value: 'a4', label: 'A4 (fit)' }, { value: 'letter', label: 'Letter (fit)' }]} />
          {phase === 'working' ? <ProgressBar label="Converting…" value={null} />
            : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Convert {items.length} SVG{items.length === 1 ? '' : 's'} to PDF</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
