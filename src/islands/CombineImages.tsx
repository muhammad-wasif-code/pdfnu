import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { StickyActions } from '../components/ui/Sticky';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { IMAGE_ACCEPT, isImage } from '../lib/image';

type Layout = 'horizontal' | 'vertical' | 'grid';
type Gap = '0' | '10' | '30';
type Bg = '#ffffff' | '#000000' | 'transparent';
type Fmt = 'image/jpeg' | 'image/png';
interface Item { id: number; file: File; url: string; }
let seq = 0;
const MAX_SIDE = 8000; // keep canvases within mobile browser limits

/** Lay images out and return the canvas. Images keep their aspect; each row/column is matched in height/width. */
async function compose(files: File[], layout: Layout, gap: number, bg: Bg): Promise<HTMLCanvasElement> {
  const { decodeImage } = await import('../lib/image');
  const imgs = [];
  for (const f of files) imgs.push(await decodeImage(f, f.name));
  try {
    const cols = layout === 'horizontal' ? imgs.length : layout === 'vertical' ? 1 : Math.ceil(Math.sqrt(imgs.length));
    const rows = Math.ceil(imgs.length / cols);
    // grid and vertical: common width per column; horizontal: common height
    let cells: { x: number; y: number; w: number; h: number }[] = [];
    let W = 0, H = 0;
    if (layout === 'horizontal') {
      const h = Math.min(...imgs.map((i) => i.height), 2000);
      let x = 0;
      cells = imgs.map((i) => { const w = Math.round((i.width * h) / i.height); const c = { x, y: 0, w, h }; x += w + gap; return c; });
      W = x - gap; H = h;
    } else {
      const cw = Math.min(...imgs.map((i) => i.width), layout === 'grid' ? 1200 : 2000);
      const heights = imgs.map((i) => Math.round((i.height * cw) / i.width));
      const rowH = Array.from({ length: rows }, (_, r) => Math.max(...heights.slice(r * cols, r * cols + cols)));
      let y = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const k = r * cols + c;
          if (k >= imgs.length) break;
          cells.push({ x: c * (cw + gap), y: y + Math.round((rowH[r] - heights[k]) / 2), w: cw, h: heights[k] });
        }
        y += rowH[r] + gap;
      }
      W = cols * cw + (cols - 1) * gap; H = y - gap;
    }
    const s = Math.min(1, MAX_SIDE / Math.max(W, H));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * s); canvas.height = Math.round(H * s);
    const ctx = canvas.getContext('2d')!;
    if (bg !== 'transparent') { ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.imageSmoothingQuality = 'high';
    imgs.forEach((im, k) => { const c = cells[k]; ctx.drawImage(im.source, c.x * s, c.y * s, c.w * s, c.h * s); });
    return canvas;
  } finally { imgs.forEach((i) => i.close()); }
}

export default function CombineImages() {
  const [items, setItems] = useState<Item[]>([]);
  const [layout, setLayout] = useState<Layout>('vertical');
  const [gap, setGap] = useState<Gap>('10');
  const [bg, setBg] = useState<Bg>('#ffffff');
  const [fmt, setFmt] = useState<Fmt>('image/jpeg');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ blob: Blob; url: string; w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<Item[]>([]);
  ref.current = items;
  useEffect(() => () => ref.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const add = (files: File[]) => {
    const ok = files.filter(isImage);
    if (!ok.length) { setError('Choose JPG, PNG or WebP images.'); return; }
    setError(null); setOut(null);
    setItems((c) => [...c, ...ok.map((file) => ({ id: seq++, file, url: URL.createObjectURL(file) }))]);
  };
  const move = (i: number, d: number) => setItems((c) => { const n = c.slice(); const j = i + d; if (j < 0 || j >= n.length) return c; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const remove = (id: number) => setItems((c) => { const it = c.find((x) => x.id === id); if (it) URL.revokeObjectURL(it.url); return c.filter((x) => x.id !== id); });

  const run = async () => {
    if (items.length < 2) return;
    setBusy(true); setError(null);
    try {
      const c = await compose(items.map((i) => i.file), layout, Number(gap), fmt === 'image/jpeg' && bg === 'transparent' ? '#ffffff' : bg);
      const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create image'))), fmt, 0.9));
      if (out) URL.revokeObjectURL(out.url);
      setOut({ blob, url: URL.createObjectURL(blob), w: c.width, h: c.height });
      c.width = c.height = 0;
    } catch (e) { setError(friendlyError(e).message); }
    finally { setBusy(false); }
  };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {items.length === 0
        ? <Dropzone accept={IMAGE_ACCEPT} multiple title="Drag & drop 2 or more photos" buttonLabel="Select images" onFiles={add} />
        : (
          <ul class="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {items.map((it, i) => (
              <li key={it.id} class="space-y-1 rounded-control border border-line p-1.5 dark:border-white/10">
                <div class="relative grid aspect-square place-items-center overflow-hidden rounded bg-surface dark:bg-white/5">
                  <img src={it.url} alt={`Image ${i + 1}`} class="max-h-full max-w-full object-contain" />
                  <span class="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs font-semibold text-white">{i + 1}</span>
                </div>
                <div class="flex justify-center gap-1">
                  <button type="button" class="grid h-8 w-8 place-items-center rounded border border-line text-sm dark:border-white/10" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move image ${i + 1} earlier`}>←</button>
                  <button type="button" class="grid h-8 w-8 place-items-center rounded border border-line text-sm dark:border-white/10" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Move image ${i + 1} later`}>→</button>
                  <button type="button" class="grid h-8 w-8 place-items-center rounded border border-line text-sm text-danger dark:border-white/10" onClick={() => remove(it.id)} aria-label={`Remove image ${i + 1}`}>✕</button>
                </div>
              </li>
            ))}
            <li>
              <label class="grid aspect-square cursor-pointer place-items-center rounded-control border-2 border-dashed border-line text-sm font-semibold text-brand dark:border-white/15 dark:text-brand-light">
                + Add
                <input type="file" accept={IMAGE_ACCEPT} multiple class="sr-only" onChange={(e) => { add([...((e.target as HTMLInputElement).files ?? [])]); (e.target as HTMLInputElement).value = ''; }} />
              </label>
            </li>
          </ul>
        )}
      {error && <ErrorBox onRetry={() => setError(null)}>{error}</ErrorBox>}

      {items.length > 0 && (
        <>
          <OptionChips<Layout> label="Layout" value={layout} onChange={(v) => { if (v) { setLayout(v); setOut(null); } }} variant="cards"
            options={[{ value: 'vertical', label: 'Stacked', sub: 'Top to bottom' }, { value: 'horizontal', label: 'Side by side', sub: 'Left to right' }, { value: 'grid', label: 'Grid', sub: 'Collage' }]} />
          <div class="grid gap-4 sm:grid-cols-3">
            <OptionChips<Gap> label="Spacing" value={gap} onChange={(v) => { if (v) { setGap(v); setOut(null); } }} options={[{ value: '0', label: 'None' }, { value: '10', label: 'Thin' }, { value: '30', label: 'Wide' }]} />
            <OptionChips<Bg> label="Background" value={bg} onChange={(v) => { if (v) { setBg(v); setOut(null); } }} options={[{ value: '#ffffff', label: 'White' }, { value: '#000000', label: 'Black' }, { value: 'transparent', label: 'None' }]} />
            <OptionChips<Fmt> label="Format" value={fmt} onChange={(v) => { if (v) { setFmt(v); setOut(null); } }} options={[{ value: 'image/jpeg', label: 'JPG' }, { value: 'image/png', label: 'PNG' }]} />
          </div>
          {bg === 'transparent' && fmt === 'image/jpeg' && <p class="text-xs text-muted dark:text-gray-400">JPG can’t be transparent, so the background will be white. Choose PNG to keep it see-through.</p>}

          {out && (
            <div class="space-y-3 rounded-control border border-line p-3 dark:border-white/10">
              <img src={out.url} alt="Combined image preview" class="mx-auto max-h-[60vh] w-auto rounded bg-[repeating-conic-gradient(#e5e7eb_0_25%,#fff_0_50%)] bg-[length:16px_16px]" />
              <p class="text-center text-sm text-muted dark:text-gray-400">{out.w}×{out.h} px · {formatBytes(out.blob.size)}</p>
            </div>
          )}

          <StickyActions>
            {busy ? <ProgressBar label="Combining images…" value={null} />
              : out ? (
                <div class="grid grid-cols-2 gap-2">
                  <button type="button" class="btn-secondary min-h-12" onClick={() => { setItems([]); setOut(null); }}>Start over</button>
                  <button type="button" class="btn-primary min-h-12" onClick={() => downloadBlob(out.blob, `combined.${fmt === 'image/png' ? 'png' : 'jpg'}`, fmt)}>Download</button>
                </div>
              ) : (
                <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={items.length < 2} onClick={run}>
                  {items.length < 2 ? 'Add at least 2 images' : `Combine ${items.length} images`}
                </button>
              )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
