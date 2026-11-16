import { useEffect, useRef, useState } from 'preact/hooks';
import fontUrl from '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff2?url';

export interface SignatureImage { blob: Blob; url: string; aspect: number; }
type Tab = 'draw' | 'type' | 'upload';
const COLORS = [{ v: '#111827', n: 'Black' }, { v: '#1d4ed8', n: 'Blue' }, { v: '#b91c1c', n: 'Red' }];

let fontReady: Promise<void> | null = null;
function loadFont() {
  if (!fontReady) fontReady = new FontFace('PDFSherpaSign', `url(${fontUrl})`).load().then((f) => { (document.fonts as any).add(f); });
  return fontReady;
}

/** Crop a canvas to its non-transparent pixels (+ padding) and export PNG. */
async function trimToPng(c: HTMLCanvasElement): Promise<SignatureImage | null> {
  const ctx = c.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = Math.round(Math.max(width, height) * 0.01) + 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
  if (!blob) return null;
  return { blob, url: URL.createObjectURL(blob), aspect: out.width / out.height };
}

interface Props { onDone: (s: SignatureImage) => void; onClose: () => void; title?: string; }

export default function SignaturePad({ onDone, onClose, title = 'Create your signature' }: Props) {
  const [tab, setTab] = useState<Tab>('draw');
  const [color, setColor] = useState(COLORS[0].v);
  const [name, setName] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const [upload, setUpload] = useState<HTMLCanvasElement | null>(null);
  const [cleanBg, setCleanBg] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<{ x: number; y: number }[][]>([]);
  const drawing = useRef(false);
  const preview = useRef<HTMLCanvasElement>(null);

  // size the drawing canvas to its CSS box × devicePixelRatio
  useEffect(() => {
    if (tab !== 'draw') return;
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(3, devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    redraw();
  }, [tab]);

  const redraw = () => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2.5, c.width / 180);
    for (const s of strokes.current) {
      if (!s.length) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x * c.width, s[0].y * c.height);
      for (let i = 1; i < s.length - 1; i++) {
        const mx = (s[i].x + s[i + 1].x) / 2, my = (s[i].y + s[i + 1].y) / 2;
        ctx.quadraticCurveTo(s[i].x * c.width, s[i].y * c.height, mx * c.width, my * c.height);
      }
      const last = s[s.length - 1];
      ctx.lineTo(last.x * c.width, last.y * c.height);
      ctx.stroke();
    }
  };
  useEffect(redraw, [color]);

  const pos = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const pDown = (e: PointerEvent) => { e.preventDefault(); canvas.current!.setPointerCapture(e.pointerId); drawing.current = true; strokes.current.push([pos(e)]); setHasInk(true); redraw(); };
  const pMove = (e: PointerEvent) => { if (!drawing.current) return; strokes.current[strokes.current.length - 1].push(pos(e)); redraw(); };
  const pUp = () => { drawing.current = false; };

  // type preview
  useEffect(() => {
    if (tab !== 'type') return;
    loadFont().then(() => {
      const c = preview.current;
      if (!c) return;
      c.width = 900; c.height = 240;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let size = 130;
      ctx.font = `${size}px PDFSherpaSign`;
      while (ctx.measureText(name || ' ').width > c.width * 0.92 && size > 30) { size -= 6; ctx.font = `${size}px PDFSherpaSign`; }
      ctx.fillText(name, c.width / 2, c.height / 2);
    }).catch(() => setErr('Couldn’t load the signature font. Try Draw instead.'));
  }, [tab, name, color]);

  const pickUpload = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    try {
      const { decodeImage, draw } = await import('../../lib/image');
      const d = await decodeImage(f, f.name);
      const s = Math.min(1, 1600 / Math.max(d.width, d.height));
      setUpload(draw(d, d.width * s, d.height * s, 'stretch', null));
      d.close();
    } catch { setErr('Couldn’t open that image. Use a JPG or PNG.'); }
  };

  const finish = async () => {
    setErr(null);
    let src: HTMLCanvasElement | null = null;
    if (tab === 'draw') src = canvas.current;
    else if (tab === 'type') src = preview.current;
    else if (upload) {
      src = document.createElement('canvas');
      src.width = upload.width; src.height = upload.height;
      const ctx = src.getContext('2d')!;
      ctx.drawImage(upload, 0, 0);
      if (cleanBg) {
        // make light paper transparent: alpha follows darkness, keeps ink colour
        const img = ctx.getImageData(0, 0, src.width, src.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const a = lum > 200 ? 0 : lum < 120 ? 255 : Math.round(((200 - lum) / 80) * 255);
          d[i + 3] = Math.min(d[i + 3], a);
        }
        ctx.putImageData(img, 0, 0);
      }
    }
    if (!src) return;
    const out = await trimToPng(src);
    if (!out) { setErr(tab === 'type' ? 'Type your name first.' : tab === 'draw' ? 'Draw your signature first.' : 'Nothing visible was found in that image.'); return; }
    onDone(out);
  };

  const tabBtn = (t: Tab, label: string) => (
    <button type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
      class={`min-h-11 flex-1 rounded-lg text-sm font-semibold ${tab === t ? 'bg-white text-brand shadow-sm dark:bg-night-3 dark:text-brand-light' : 'text-gray-600 dark:text-gray-300'}`}>{label}</button>
  );

  return (
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="w-full max-w-lg rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5 dark:bg-night-2">
        <div class="mb-3 flex items-center justify-between">
          <p class="font-semibold text-ink dark:text-white">{title}</p>
          <button type="button" class="grid h-11 w-11 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </div>
        <div class="mb-3 flex gap-1 rounded-control bg-surface p-1 dark:bg-white/5" role="tablist">
          {tabBtn('draw', 'Draw')}{tabBtn('type', 'Type')}{tabBtn('upload', 'Upload')}
        </div>

        {tab !== 'upload' && (
          <div class="mb-3 flex items-center gap-2">
            {COLORS.map((c) => (
              <button key={c.v} type="button" aria-label={c.n} aria-pressed={color === c.v} onClick={() => setColor(c.v)}
                class={`h-9 w-9 rounded-full border-4 ${color === c.v ? 'border-brand-light' : 'border-white dark:border-night-2'} ring-1 ring-black/10`} style={{ background: c.v }} />
            ))}
          </div>
        )}

        {tab === 'draw' && (
          <div>
            <canvas ref={canvas} class="h-44 w-full rounded-control border border-dashed border-line bg-white dark:border-white/20" style={{ touchAction: 'none' }}
              onPointerDown={(e) => pDown(e as unknown as PointerEvent)} onPointerMove={(e) => pMove(e as unknown as PointerEvent)} onPointerUp={pUp} onPointerCancel={pUp} aria-label="Signature drawing area" />
            <div class="mt-2 flex justify-between text-sm">
              <span class="text-muted dark:text-gray-400">Sign with your finger or mouse</span>
              <span class="flex gap-3">
                <button type="button" class="min-h-9 font-semibold text-brand disabled:opacity-40 dark:text-brand-light" disabled={!hasInk} onClick={() => { strokes.current.pop(); setHasInk(strokes.current.length > 0); redraw(); }}>Undo</button>
                <button type="button" class="min-h-9 font-semibold text-brand disabled:opacity-40 dark:text-brand-light" disabled={!hasInk} onClick={() => { strokes.current = []; setHasInk(false); redraw(); }}>Clear</button>
              </span>
            </div>
          </div>
        )}

        {tab === 'type' && (
          <div class="space-y-3">
            <input type="text" maxLength={40} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Type your name"
              class="h-12 w-full rounded-control border border-line bg-white px-4 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 dark:border-white/10 dark:bg-night-3" aria-label="Your name" />
            <canvas ref={preview} class="h-28 w-full rounded-control border border-dashed border-line bg-white dark:border-white/20" aria-hidden="true" />
          </div>
        )}

        {tab === 'upload' && (
          <div class="space-y-3">
            <label class="btn-secondary min-h-12 w-full cursor-pointer">
              {upload ? 'Choose a different image' : 'Choose a photo of your signature'}
              <input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" onChange={(e) => pickUpload((e.target as HTMLInputElement).files?.[0])} />
            </label>
            {upload && <img src={upload.toDataURL('image/png')} alt="" class="mx-auto max-h-32 rounded border border-line bg-white dark:border-white/10" />}
            <label class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={cleanBg} onChange={(e) => setCleanBg((e.target as HTMLInputElement).checked)} /> Remove white paper background</label>
          </div>
        )}

        {err && <p class="mt-2 text-sm text-danger" role="alert">{err}</p>}
        <button type="button" class="btn-primary mt-4 min-h-12 w-full text-[15px]" onClick={finish}>Use this signature</button>
      </div>
    </div>
  );
}
