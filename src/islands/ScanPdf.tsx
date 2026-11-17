import { useEffect, useRef, useState } from 'preact/hooks';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import Cropper from '../components/ui/Cropper';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { StickyActions } from '../components/ui/Sticky';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { Rect } from '../lib/image';
import type { ScanFilter } from '../lib/scan';

interface Shot { id: number; file: File; turns: number; crop: Rect | null; thumb?: string; }
type Size = 'a4' | 'letter' | 'fit';
let seq = 0;

const FILTERS: { value: ScanFilter; label: string }[] = [
  { value: 'bw', label: 'Document' },
  { value: 'gray', label: 'Gray' },
  { value: 'auto', label: 'Colour' },
  { value: 'original', label: 'Original' },
];

export default function ScanPdf() {
  const [shots, setShots] = useState<Shot[]>([]);
  const [filter, setFilter] = useState<ScanFilter>('bw');
  const [size, setSize] = useState<Size>('a4');
  const [editing, setEditing] = useState<{ id: number; url: string; w: number; h: number; rect: Rect } | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const urls = useRef(new Map<number, string>());

  // (re)build thumbnails whenever a page or the filter changes
  useEffect(() => {
    let stop = false;
    (async () => {
      const { prepare, enhance, toJpeg } = await import('../lib/scan');
      for (const s of shots) {
        if (stop) return;
        const key = `${s.turns}|${JSON.stringify(s.crop)}|${filter}`;
        if ((s as any).key === key && s.thumb) continue;
        try {
          const c = enhance(await prepare(s.file, s.turns, s.crop, 420), filter);
          const url = URL.createObjectURL(await toJpeg(c, 0.8));
          c.width = c.height = 0;
          if (stop) { URL.revokeObjectURL(url); return; }
          const old = urls.current.get(s.id);
          if (old) URL.revokeObjectURL(old);
          urls.current.set(s.id, url);
          setShots((cur) => cur.map((x) => (x.id === s.id ? Object.assign({ ...x, thumb: url }, { key }) : x)));
        } catch (e) { setError(friendlyError(e).message); }
      }
    })();
    return () => { stop = true; };
  }, [shots.map((s) => `${s.id}:${s.turns}:${JSON.stringify(s.crop)}`).join(), filter]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const imgs = [...list].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!imgs.length) { setError('Please choose photos (JPG, PNG or WebP).'); return; }
    setShots((c) => [...c, ...imgs.map((file) => ({ id: seq++, file, turns: 0, crop: null }))]);
  };
  const patch = (id: number, p: Partial<Shot>) => setShots((c) => c.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const remove = (id: number) => { const u = urls.current.get(id); if (u) URL.revokeObjectURL(u); urls.current.delete(id); setShots((c) => c.filter((s) => s.id !== id)); if (editing?.id === id) closeCrop(); };
  const moveBy = (i: number, d: number) => setShots((c) => { const n = c.slice(); const j = i + d; if (j < 0 || j >= n.length) return c; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const openCrop = async (s: Shot) => {
    const { prepare, toJpeg } = await import('../lib/scan');
    const c = await prepare(s.file, s.turns, null, 1000);
    const url = URL.createObjectURL(await toJpeg(c, 0.85));
    const w = c.width, h = c.height;
    c.width = c.height = 0;
    const r = s.crop ? { x: s.crop.x * w, y: s.crop.y * h, w: s.crop.w * w, h: s.crop.h * h } : { x: w * 0.04, y: h * 0.04, w: w * 0.92, h: h * 0.92 };
    if (editing) URL.revokeObjectURL(editing.url);
    setEditing({ id: s.id, url, w, h, rect: r });
  };
  const closeCrop = () => { if (editing) URL.revokeObjectURL(editing.url); setEditing(null); };
  const saveCrop = () => {
    if (!editing) return;
    const { w, h, rect } = editing;
    patch(editing.id, { crop: { x: rect.x / w, y: rect.y / h, w: rect.w / w, h: rect.h / h } });
    closeCrop();
  };

  const build = async () => {
    if (!shots.length) return;
    setPhase('working'); setError(null);
    try {
      const { prepare, enhance, toJpeg } = await import('../lib/scan');
      const pages = [];
      for (let i = 0; i < shots.length; i++) {
        setProgress({ label: `Cleaning up page ${i + 1} of ${shots.length}…`, value: i / shots.length });
        const s = shots[i];
        const c = enhance(await prepare(s.file, s.turns, s.crop, 2000), filter);
        const blob = await toJpeg(c, filter === 'bw' ? 0.8 : 0.85);
        pages.push({ data: await blob.arrayBuffer(), type: 'jpg' as const, width: c.width, height: c.height });
        c.width = c.height = 0;
      }
      setProgress({ label: 'Making your PDF…', value: 0.95 });
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('imagesToPdf', [pages, { pageSize: size, orientation: 'auto', margin: 0 }], pages.map((p) => p.data)));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current.clear(); setShots([]); setOut(null); setPhase('edit'); };
  const name = () => `scan-${new Date().toISOString().slice(0, 10)}.pdf`;

  if (phase === 'done' && out) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your scan is ready!" stats={[['Pages', String(shots.length)], ['Look', FILTERS.find((f) => f.value === filter)!.label], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, name())} downloadLabel="Download PDF" onReset={reset} resetLabel="Scan something else">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Add or fix pages</button>
        </ResultCard>
      </div>
    );
  }

  const iconBtn = 'grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-sm dark:border-white/10 dark:bg-night-3';

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <input ref={camera} type="file" accept="image/*" capture="environment" class="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { add((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
      <input ref={gallery} type="file" accept="image/*" multiple class="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { add((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />

      <div class={`grid gap-3 ${shots.length ? 'grid-cols-2' : 'sm:grid-cols-2'}`}>
        <button type="button" class={`btn-primary flex-col gap-1 ${shots.length ? 'min-h-12' : 'min-h-28 text-base'}`} onClick={() => camera.current?.click()}>
          <span aria-hidden="true" class={shots.length ? '' : 'text-2xl'}>📷</span>{shots.length ? 'Add page' : 'Take a photo'}
        </button>
        <button type="button" class={`btn-secondary flex-col gap-1 ${shots.length ? 'min-h-12' : 'min-h-28 text-base'}`} onClick={() => gallery.current?.click()}>
          <span aria-hidden="true" class={shots.length ? '' : 'text-2xl'}>🖼️</span>{shots.length ? 'From gallery' : 'Choose photos'}
        </button>
      </div>
      {!shots.length && <p class="text-center text-sm text-muted dark:text-gray-400">Place the paper on a dark surface, fill the frame and avoid shadows. Add as many pages as you need.</p>}
      {error && <ErrorBox onRetry={() => setError(null)}>{error}</ErrorBox>}

      {editing && (
        <div class="space-y-3 rounded-control border border-brand/40 p-3">
          <p class="text-sm font-semibold">Crop page {shots.findIndex((s) => s.id === editing.id) + 1}</p>
          <Cropper src={editing.url} naturalW={editing.w} naturalH={editing.h} aspect={null} value={editing.rect} onChange={(rect) => setEditing({ ...editing, rect })} />
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn-ghost min-h-11" onClick={closeCrop}>Cancel</button>
            <button type="button" class="btn-primary min-h-11" onClick={saveCrop}>Done</button>
          </div>
        </div>
      )}

      {shots.length > 0 && (
        <>
          <OptionChips<ScanFilter> label="Look" value={filter} onChange={(v) => v && setFilter(v)} options={FILTERS} />
          <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shots.map((s, i) => (
              <li key={s.id} class="space-y-2 rounded-control border border-line p-2 dark:border-white/10">
                <div class="relative grid aspect-[3/4] place-items-center overflow-hidden rounded bg-surface dark:bg-white/5">
                  {s.thumb ? <img src={s.thumb} alt={`Page ${i + 1}`} class="max-h-full max-w-full object-contain shadow-sm" />
                    : <span class="h-6 w-6 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />}
                  <span class="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs font-semibold text-white">{i + 1}</span>
                </div>
                <div class="flex flex-wrap justify-center gap-1">
                  <button type="button" class={iconBtn} onClick={() => patch(s.id, { turns: (s.turns + 1) % 4, crop: null })} aria-label={`Rotate page ${i + 1}`}>↻</button>
                  <button type="button" class={iconBtn} onClick={() => openCrop(s)} aria-label={`Crop page ${i + 1}`}>✂</button>
                  <button type="button" class={iconBtn} disabled={i === 0} onClick={() => moveBy(i, -1)} aria-label={`Move page ${i + 1} earlier`}>←</button>
                  <button type="button" class={iconBtn} disabled={i === shots.length - 1} onClick={() => moveBy(i, 1)} aria-label={`Move page ${i + 1} later`}>→</button>
                  <button type="button" class={`${iconBtn} text-danger`} onClick={() => remove(s.id)} aria-label={`Remove page ${i + 1}`}>✕</button>
                </div>
              </li>
            ))}
          </ul>
          <OptionChips<Size> label="Page size" value={size} onChange={(v) => v && setSize(v)}
            options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: 'Same as photo' }]} />
          <StickyActions>
            {phase === 'working' ? <ProgressBar label={progress.label} value={progress.value} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={build}>Create PDF ({shots.length} page{shots.length > 1 ? 's' : ''})</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
