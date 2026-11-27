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

interface Frame { id: number; name: string; img: HTMLCanvasElement; thumb: string; }
let seq = 0;
type Fit = 'contain' | 'cover';

/** Frames drawn at the GIF size (first image’s shape unless a shape is chosen). */
function frameData(f: HTMLCanvasElement, w: number, h: number, fit: Fit, bg: string | null): Uint8ClampedArray {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  const s = fit === 'cover' ? Math.max(w / f.width, h / f.height) : Math.min(w / f.width, h / f.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(f, (w - f.width * s) / 2, (h - f.height * s) / 2, f.width * s, f.height * s);
  return ctx.getImageData(0, 0, w, h).data;
}

export default function GifMaker() {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [delay, setDelay] = useState(500);
  const [width, setWidth] = useState<'320' | '480' | '640' | '800'>('480');
  const [fit, setFit] = useState<Fit>('contain');
  const [loop, setLoop] = useState(true);
  const [bounce, setBounce] = useState(false);
  const [dither, setDither] = useState(true);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState<{ blob: Blob; url: string; w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const preview = useRef<HTMLCanvasElement>(null);

  const add = async (files: File[]) => {
    setError(null);
    try {
      const [{ decodeImage }, { scaled }] = await Promise.all([import('../lib/image'), import('../lib/imageOps')]);
      const fresh: Frame[] = [];
      for (const f of files.filter((x) => /^image\//.test(x.type) || /\.(jpe?g|png|webp|bmp|avif)$/i.test(x.name))) {
        const d = await decodeImage(f, f.name);
        const img = scaled(d, 1000); d.close();
        fresh.push({ id: seq++, name: f.name, img, thumb: scaled(img, 120).toDataURL('image/jpeg', 0.6) });
      }
      setFrames((c) => [...c, ...fresh].slice(0, 300));
    } catch (e) { setError(friendlyError(e).message); }
  };

  const seqFrames = bounce && frames.length > 2 ? [...frames, ...frames.slice(1, -1).reverse()] : frames;
  const W = +width, H = frames[0] ? Math.max(1, Math.round((W * frames[0].img.height) / frames[0].img.width)) : W;

  // live animation preview
  useEffect(() => {
    if (!seqFrames.length) return;
    const t = setInterval(() => setTick((x) => x + 1), Math.max(20, delay));
    return () => clearInterval(t);
  }, [seqFrames.length, delay]);
  useEffect(() => {
    const c = preview.current;
    const f = seqFrames[tick % Math.max(1, seqFrames.length)];
    if (!c || !f) return;
    const pw = Math.min(W, 420), ph = Math.round((pw * H) / W);
    c.width = pw; c.height = ph;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pw, ph);
    const s = fit === 'cover' ? Math.max(pw / f.img.width, ph / f.img.height) : Math.min(pw / f.img.width, ph / f.img.height);
    ctx.drawImage(f.img, (pw - f.img.width * s) / 2, (ph - f.img.height * s) / 2, f.img.width * s, f.img.height * s);
  }, [tick, frames, fit, width, bounce]);

  const make = async () => {
    if (frames.length < 2) return;
    setPhase('working'); setError(null); setProgress(0);
    try {
      const { encodeGif } = await import('../lib/gif');
      const data = seqFrames.map((f) => ({ data: frameData(f.img, W, H, fit, '#ffffff'), delay }));
      setProgress(0.3);
      await new Promise((r) => setTimeout(r, 30));
      const gif = encodeGif(data, W, H, { loop: loop ? 0 : 1, dither, transparent: false });
      const blob = new Blob([gif as BlobPart], { type: 'image/gif' });
      if (out) URL.revokeObjectURL(out.url);
      setOut({ blob, url: URL.createObjectURL(blob), w: W, h: H });
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { if (out) URL.revokeObjectURL(out.url); setFrames([]); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your GIF is ready!" stats={[['Frames', String(seqFrames.length)], ['Size', `${out.w}×${out.h}`], ['File', formatBytes(out.blob.size)]]}
          onDownload={() => downloadBlob(out.blob, 'animation.gif', 'image/gif')} downloadLabel="Download GIF" onReset={reset} resetLabel="Make another GIF">
          <img src={out.url} alt="Your animated GIF" class="mx-auto mt-3 max-h-80 rounded-md border border-line" />
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change settings</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <Dropzone accept="image/*" multiple compact={frames.length > 0} title={frames.length ? 'Add more frames' : 'Drag & drop your pictures here'} buttonLabel={frames.length ? 'Add pictures' : 'Select pictures'} hint={frames.length ? undefined : 'Each picture becomes one frame of the animation.'} onFiles={add} />
      {error && <ErrorBox>{error}</ErrorBox>}
      {frames.length > 0 && (
        <>
          <ul class="flex gap-2 overflow-x-auto pb-1">
            {frames.map((f, i) => (
              <li key={f.id} class="shrink-0 text-center">
                <img src={f.thumb} alt="" class="h-14 w-14 rounded-lg object-cover" />
                <div class="flex justify-center gap-0.5">
                  <button type="button" class="h-6 w-6 text-xs" aria-label="Move earlier" disabled={i === 0} onClick={() => setFrames((fr) => { const n = fr.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>←</button>
                  <button type="button" class="h-6 w-6 text-xs text-danger" aria-label="Remove frame" onClick={() => setFrames((fr) => fr.filter((x) => x.id !== f.id))}>✕</button>
                </div>
              </li>
            ))}
          </ul>
          <div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_280px]">
            <div class="grid place-items-center rounded-control bg-surface p-3 dark:bg-white/5"><canvas ref={preview} class="max-w-full rounded shadow-sm" /></div>
            <div class="space-y-4">
              <label class="block text-sm font-semibold">Speed: {(delay / 1000).toFixed(2)} s per frame ({(1000 / delay).toFixed(1)} fps)
                <input type="range" min={40} max={2000} step={20} value={delay} onInput={(e) => setDelay(+(e.target as HTMLInputElement).value)} class="mt-1 h-9 w-full accent-brand" />
              </label>
              <OptionChips<typeof width> label="Width (pixels)" value={width} onChange={(v) => v && setWidth(v)} options={[{ value: '320', label: '320' }, { value: '480', label: '480' }, { value: '640', label: '640' }, { value: '800', label: '800' }]} />
              <OptionChips<Fit> label="Different-sized pictures" value={fit} onChange={(v) => v && setFit(v)} options={[{ value: 'contain', label: 'Fit (bars)' }, { value: 'cover', label: 'Fill (crop)' }]} />
              <label class="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={loop} onChange={(e) => setLoop((e.target as HTMLInputElement).checked)} />Loop forever</label>
              <label class="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={bounce} onChange={(e) => setBounce((e.target as HTMLInputElement).checked)} />Boomerang (play forward, then back)</label>
              <label class="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={dither} onChange={(e) => setDither((e.target as HTMLInputElement).checked)} />Smooth colours (dithering, best for photos)</label>
            </div>
          </div>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Encoding GIF…" value={progress || null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={frames.length < 2} onClick={make}>{frames.length < 2 ? 'Add at least 2 pictures' : `Make GIF (${seqFrames.length} frames)`}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
