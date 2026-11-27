import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

type Shape = 'circle' | 'rounded' | 'square';

function render(img: HTMLCanvasElement, size: number, zoom: number, cx: number, cy: number, shape: Shape, ring: number, ringColor: string, bg: string | null) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const path = () => {
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    else if (shape === 'rounded') { const r = size * 0.22; if ((ctx as any).roundRect) (ctx as any).roundRect(0, 0, size, size, r); else ctx.rect(0, 0, size, size); }
    else ctx.rect(0, 0, size, size);
  };
  ctx.save(); path(); ctx.clip();
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
  // the visible square: side = shorter image side / zoom, centred on (cx, cy)
  const side = Math.min(img.width, img.height) / zoom;
  const sx = Math.min(Math.max(0, cx * img.width - side / 2), img.width - side), sy = Math.min(Math.max(0, cy * img.height - side / 2), img.height - side);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  ctx.restore();
  if (ring > 0) { const w = (ring / 100) * size; ctx.lineWidth = w; ctx.strokeStyle = ringColor; ctx.save(); ctx.translate(w / 2, w / 2); ctx.scale((size - w) / size, (size - w) / size); path(); ctx.restore(); ctx.stroke(); }
  return c;
}

export default function CircleCrop() {
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [shape, setShape] = useState<Shape>('circle');
  const [ring, setRing] = useState(0);
  const [ringColor, setRingColor] = useState('#ffffff');
  const [size, setSize] = useState<'400' | '800' | '1080' | '2000'>('1080');
  const [out, setOut] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);

  const open = async (files: File[]) => {
    setError(null);
    try {
      const [{ decodeImage }, { scaled }] = await Promise.all([import('../lib/image'), import('../lib/imageOps')]);
      const d = await decodeImage(files[0], files[0].name); setImg(scaled(d, 4000)); d.close(); setFile(files[0]); setZoom(1); setPos({ x: 0.5, y: 0.5 }); setOut(null);
    } catch (e) { setError(friendlyError(e).message); }
  };
  useEffect(() => {
    if (!img || !stage.current) return;
    const c = render(img, 420, zoom, pos.x, pos.y, shape, ring, ringColor, null);
    c.style.cssText = 'width:100%;max-width:420px;height:auto;display:block;margin:auto;touch-action:none;cursor:grab';
    stage.current.replaceChildren(c);
  }, [img, zoom, pos, shape, ring, ringColor]);

  const down = (e: PointerEvent) => { e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y }; };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d || !img || !stage.current) return;
    const w = stage.current.getBoundingClientRect().width;
    const side = Math.min(img.width, img.height) / zoom;
    setPos({ x: Math.min(1, Math.max(0, d.x - ((e.clientX - d.sx) / w) * side / img.width)), y: Math.min(1, Math.max(0, d.y - ((e.clientY - d.sy) / w) * side / img.height)) });
  };
  const up = () => { drag.current = null; };
  const save = async () => {
    if (!img) return;
    const c = render(img, +size, zoom, pos.x, pos.y, shape, ring, ringColor, null);
    c.toBlob((b) => b && setOut(b), 'image/png');
  };
  const reset = () => { setFile(null); setImg(null); setOut(null); };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="image/*" title="Drag & drop your photo here" buttonLabel="Select photo" hint="Make a round profile picture with a transparent background." onFiles={open} />
        : <FileRow name={file.name} size={`${img?.width}×${img?.height} · ${formatBytes(file.size)}`} kind="IMG" onRemove={reset} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {img && !out && (
        <div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <div ref={stage} class="rounded-control p-3" style={{ background: 'repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/16px 16px' }} onPointerDown={(e) => down(e as unknown as PointerEvent)} onPointerMove={(e) => move(e as unknown as PointerEvent)} onPointerUp={up} onPointerCancel={up} />
            <p class="mt-2 text-center text-xs text-muted dark:text-gray-400">Drag the photo to centre the face.</p>
          </div>
          <div class="space-y-4">
            <label class="block text-sm font-semibold">Zoom<input type="range" min={1} max={5} step={0.02} value={zoom} onInput={(e) => setZoom(+(e.target as HTMLInputElement).value)} class="mt-1 h-9 w-full accent-brand" /></label>
            <OptionChips<Shape> label="Shape" value={shape} onChange={(v) => v && setShape(v)} options={[{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }]} />
            <label class="block text-sm font-semibold">Border {ring ? `${ring}%` : 'off'}<input type="range" min={0} max={12} value={ring} onInput={(e) => setRing(+(e.target as HTMLInputElement).value)} class="mt-1 h-9 w-full accent-brand" /></label>
            {ring > 0 && <label class="flex items-center gap-2 text-sm">Border colour <input type="color" value={ringColor} onInput={(e) => setRingColor((e.target as HTMLInputElement).value)} class="h-9 w-12 cursor-pointer rounded border border-line" /></label>}
            <OptionChips<typeof size> label="Size (pixels)" value={size} onChange={(v) => v && setSize(v)} options={[{ value: '400', label: '400' }, { value: '800', label: '800' }, { value: '1080', label: '1080' }, { value: '2000', label: '2000' }]} />
            <button type="button" class="btn-primary min-h-12 w-full" onClick={save}>Crop</button>
          </div>
        </div>
      )}
      {out && file && (
        <ResultCard title="Your picture is ready!" stats={[['Shape', shape], ['Size', `${size}×${size}`], ['PNG', formatBytes(out.size)]]} highlight="Transparent background outside the shape (PNG)."
          onDownload={() => downloadBlob(out, `${stripExt(file.name)}-${shape}.png`, 'image/png')} downloadLabel="Download PNG" onReset={reset} resetLabel="Use another photo">
          <img src={URL.createObjectURL(out)} alt="Result" class="mx-auto mt-3 h-40 w-40" />
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setOut(null)}>← Adjust</button>
        </ResultCard>
      )}
      <PrivacyNote />
    </div>
  );
}
