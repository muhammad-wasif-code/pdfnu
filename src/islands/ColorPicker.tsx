import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
function hsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}
function cmyk(r: number, g: number, b: number) {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return 'cmyk(0%, 0%, 0%, 100%)';
  const f = (v: number) => Math.round(((1 - v / 255 - k) / (1 - k)) * 100);
  return `cmyk(${f(r)}%, ${f(g)}%, ${f(b)}%, ${Math.round(k * 100)}%)`;
}

export default function ColorPicker() {
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  const [picked, setPicked] = useState<[number, number, number] | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; c: [number, number, number] } | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const lens = useRef<HTMLCanvasElement>(null);

  const open = async (files: File[]) => {
    setError(null);
    try {
      const [{ decodeImage }, { scaled }] = await Promise.all([import('../lib/image'), import('../lib/imageOps')]);
      const d = await decodeImage(files[0], files[0].name); const c = scaled(d, 1400); d.close();
      setImg(c); setFile(files[0]); setPicked(null);
      const { palette: pal } = await import('../lib/gif');
      const small = scaled(c, 200);
      const p = pal([small.getContext('2d')!.getImageData(0, 0, small.width, small.height).data], 8);
      const list: string[] = []; for (let i = 0; i < p.length; i += 3) list.push(hex(p[i], p[i + 1], p[i + 2]));
      setPalette([...new Set(list)]);
    } catch (e) { setError(friendlyError(e).message); }
  };
  useEffect(() => { const c = cv.current; if (!c || !img) return; c.width = img.width; c.height = img.height; c.getContext('2d')!.drawImage(img, 0, 0); }, [img]);

  const sample = (e: PointerEvent) => {
    const c = cv.current!; const r = c.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * c.width), y = Math.floor(((e.clientY - r.top) / r.height) * c.height);
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return null;
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, 1, 1).data;
    return { x, y, c: [d[0], d[1], d[2]] as [number, number, number], rx: e.clientX - r.left, ry: e.clientY - r.top };
  };
  const onMove = (e: PointerEvent) => {
    const s = sample(e); if (!s) return; setHover(s);
    const l = lens.current; if (!l) return;
    const ctx = l.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 110, 110); ctx.drawImage(cv.current!, s.x - 5, s.y - 5, 11, 11, 0, 0, 110, 110);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(50, 50, 10, 10); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(49, 49, 12, 12);
  };
  const onPick = (e: PointerEvent) => { const s = sample(e); if (s) { setPicked(s.c); setSaved((v) => [hex(...s.c), ...v.filter((x) => x !== hex(...s.c))].slice(0, 12)); } };
  const copy = (t: string) => { navigator.clipboard?.writeText(t); setCopied(t); setTimeout(() => setCopied(''), 1200); };
  const eyedrop = async () => { try { const r = await new (window as any).EyeDropper().open(); const n = parseInt(r.sRGBHex.slice(1), 16); setPicked([n >> 16, (n >> 8) & 255, n & 255]); } catch { /* cancelled */ } };
  const row = (label: string, v: string) => (
    <button type="button" onClick={() => copy(v)} class="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left font-mono text-sm hover:border-brand dark:border-white/10">
      <span><span class="mr-2 font-sans text-xs font-semibold text-muted">{label}</span>{v}</span><span class="font-sans text-xs font-semibold text-brand">{copied === v ? 'Copied' : 'Copy'}</span>
    </button>
  );
  const c = picked ?? hover?.c ?? null;
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="image/*" title="Drag & drop an image or screenshot" buttonLabel="Select image" hint="Then tap anywhere to get its colour code." onFiles={open} />
        : <FileRow name={file.name} size={`${img?.width}×${img?.height} · ${formatBytes(file.size)}`} kind="IMG" onRemove={() => { setFile(null); setImg(null); }} />}
      {'EyeDropper' in globalThis && <button type="button" class="btn-secondary min-h-11 px-4 text-sm" onClick={eyedrop}>🎯 Pick a colour from anywhere on your screen</button>}
      {error && <ErrorBox>{error}</ErrorBox>}
      {img && (
        <div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
          <div class="relative">
            <canvas ref={cv} class="block max-h-[65vh] max-w-full cursor-crosshair rounded-md" style={{ touchAction: 'none' }} onPointerMove={(e) => onMove(e as unknown as PointerEvent)} onPointerDown={(e) => { onMove(e as unknown as PointerEvent); onPick(e as unknown as PointerEvent); }} onPointerLeave={() => setHover(null)} />
            {hover && <canvas ref={lens} width={110} height={110} class="pointer-events-none absolute rounded-full border-2 border-white shadow-lg" style={{ left: `${(hover as any).rx + 16}px`, top: `${(hover as any).ry - 126}px` }} />}
          </div>
          <div class="space-y-3">
            <div class="h-20 rounded-control border border-line dark:border-white/10" style={{ background: c ? hex(...c) : 'transparent' }} />
            {c ? <>{row('HEX', hex(...c))}{row('RGB', `rgb(${c.join(', ')})`)}{row('HSL', hsl(...c))}{row('CMYK', cmyk(...c))}</> : <p class="text-sm text-muted">Move over the picture and tap a colour.</p>}
            {palette.length > 0 && <div><p class="mb-1 text-sm font-semibold">Main colours in this image</p><div class="flex flex-wrap gap-1.5">{palette.map((p) => <button key={p} type="button" title={p} aria-label={`Copy ${p}`} onClick={() => { const n = parseInt(p.slice(1), 16); setPicked([n >> 16, (n >> 8) & 255, n & 255]); copy(p); }} class="h-9 w-9 rounded-md ring-1 ring-black/15" style={{ background: p }} />)}</div></div>}
            {saved.length > 0 && <div><p class="mb-1 text-sm font-semibold">Picked</p><div class="flex flex-wrap gap-1.5">{saved.map((p) => <button key={p} type="button" title={p} aria-label={`Copy ${p}`} onClick={() => copy(p)} class="h-7 w-7 rounded ring-1 ring-black/15" style={{ background: p }} />)}</div></div>}
          </div>
        </div>
      )}
      <PrivacyNote />
    </div>
  );
}
