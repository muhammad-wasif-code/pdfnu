import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { StickyActions } from '../components/ui/Sticky';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { TextLayer } from '../lib/imageOps';

type L = TextLayer & { id: number };
let seq = 0;
const FONTS = [
  { v: 'Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif', n: 'Impact' },
  { v: 'Arial, Helvetica, sans-serif', n: 'Sans' },
  { v: 'Georgia, "Times New Roman", serif', n: 'Serif' },
  { v: '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive', n: 'Comic' },
  { v: '"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive', n: 'Script' },
  { v: '"Courier New", Courier, monospace', n: 'Mono' },
];
const COLORS = ['#ffffff', '#111827', '#facc15', '#dc2626', '#2563eb', '#16a34a', '#f472b6'];

const memeLayer = (y: number, text: string): L => ({ id: seq++, text, x: 0.5, y, size: 0.085, color: '#ffffff', font: FONTS[0].v, bold: true, italic: false, stroke: 0.14, strokeColor: '#000000', background: null, align: 'center', angle: 0, opacity: 1, upper: true });
const textLayer = (): L => ({ id: seq++, text: 'Your text', x: 0.5, y: 0.5, size: 0.06, color: '#ffffff', font: FONTS[1].v, bold: true, italic: false, stroke: 0.08, strokeColor: '#000000', background: null, align: 'center', angle: 0, opacity: 1, upper: false });

/** Add Text to Image and Meme Generator. */
export default function ImageText({ meme }: { meme: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  const [layers, setLayers] = useState<L[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stage = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; x: number; y: number; w: number; h: number } | null>(null);
  const boxes = useRef(new Map<number, { w: number; h: number }>());
  const [, setBoxTick] = useState(0);

  const open = async (files: File[]) => {
    const f = files[0];
    setError(null);
    try {
      const [{ decodeImage }, { scaled }] = await Promise.all([import('../lib/image'), import('../lib/imageOps')]);
      const d = await decodeImage(f, f.name);
      setImg(scaled(d, 4000)); d.close();
      setFile(f);
      const first = meme ? [memeLayer(0.1, 'TOP TEXT'), memeLayer(0.9, 'BOTTOM TEXT')] : [textLayer()];
      setLayers(first); setSel(first[0].id);
    } catch (e) { setError(friendlyError(e).message); }
  };

  // redraw the stage
  useEffect(() => {
    const c = stage.current;
    if (!c || !img) return;
    const k = Math.min(1, 1100 / Math.max(img.width, img.height));
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    import('../lib/imageOps').then(({ drawText }) => {
      for (const L of layers) if (L.text.trim()) boxes.current.set(L.id, drawText(ctx, L, c.width, c.height));
      setBoxTick((t) => t + 1);
    });
  }, [img, layers]);
  useEffect(() => { if (sel !== null) setTimeout(() => editor.current?.focus({ preventScroll: true }), 60); }, [sel]);

  const upd = (id: number, p: Partial<L>) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const selected = layers.find((l) => l.id === sel) ?? null;
  const hit = (fx: number, fy: number) => [...layers].reverse().find((l) => { const b = boxes.current.get(l.id); return b && Math.abs(fx - l.x) < b.w / 2 + 0.02 && Math.abs(fy - l.y) < b.h / 2 + 0.02; });
  const pos = (e: PointerEvent) => { const r = box.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const down = (e: PointerEvent) => {
    const [fx, fy] = pos(e);
    const l = hit(fx, fy);
    if (!l) { setSel(null); return; }
    e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId);
    setSel(l.id);
    drag.current = { id: l.id, sx: fx, sy: fy, x: l.x, y: l.y, w: 0, h: 0 };
  };
  const move = (e: PointerEvent) => { const d = drag.current; if (!d) return; const [fx, fy] = pos(e); upd(d.id, { x: Math.min(1, Math.max(0, d.x + fx - d.sx)), y: Math.min(1, Math.max(0, d.y + fy - d.sy)) }); };
  const up = () => { drag.current = null; };

  const save = async () => {
    if (!img || !file) return;
    setPhase('working'); setError(null);
    try {
      const [{ withText }, { toBlob }] = await Promise.all([import('../lib/imageOps'), import('../lib/image')]);
      const c = withText(img, layers);
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      setOut(await toBlob(c, type, 0.92)); c.width = c.height = 0;
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setImg(null); setLayers([]); setOut(null); setPhase('edit'); };
  const name = file ? `${stripExt(file.name)}-${meme ? 'meme' : 'text'}.${out?.type === 'image/png' ? 'png' : 'jpg'}` : 'image.jpg';

  if (phase === 'done' && out) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={meme ? 'Your meme is ready!' : 'Text added!'} stats={[['Text boxes', String(layers.filter((l) => l.text.trim()).length)], ['Size', `${img?.width}×${img?.height}`], ['File', formatBytes(out.size)]]}
          onDownload={() => downloadBlob(out, name, out.type)} downloadLabel="Download image" onReset={reset} resetLabel={meme ? 'Make another meme' : 'Use another image'}>
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep editing</button>
        </ResultCard>
      </div>
    );
  }

  const chip = (on: boolean) => `grid h-10 min-w-10 place-items-center rounded-lg border px-2 text-sm font-semibold ${on ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-white dark:border-white/10 dark:bg-night-3'}`;
  return (
    <div class="card space-y-4 p-4 sm:p-6">
      {!file ? <Dropzone accept="image/*" title={meme ? 'Drag & drop your picture here' : 'Drag & drop your image here'} buttonLabel="Select image" hint={meme ? 'Use your own photo, then type the top and bottom text.' : 'JPG, PNG, WebP…'} onFiles={open} />
        : <FileRow name={file.name} size={`${img?.width}×${img?.height} · ${formatBytes(file.size)}`} kind="IMG" onRemove={reset} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {img && (
        <>
          <div class="space-y-2 rounded-control border border-line p-3 dark:border-white/10">
            {selected ? (
              <>
                <textarea ref={editor} rows={2} value={selected.text} aria-label="Text" onInput={(e) => upd(selected.id, { text: (e.target as HTMLTextAreaElement).value })}
                  class="block w-full resize-y rounded-lg border-2 border-brand bg-white px-3 py-2 text-[16px] outline-none dark:bg-night-3" />
                <div class="flex flex-wrap items-center gap-1.5">
                  <select value={selected.font} onChange={(e) => upd(selected.id, { font: (e.target as HTMLSelectElement).value })} aria-label="Font" class="h-10 rounded-lg border border-line bg-white px-2 text-sm dark:border-white/10 dark:bg-night-3">
                    {FONTS.map((f) => <option key={f.n} value={f.v}>{f.n}</option>)}
                  </select>
                  <button type="button" class={chip(false)} aria-label="Smaller" onClick={() => upd(selected.id, { size: Math.max(0.015, selected.size * 0.88) })}>A−</button>
                  <button type="button" class={chip(false)} aria-label="Bigger" onClick={() => upd(selected.id, { size: Math.min(0.4, selected.size * 1.14) })}>A+</button>
                  <button type="button" class={chip(selected.bold)} aria-pressed={selected.bold} onClick={() => upd(selected.id, { bold: !selected.bold })}><b>B</b></button>
                  <button type="button" class={chip(selected.italic)} aria-pressed={selected.italic} onClick={() => upd(selected.id, { italic: !selected.italic })}><i>I</i></button>
                  <button type="button" class={chip(selected.upper)} aria-pressed={selected.upper} onClick={() => upd(selected.id, { upper: !selected.upper })}>AA</button>
                  <button type="button" class={chip(selected.stroke > 0)} aria-pressed={selected.stroke > 0} onClick={() => upd(selected.id, { stroke: selected.stroke > 0 ? 0 : 0.1 })}>Outline</button>
                  <button type="button" class={chip(!!selected.background)} aria-pressed={!!selected.background} onClick={() => upd(selected.id, { background: selected.background ? null : 'rgba(0,0,0,0.55)' })}>Box</button>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                  {COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={selected.color === c} onClick={() => upd(selected.id, { color: c, strokeColor: c === '#111827' ? '#ffffff' : '#000000' })} class={`h-8 w-8 rounded-full border-[3px] ring-1 ring-black/20 ${selected.color === c ? 'border-brand' : 'border-white dark:border-night-3'}`} style={{ background: c }} />)}
                  <input type="color" value={selected.color} aria-label="Custom colour" onInput={(e) => upd(selected.id, { color: (e.target as HTMLInputElement).value })} class="h-8 w-10 cursor-pointer rounded border border-line" />
                  <label class="ml-auto flex items-center gap-1 text-xs font-semibold">Tilt <input type="range" min={-45} max={45} value={selected.angle} onInput={(e) => upd(selected.id, { angle: +(e.target as HTMLInputElement).value })} class="h-8 w-24 accent-brand" /></label>
                  <button type="button" class={`${chip(false)} text-danger`} aria-label="Delete text" onClick={() => { setLayers((ls) => ls.filter((l) => l.id !== selected.id)); setSel(null); }}>🗑</button>
                </div>
              </>
            ) : <p class="text-sm text-muted dark:text-gray-400">Tap a text on the picture to edit it, or add a new one.</p>}
            <button type="button" class="btn-secondary min-h-10 w-full px-3 text-sm" onClick={() => { const l = meme ? memeLayer(0.5, 'MORE TEXT') : textLayer(); setLayers((ls) => [...ls, l]); setSel(l.id); }}>+ Add text</button>
          </div>
          <div ref={box} class="relative mx-auto w-fit max-w-full select-none" style={{ touchAction: 'none' }}
            onPointerDown={(e) => down(e as unknown as PointerEvent)} onPointerMove={(e) => move(e as unknown as PointerEvent)} onPointerUp={up} onPointerCancel={up}>
            <canvas ref={stage} class="block max-h-[70vh] max-w-full rounded-md shadow-sm" style={{ cursor: 'move' }} />
            {selected && boxes.current.get(selected.id) && (
              <span class="pointer-events-none absolute border-2 border-dashed border-brand" style={{ left: `${(selected.x - boxes.current.get(selected.id)!.w / 2) * 100 - 1}%`, top: `${(selected.y - boxes.current.get(selected.id)!.h / 2) * 100 - 1}%`, width: `${boxes.current.get(selected.id)!.w * 100 + 2}%`, height: `${boxes.current.get(selected.id)!.h * 100 + 2}%` }} />
            )}
          </div>
          <p class="text-center text-xs text-muted dark:text-gray-400">Drag text to move it.</p>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Saving…" value={null} /> : <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={save}>{meme ? 'Make meme' : 'Save image'}</button>}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
