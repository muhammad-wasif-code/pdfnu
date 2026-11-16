import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { EditFont } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';

type Kind = 'text' | 'rect' | 'image';
interface Base { id: string; kind: Kind; page: number; x: number; y: number; }
interface TextItem extends Base { kind: 'text'; text: string; size: number; color: string; font: EditFont; bold: boolean; }
interface RectItem extends Base { kind: 'rect'; w: number; h: number; color: string; opacity: number; }
interface ImageItem extends Base { kind: 'image'; w: number; h: number; url: string; blob: Blob; aspect: number; }
type Item = TextItem | RectItem | ImageItem;

const CSS_FONT: Record<EditFont, string> = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};
const COLORS = ['#111827', '#ffffff', '#dc2626', '#2563eb', '#16a34a', '#facc15'];
let seq = 0;

/** Width of the longest line in points (canvas px == pt at this scale). */
function measure(it: TextItem): { w: number; h: number } {
  const c = (measure as any).c || ((measure as any).c = document.createElement('canvas').getContext('2d'));
  c.font = `${it.bold ? 'bold ' : ''}${it.size}px ${CSS_FONT[it.font]}`;
  const lines = it.text.split('\n');
  const w = Math.max(...lines.map((l) => c.measureText(l || ' ').width));
  return { w: w + it.size * 0.1, h: lines.length * it.size * 1.2 };
}

export default function EditPdf() {
  const doc = usePdfDoc(900);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [boxW, setBoxW] = useState(600);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageBox = useRef<HTMLDivElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; start: Item; rw: number; rh: number } | null>(null);

  useEffect(() => {
    setPage(0); setItems([]); setSel(null); setSizes([]);
    if (!doc.bytes) return;
    import('../lib/pdfWorker').then(({ pdfOp }) => pdfOp('pageSizes', [doc.bytes!.slice().buffer])).then(setSizes).catch(() => {});
  }, [doc.bytes]);

  useEffect(() => {
    const el = pageBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.file, phase]);

  const ps = sizes[page] ?? { w: 595, h: 842 };
  const aspect = doc.thumbs[page]?.aspect ?? ps.h / ps.w;
  const pxPerPt = boxW / ps.w;
  const selected = items.find((i) => i.id === sel) ?? null;
  const update = (id: string, patch: Partial<Item>) => setItems((c) => c.map((i) => (i.id === id ? ({ ...i, ...patch } as Item) : i)));

  const add = (it: Item) => { setItems((c) => [...c, it]); setSel(it.id); };
  const addText = () => add({ id: `e${seq++}`, kind: 'text', page, x: 0.1, y: 0.1, text: 'Your text', size: 14, color: '#111827', font: 'helvetica', bold: false });
  const addRect = (highlight: boolean) => add({ id: `e${seq++}`, kind: 'rect', page, x: 0.25, y: 0.3, w: highlight ? 0.4 : 0.3, h: highlight ? 0.03 : 0.08, color: highlight ? '#facc15' : '#ffffff', opacity: highlight ? 0.35 : 1 });
  const addImage = async (f?: File) => {
    if (!f) return;
    try {
      const { decodeImage, draw, toBlob } = await import('../lib/image');
      const d = await decodeImage(f, f.name);
      const s = Math.min(1, 1600 / Math.max(d.width, d.height));
      const c = draw(d, d.width * s, d.height * s, 'stretch', null);
      d.close();
      const blob = await toBlob(c, 'image/png');
      const imgAspect = c.width / c.height;
      c.width = c.height = 0;
      const w = 0.35, h = w / (imgAspect * aspect);
      add({ id: `e${seq++}`, kind: 'image', page, x: 0.3, y: 0.3, w, h: Math.min(h, 0.6), url: URL.createObjectURL(blob), blob, aspect: imgAspect });
    } catch (e) { setError(friendlyError(e).message); }
  };

  const boxOf = (it: Item) => {
    if (it.kind === 'text') { const m = measure(it); return { w: m.w / ps.w, h: m.h / ps.h }; }
    return { w: it.w, h: it.h };
  };

  const down = (e: PointerEvent, it: Item, mode: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation();
    setSel(it.id);
    const r = pageBox.current!.getBoundingClientRect();
    drag.current = { id: it.id, mode, sx: e.clientX, sy: e.clientY, start: it, rw: r.width, rh: r.height };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.rw, dy = (e.clientY - d.sy) / d.rh;
    const s = d.start;
    const b = boxOf(s);
    if (d.mode === 'move') {
      update(d.id, { x: Math.min(Math.max(0, s.x + dx), Math.max(0, 1 - b.w)), y: Math.min(Math.max(0, s.y + dy), Math.max(0, 1 - b.h)) });
      return;
    }
    if (s.kind === 'text') {
      const scale = Math.max(0.2, (b.w + dx) / b.w);
      update(d.id, { size: Math.round(Math.min(144, Math.max(6, s.size * scale)) * 2) / 2 });
    } else if (s.kind === 'image') {
      const w = Math.min(Math.max(0.03, s.w + dx), 1 - s.x);
      update(d.id, { w, h: w / (s.aspect * aspect) });
    } else {
      update(d.id, { w: Math.min(Math.max(0.01, s.w + dx), 1 - s.x), h: Math.min(Math.max(0.005, s.h + dy), 1 - s.y) });
    }
  };
  const up = () => { drag.current = null; };

  const apply = async () => {
    if (!doc.bytes || !items.length) return;
    setPhase('working'); setError(null);
    try {
      const buffers = new Map<Blob, ArrayBuffer>();
      for (const it of items) if (it.kind === 'image' && !buffers.has(it.blob)) buffers.set(it.blob, await it.blob.arrayBuffer());
      const payload = items.map((it) =>
        it.kind === 'text' ? { type: 'text' as const, page: it.page, x: it.x, y: it.y, text: it.text, size: it.size, color: it.color, font: it.font, bold: it.bold }
        : it.kind === 'rect' ? { type: 'rect' as const, page: it.page, x: it.x, y: it.y, w: it.w, h: it.h, color: it.color, opacity: it.opacity }
        : { type: 'image' as const, page: it.page, x: it.x, y: it.y, w: it.w, h: it.h, png: buffers.get(it.blob)! });
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('editPdf', [doc.bytes.slice().buffer, payload]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { items.forEach((i) => i.kind === 'image' && URL.revokeObjectURL(i.url)); doc.clear(); setItems([]); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your edits are saved!" stats={[['Edits', String(items.length)], ['Pages', String(doc.pageCount)], ['Size', formatBytes(out.length)]]}
          highlight="No watermark added, ever."
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'edited PDF' : doc.file.name}`} onReset={reset} resetLabel="Edit another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep editing</button>
        </ResultCard>
      </div>
    );
  }

  const t = doc.thumbs[page];
  const onPage = items.filter((i) => i.page === page);
  const chipCls = (on: boolean) => `min-h-10 rounded-lg border px-3 text-sm font-semibold ${on ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line dark:border-white/10'}`;

  return (
    <div class="card space-y-4 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop the PDF to edit" buttonLabel="Select PDF" hint="Add text, images, highlights and shapes. No watermark." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}

      {doc.file && doc.pageCount > 0 && (
        <>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-primary min-h-11 px-4" onClick={addText}>T Add text</button>
            <button type="button" class="btn-secondary min-h-11 px-3" onClick={() => imgInput.current?.click()}>Image</button>
            <button type="button" class="btn-secondary min-h-11 px-3" onClick={() => addRect(true)}>Highlight</button>
            <button type="button" class="btn-secondary min-h-11 px-3" onClick={() => addRect(false)}>Shape</button>
            <a href="/sign-pdf" class="btn-ghost min-h-11 px-3">Signature →</a>
            <input ref={imgInput} type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { addImage((e.target as HTMLInputElement).files?.[0]); (e.target as HTMLInputElement).value = ''; }} />
          </div>

          <div class="flex items-center justify-between gap-2 text-sm">
            <button type="button" class="btn-ghost min-h-11 px-3" disabled={page === 0} onClick={() => { setPage(page - 1); setSel(null); }}>‹ Prev</button>
            <span class="font-semibold tabular-nums text-ink dark:text-white">Page {page + 1} of {doc.pageCount}</span>
            <button type="button" class="btn-ghost min-h-11 px-3" disabled={page >= doc.pageCount - 1} onClick={() => { setPage(page + 1); setSel(null); }}>Next ›</button>
          </div>

          <div ref={pageBox} class="relative mx-auto w-full max-w-[680px] select-none overflow-hidden rounded-md border border-line bg-white shadow-sm dark:border-white/10"
            style={{ aspectRatio: `1 / ${aspect}` }} onPointerMove={(e) => move(e as unknown as PointerEvent)} onPointerUp={up} onPointerCancel={up} onPointerDown={() => setSel(null)}>
            {t?.url ? <img src={t.url} alt={`Page ${page + 1}`} draggable={false} class="pointer-events-none absolute inset-0 h-full w-full" />
              : <span class="absolute inset-0 grid place-items-center"><span class="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" /></span>}
            {onPage.map((it) => {
              const on = it.id === sel;
              const b = boxOf(it);
              return (
                <div key={it.id} class={`absolute cursor-move ${on ? 'outline outline-2 outline-brand' : 'outline-dashed outline-1 outline-brand/30'}`}
                  style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, touchAction: 'none' }}
                  onPointerDown={(e) => down(e as unknown as PointerEvent, it, 'move')}>
                  {it.kind === 'text' && (
                    <div class="pointer-events-none whitespace-pre" style={{ fontFamily: CSS_FONT[it.font], fontWeight: it.bold ? 700 : 400, fontSize: `${it.size * pxPerPt}px`, lineHeight: 1.2, color: it.color }}>{it.text}</div>
                  )}
                  {it.kind === 'rect' && <div class="pointer-events-none h-full w-full" style={{ background: it.color, opacity: it.opacity }} />}
                  {it.kind === 'image' && <img src={it.url} alt="" draggable={false} class="pointer-events-none h-full w-full" />}
                  {on && (
                    <>
                      <button type="button" class="absolute -right-3 -top-3 grid h-8 w-8 place-items-center rounded-full bg-white text-danger shadow ring-1 ring-black/10 dark:bg-night-3"
                        onPointerDown={(e) => e.stopPropagation()} onClick={() => { setItems((c) => c.filter((x) => x.id !== it.id)); setSel(null); }} aria-label="Remove">
                        <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
                      </button>
                      <span class="absolute -bottom-4 -right-4 grid h-9 w-9 place-items-center" style={{ touchAction: 'none', cursor: 'nwse-resize' }} onPointerDown={(e) => down(e as unknown as PointerEvent, it, 'resize')} aria-hidden="true">
                        <span class="h-4 w-4 rounded-full border-2 border-white bg-brand shadow" />
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <p class="text-center text-xs text-muted dark:text-gray-400">Tap an item to select it · drag to move · drag the blue dot to resize</p>

          {selected && (
            <div class="space-y-3 rounded-control border border-line bg-surface p-3 dark:border-white/10 dark:bg-white/[.03]">
              {selected.kind === 'text' && (
                <>
                  <label class="block"><span class="mb-1 block text-xs font-semibold">Text</span>
                    <textarea rows={2} value={selected.text} onInput={(e) => update(selected.id, { text: (e.target as HTMLTextAreaElement).value })}
                      class="w-full rounded-lg border border-line bg-white p-2 text-[15px] dark:border-white/10 dark:bg-night-2" /></label>
                  <div class="flex flex-wrap items-center gap-2">
                    {(['helvetica', 'times', 'courier'] as EditFont[]).map((f) => (
                      <button key={f} type="button" class={chipCls(selected.font === f)} style={{ fontFamily: CSS_FONT[f] }} onClick={() => update(selected.id, { font: f })}>{f === 'helvetica' ? 'Sans' : f === 'times' ? 'Serif' : 'Mono'}</button>
                    ))}
                    <button type="button" class={chipCls(selected.bold)} onClick={() => update(selected.id, { bold: !selected.bold })}><b>B</b></button>
                    <label class="flex items-center gap-2 text-sm">Size
                      <input type="number" min={6} max={144} value={selected.size} onInput={(e) => update(selected.id, { size: Math.min(144, Math.max(6, Number((e.target as HTMLInputElement).value) || 12)) })}
                        class="h-10 w-20 rounded-lg border border-line bg-white px-2 dark:border-white/10 dark:bg-night-2" /></label>
                  </div>
                  <p class="text-xs text-muted dark:text-gray-400">Text is real and selectable in the PDF. Latin characters only, others show as “?”.</p>
                </>
              )}
              {(selected.kind === 'text' || selected.kind === 'rect') && (
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-xs font-semibold">Colour</span>
                  {COLORS.map((c) => (
                    <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={selected.color === c} onClick={() => update(selected.id, { color: c })}
                      class={`h-9 w-9 rounded-full border-4 ${selected.color === c ? 'border-brand-light' : 'border-white dark:border-night-2'} ring-1 ring-black/15`} style={{ background: c }} />
                  ))}
                </div>
              )}
              {selected.kind === 'rect' && (
                <>
                  <label class="flex items-center gap-3 text-sm">Opacity
                    <input type="range" min={10} max={100} step={5} value={Math.round(selected.opacity * 100)} onInput={(e) => update(selected.id, { opacity: Number((e.target as HTMLInputElement).value) / 100 })} class="h-10 flex-1 accent-brand" />
                    <span class="w-10 tabular-nums">{Math.round(selected.opacity * 100)}%</span></label>
                  {selected.opacity >= 0.95 && (
                    <p class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
                      A shape only <strong>covers</strong> what’s underneath. The original text is still in the file and can be copied. To truly remove content, delete the page with <a class="underline" href="/organize-pdf">Organize PDF</a>.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {phase === 'working' ? <ProgressBar label="Saving your edits…" value={null} /> : (
            <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!items.length} onClick={apply}>
              {items.length ? `Save & download (${items.length} edit${items.length > 1 ? 's' : ''})` : 'Add text, an image or a shape first'}
            </button>
          )}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
