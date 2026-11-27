import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { StickyActions } from '../components/ui/Sticky';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

type R = [number, number, number, number]; // x, y, w, h in the unit square
interface Layout { id: string; n: number; cells: R[]; }
const g = (cols: number, rows: number): R[] => Array.from({ length: cols * rows }, (_, i) => [(i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows]);
const LAYOUTS: Layout[] = [
  { id: '2h', n: 2, cells: g(2, 1) }, { id: '2v', n: 2, cells: g(1, 2) },
  { id: '3a', n: 3, cells: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]] }, { id: '3b', n: 3, cells: [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]] }, { id: '3c', n: 3, cells: g(3, 1) },
  { id: '4a', n: 4, cells: g(2, 2) }, { id: '4b', n: 4, cells: [[0, 0, 1, 0.62], [0, 0.62, 1 / 3, 0.38], [1 / 3, 0.62, 1 / 3, 0.38], [2 / 3, 0.62, 1 / 3, 0.38]] }, { id: '4c', n: 4, cells: [[0, 0, 0.62, 1], [0.62, 0, 0.38, 1 / 3], [0.62, 1 / 3, 0.38, 1 / 3], [0.62, 2 / 3, 0.38, 1 / 3]] },
  { id: '5a', n: 5, cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 1 / 3, 0.5], [1 / 3, 0.5, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]] },
  { id: '6a', n: 6, cells: g(3, 2) }, { id: '6b', n: 6, cells: [[0, 0, 2 / 3, 2 / 3], [2 / 3, 0, 1 / 3, 1 / 3], [2 / 3, 1 / 3, 1 / 3, 1 / 3], [0, 2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 1 / 3, 1 / 3], [2 / 3, 2 / 3, 1 / 3, 1 / 3]] },
  { id: '8a', n: 8, cells: g(4, 2) }, { id: '9a', n: 9, cells: g(3, 3) }, { id: '12a', n: 12, cells: g(4, 3) }, { id: '16a', n: 16, cells: g(4, 4) },
];
const RATIOS = { '1:1': 1, '4:5': 4 / 5, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16, 'A4': 1 / 1.414 } as const;
type Ratio = keyof typeof RATIOS;
interface Photo { id: number; file: File; img: HTMLCanvasElement; fx: number; fy: number; }
let seq = 0;

function render(photos: Photo[], lay: Layout, ratio: number, W: number, gap: number, radius: number, bg: string): HTMLCanvasElement {
  const H = Math.round(W / ratio);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  const gp = gap * W;
  lay.cells.forEach(([x, y, w, h], i) => {
    const p = photos[i];
    // equal gaps between photos and around the edge
    const cx = gp / 2 + x * (W - gp) + gp / 2, cy = gp / 2 + y * (H - gp) + gp / 2;
    const rw = Math.max(1, w * (W - gp) - gp), ch = Math.max(1, h * (H - gp) - gp);
    ctx.save();
    ctx.beginPath();
    const r = Math.min(radius * W, rw / 2, ch / 2);
    if ((ctx as any).roundRect) (ctx as any).roundRect(cx, cy, rw, ch, r); else ctx.rect(cx, cy, rw, ch);
    ctx.clip();
    if (p) {
      const s = Math.max(rw / p.img.width, ch / p.img.height);
      const dw = p.img.width * s, dh = p.img.height * s;
      ctx.drawImage(p.img, cx + (rw - dw) * p.fx, cy + (ch - dh) * p.fy, dw, dh);
    } else { ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(cx, cy, rw, ch); }
    ctx.restore();
  });
  return c;
}

export default function CollageMaker() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [layoutId, setLayoutId] = useState('4a');
  const [ratio, setRatio] = useState<Ratio>('1:1');
  const [gap, setGap] = useState(0.015);
  const [radius, setRadius] = useState(0);
  const [bg, setBg] = useState('#ffffff');
  const [size, setSize] = useState<'1080' | '2048' | '4096'>('2048');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pan = useRef<{ i: number; sx: number; sy: number; fx: number; fy: number } | null>(null);

  const add = async (files: File[]) => {
    setError(null);
    try {
      const [{ decodeImage }, { scaled }] = await Promise.all([import('../lib/image'), import('../lib/imageOps')]);
      const fresh: Photo[] = [];
      for (const f of files.filter((x) => /^image\//.test(x.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(x.name))) {
        const d = await decodeImage(f, f.name);
        fresh.push({ id: seq++, file: f, img: scaled(d, 2400), fx: 0.5, fy: 0.5 });
        d.close();
      }
      setPhotos((p) => {
        const all = [...p, ...fresh];
        const fit = LAYOUTS.find((l) => l.n === all.length) ?? LAYOUTS.filter((l) => l.n >= all.length)[0] ?? LAYOUTS[LAYOUTS.length - 1];
        setLayoutId(fit.id);
        return all;
      });
    } catch (e) { setError(friendlyError(e).message); }
  };
  const lay = LAYOUTS.find((l) => l.id === layoutId)!;

  useEffect(() => {
    const el = stage.current;
    if (!el || !photos.length) return;
    const c = render(photos, lay, RATIOS[ratio], 900, gap, radius, bg);
    c.style.cssText = 'display:block;max-width:100%;max-height:65vh;margin:auto;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.15);touch-action:none;cursor:grab';
    el.replaceChildren(c);
  }, [photos, layoutId, ratio, gap, radius, bg]);

  const cellAt = (e: PointerEvent) => {
    const c = stage.current?.querySelector('canvas'); if (!c) return -1;
    const r = c.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    return lay.cells.findIndex(([cx, cy, cw, ch]) => x >= cx && x < cx + cw && y >= cy && y < cy + ch);
  };
  const down = (e: PointerEvent) => { const i = cellAt(e); if (i < 0 || !photos[i]) return; e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); pan.current = { i, sx: e.clientX, sy: e.clientY, fx: photos[i].fx, fy: photos[i].fy }; };
  const move = (e: PointerEvent) => {
    const p = pan.current; if (!p) return;
    const c = stage.current!.querySelector('canvas')!; const r = c.getBoundingClientRect();
    const dx = (e.clientX - p.sx) / r.width, dy = (e.clientY - p.sy) / r.height;
    setPhotos((ph) => ph.map((x, i) => (i === p.i ? { ...x, fx: Math.min(1, Math.max(0, p.fx - dx * 3)), fy: Math.min(1, Math.max(0, p.fy - dy * 3)) } : x)));
  };
  const up = () => { pan.current = null; };

  const save = async () => {
    setPhase('working'); setError(null);
    try {
      const { toBlob } = await import('../lib/image');
      const c = render(photos, lay, RATIOS[ratio], +size, gap, radius, bg);
      setOut(await toBlob(c, 'image/jpeg', 0.92)); c.width = c.height = 0;
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setPhotos([]); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your collage is ready!" stats={[['Photos', String(Math.min(photos.length, lay.n))], ['Size', `${size}×${Math.round(+size / RATIOS[ratio])}`], ['File', formatBytes(out.size)]]}
          onDownload={() => downloadBlob(out, 'collage.jpg', 'image/jpeg')} downloadLabel="Download collage" onReset={reset} resetLabel="Make another collage">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep editing</button>
        </ResultCard>
      </div>
    );
  }

  const swatch = (c: string) => <button key={c} type="button" aria-label={`Background ${c}`} aria-pressed={bg === c} onClick={() => setBg(c)} class={`h-8 w-8 rounded-full border-[3px] ring-1 ring-black/20 ${bg === c ? 'border-brand' : 'border-white dark:border-night-3'}`} style={{ background: c }} />;
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <Dropzone accept="image/*" multiple compact={photos.length > 0} title={photos.length ? 'Add more photos' : 'Drag & drop 2 to 16 photos'} buttonLabel={photos.length ? 'Add photos' : 'Select photos'} onFiles={add} />
      {error && <ErrorBox>{error}</ErrorBox>}
      {photos.length > 0 && (
        <>
          <ul class="flex gap-2 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <li key={p.id} class="relative shrink-0">
                <img src={p.img.toDataURL('image/jpeg', 0.4)} alt="" class={`h-14 w-14 rounded-lg object-cover ${i >= lay.n ? 'opacity-40' : ''}`} />
                <span class="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] font-bold text-white">{i + 1}</span>
                <div class="mt-0.5 flex justify-center gap-0.5">
                  <button type="button" class="h-6 w-6 rounded text-xs" aria-label="Move left" disabled={i === 0} onClick={() => setPhotos((ph) => { const n = ph.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>←</button>
                  <button type="button" class="h-6 w-6 rounded text-xs text-danger" aria-label="Remove" onClick={() => setPhotos((ph) => ph.filter((x) => x.id !== p.id))}>✕</button>
                </div>
              </li>
            ))}
          </ul>
          <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <div ref={stage} onPointerDown={(e) => down(e as unknown as PointerEvent)} onPointerMove={(e) => move(e as unknown as PointerEvent)} onPointerUp={up} onPointerCancel={up} />
              <p class="mt-2 text-center text-xs text-muted dark:text-gray-400">Drag inside a photo to choose which part shows. Use ← to change the order.</p>
            </div>
            <div class="space-y-4">
              <fieldset>
                <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Layout</legend>
                <div class="grid grid-cols-5 gap-1.5">
                  {LAYOUTS.map((l) => (
                    <button key={l.id} type="button" aria-label={`${l.n} photos`} aria-pressed={layoutId === l.id} onClick={() => setLayoutId(l.id)} class={`relative aspect-square rounded-md border-2 bg-white p-0.5 dark:bg-night-3 ${layoutId === l.id ? 'border-brand' : 'border-line dark:border-white/10'}`}>
                      <span class="relative block h-full w-full">{l.cells.map(([x, y, w, h], i) => <span key={i} class="absolute bg-gray-300 dark:bg-white/30" style={{ left: `${x * 100 + 3}%`, top: `${y * 100 + 3}%`, width: `${w * 100 - 6}%`, height: `${h * 100 - 6}%` }} />)}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <OptionChips<Ratio> label="Shape" value={ratio} onChange={(v) => v && setRatio(v)} options={(Object.keys(RATIOS) as Ratio[]).map((r) => ({ value: r, label: r }))} />
              <label class="flex items-center gap-2 text-sm font-semibold">Spacing <input type="range" min={0} max={50} value={Math.round(gap * 1000)} onInput={(e) => setGap(+(e.target as HTMLInputElement).value / 1000)} class="h-9 min-w-0 flex-1 accent-brand" /></label>
              <label class="flex items-center gap-2 text-sm font-semibold">Corners <input type="range" min={0} max={60} value={Math.round(radius * 1000)} onInput={(e) => setRadius(+(e.target as HTMLInputElement).value / 1000)} class="h-9 min-w-0 flex-1 accent-brand" /></label>
              <div class="flex flex-wrap items-center gap-1.5"><span class="text-sm font-semibold">Background</span>{['#ffffff', '#111827', '#f5f0e6', '#fde68a', '#bfdbfe'].map(swatch)}<input type="color" value={bg} aria-label="Custom background" onInput={(e) => setBg((e.target as HTMLInputElement).value)} class="h-8 w-10 cursor-pointer rounded border border-line" /></div>
              <OptionChips<'1080' | '2048' | '4096'> label="Width (pixels)" value={size} onChange={(v) => v && setSize(v)} options={[{ value: '1080', label: '1080' }, { value: '2048', label: '2048' }, { value: '4096', label: '4096' }]} />
            </div>
          </div>
          {photos.length > lay.n && <p class="text-sm text-amber-800 dark:text-amber-200">This layout has {lay.n} spaces; {photos.length - lay.n} photo{photos.length - lay.n === 1 ? ' is' : 's are'} not used. Pick a layout with more spaces.</p>}
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Making collage…" value={null} /> : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={save}>Save collage</button>}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
