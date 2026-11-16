import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import SortableGrid from '../components/ui/SortableGrid';
import PageThumb from '../components/ui/PageThumb';
import OptionChips from '../components/ui/OptionChips';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt, KB } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { IMAGE_ACCEPT, isImage } from '../lib/image';
import type { ImagesToPdfOpts } from '../lib/pdfOps';
import { StickyActions } from '../components/ui/Sticky';

interface Item { id: string; file: File; url: string; }
type Size = ImagesToPdfOpts['pageSize'];
type Orient = ImagesToPdfOpts['orientation'];
type Margin = '0' | '18' | '36';
type Limit = 'none' | '100' | '200' | '500' | '1024';

let seq = 0;

export default function JpgToPdf() {
  const [items, setItems] = useState<Item[]>([]);
  const [size, setSize] = useState<Size>('a4');
  const [orient, setOrient] = useState<Orient>('auto');
  const [margin, setMargin] = useState<Margin>('18');
  const [limit, setLimit] = useState<Limit>('none');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 as number | null });
  const [result, setResult] = useState<{ bytes: Uint8Array; missed: boolean; target: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('limit');
    if (t && ['100', '200', '500', '1024'].includes(t)) setLimit(t as Limit);
  }, []);

  const add = (files: File[]) => {
    setError(null);
    const ok = files.filter(isImage);
    if (ok.length < files.length) setError(`${files.length - ok.length} file(s) skipped. Only JPG, PNG and WebP images are supported.`);
    setItems((cur) => [...cur, ...ok.map((file) => ({ id: `i${seq++}`, file, url: URL.createObjectURL(file) }))]);
  };

  const run = async () => {
    setPhase('working');
    setError(null);
    try {
      const { decodeImage, draw, toBlob, encodeUnder } = await import('../lib/image');
      const { pdfOp } = await import('../lib/pdfWorker');
      const target = limit === 'none' ? null : Number(limit) * KB;
      const pages: { data: ArrayBuffer; type: 'jpg' | 'png'; width: number; height: number }[] = [];
      // Size budget per image ∝ pixel count (after the overhead of the PDF itself)
      const decoded = [] as Awaited<ReturnType<typeof decodeImage>>[];
      let missed = false;
      for (let i = 0; i < items.length; i++) {
        setProgress({ label: `Reading image ${i + 1} of ${items.length}…`, value: i / items.length });
        decoded.push(await decodeImage(items[i].file, items[i].file.name));
      }
      const totalPx = decoded.reduce((s, d) => s + d.width * d.height, 0);
      const budget = target ? Math.max(4 * KB * items.length, target - 1500 - 400 * items.length) : 0;
      for (let i = 0; i < decoded.length; i++) {
        const d = decoded[i];
        const f = items[i].file;
        setProgress({ label: `Converting image ${i + 1} of ${items.length}…`, value: i / items.length });
        if (target) {
          const share = Math.floor((budget * d.width * d.height) / totalPx);
          const enc = await encodeUnder(d, share, 'image/jpeg', { maxW: 2480, maxH: 2480 });
          missed ||= enc.missed;
          pages.push({ data: await enc.blob.arrayBuffer(), type: 'jpg', width: enc.width, height: enc.height });
        } else if (/png$/i.test(f.type)) {
          // keep PNG (lossless, transparency) — re-encode via canvas to normalise exotic PNG variants
          const c = draw(d, d.width, d.height, 'stretch', null);
          pages.push({ data: await (await toBlob(c, 'image/png')).arrayBuffer(), type: 'png', width: d.width, height: d.height });
          c.width = c.height = 0;
        } else {
          // JPEG/WebP: re-encode at high quality so EXIF rotation is applied and WebP becomes embeddable
          const c = draw(d, d.width, d.height);
          pages.push({ data: await (await toBlob(c, 'image/jpeg', 0.92)).arrayBuffer(), type: 'jpg', width: d.width, height: d.height });
          c.width = c.height = 0;
        }
        d.close();
      }
      setProgress({ label: 'Building PDF…', value: null });
      const out = await pdfOp('imagesToPdf', [pages, { pageSize: size, orientation: orient, margin: Number(margin) }], pages.map((p) => p.data));
      setResult({ bytes: out, target, missed: missed || (target !== null && out.length > target) });
      setPhase('done');
    } catch (e) {
      setError(friendlyError(e).message);
      setPhase('edit');
    }
  };

  const reset = () => { items.forEach((i) => URL.revokeObjectURL(i.url)); setItems([]); setResult(null); setPhase('edit'); };
  const name = items[0] ? `${stripExt(items[0].file.name)}.pdf` : 'images.pdf';

  if (phase === 'done' && result) {
    const lim = result.target;
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard
          title="Your PDF is ready!"
          stats={[['Images', String(items.length)], ['Pages', String(items.length)], ['Size', formatBytes(result.bytes.length)]]}
          highlight={lim && !result.missed ? `Under ${formatBytes(lim)} ✓` : undefined}
          warnings={result.missed && lim ? [`Couldn’t get under ${formatBytes(lim)} with readable images. This is the smallest readable version. Try fewer pages or crop the photos.`] : []}
          onDownload={() => downloadBlob(result.bytes, name)}
          downloadLabel={`Download ${name.length > 30 ? 'PDF' : name}`}
          onReset={reset}
          resetLabel="Convert more images"
        >
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change options</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <Dropzone
        accept={IMAGE_ACCEPT}
        multiple
        compact={items.length > 0}
        title={items.length ? 'Add more images' : 'Drag & drop your images here'}
        buttonLabel={items.length ? 'Add images' : 'Select images'}
        hint={items.length ? undefined : 'JPG, PNG or WebP · each image becomes one page'}
        onFiles={add}
      />
      {error && <ErrorBox>{error}</ErrorBox>}

      {items.length > 0 && (
        <SortableGrid
          class="grid-cols-3 sm:grid-cols-4 md:grid-cols-5"
          items={items}
          getKey={(i) => i.id}
          onReorder={setItems}
          label={(i) => i.file.name}
          render={(it, idx) => (
            <PageThumb url={it.url} caption={it.file.name} badge={idx >= 0 ? idx + 1 : undefined}>
              {idx >= 0 && (
                <button type="button" class="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-gray-600 shadow hover:text-danger dark:bg-night-3 dark:text-gray-300" onClick={() => { URL.revokeObjectURL(it.url); setItems((c) => c.filter((x) => x.id !== it.id)); }} aria-label={`Remove ${it.file.name}`}>
                  <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
                </button>
              )}
            </PageThumb>
          )}
        />
      )}

      <div class={`grid gap-4 sm:grid-cols-2 ${phase === 'working' ? 'pointer-events-none opacity-60' : ''}`}>
        <OptionChips label="Page size" options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: 'Fit image' }]} value={size} onChange={(v) => v && setSize(v)} />
        <OptionChips label="Margins" options={[{ value: '0', label: 'None' }, { value: '18', label: 'Small' }, { value: '36', label: 'Large' }]} value={margin} onChange={(v) => v && setMargin(v)} />
        {size !== 'fit' && <OptionChips label="Orientation" options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} value={orient} onChange={(v) => v && setOrient(v)} />}
        <OptionChips label="Keep PDF under (optional)" options={[{ value: '100', label: '100KB' }, { value: '200', label: '200KB' }, { value: '500', label: '500KB' }, { value: '1024', label: '1MB' }]} value={limit === 'none' ? null : limit} onChange={(v) => setLimit(v ?? 'none')} clearable />
      </div>

      {phase === 'working' && <ProgressBar label={progress.label} value={progress.value} detail="Processing on your device…" />}

      <StickyActions>
        {items.length > 0 && phase !== 'working' && (
          <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>
            Convert {items.length} image{items.length > 1 ? 's' : ''} to PDF
          </button>
        )}
      </StickyActions>
      <PrivacyNote />
    </div>
  );
}
