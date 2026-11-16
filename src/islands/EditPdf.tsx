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
import { StickyToolbar, StickyActions } from '../components/ui/Sticky';

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
  const textBox = useRef<HTMLTextAreaElement>(null);
  const wantFocus = useRef(false);
  const focusText = () => { wantFocus.current = true; setTimeout(() => { const ta = textBox.current; if (ta && wantFocus.current) { wantFocus.current = false; ta.focus({ preventScroll: true }); ta.select(); } }, 30); };
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
  const addText = () => {
    // place new text in the part of the page that's currently visible
    const r = pageBox.current?.getBoundingClientRect();
    let y = 0.1;
    const bar = pageBox.current?.parentElement?.querySelector('.sticky')?.getBoundingClientRect();
    const visibleTop = bar ? bar.bottom + 210 : 300; // below the toolbar once the text editor row opens
    if (r && r.top < visibleTop) y = Math.min(0.85, Math.max(0.05, (visibleTop - r.top) / r.height));
    add({ id: `e${seq++}`, kind: 'text', page, x: 0.08, y, text: 'Your text', size: 14, color: '#111827', font: 'helvetica', bold: false });
    focusText();
  };
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
  const chipCls = (on: boolean) => `grid h-10 min-w-10 place-items-center rounded-lg border px-2 text-sm font-semibold ${on ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-white dark:border-white/10 dark:bg-night-3'}`;
  const iconBtn = 'grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-white text-gray-700 hover:border-brand dark:border-white/10 dark:bg-night-3 dark:text-gray-200';
  const tool = (label: string, icon: string, onClick: () => void, primary = false) => (
    <button type="button" onClick={onClick}
      class={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-semibold sm:flex-none sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm ${primary ? 'bg-brand text-white' : 'border border-line bg-white text-gray-800 dark:border-white/10 dark:bg-night-3 dark:text-gray-100'}`}>
      <span aria-hidden="true" class="text-base leading-none">{icon}</span>{label}
    </button>
  );

  return (
    <div class="card space-y-4 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop the PDF to edit" buttonLabel="Select PDF" hint="Add text, images, highlights and shapes. No watermark." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}

      {doc.file && doc.pageCount > 0 && (
        <>
          <StickyToolbar>
            {/* Row 1: add tools + page navigation */}
            <div class="flex items-stretch gap-1.5">
              {tool('Text', 'T', addText, true)}
              {tool('Image', '🖼', () => imgInput.current?.click())}
              {tool('Highlight', '▬', () => addRect(true))}
              {tool('Shape', '■', () => addRect(false))}
              <input ref={imgInput} type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { addImage((e.target as HTMLInputElement).files?.[0]); (e.target as HTMLInputElement).value = ''; }} />
            </div>

            {/* Row 2: editor for the selected item — always on screen */}
            {selected?.kind === 'text' && (
              <div class="space-y-2">
                <textarea ref={textBox} rows={1} value={selected.text} placeholder="Type your text…" aria-label="Text"
                  onInput={(e) => { const ta = e.target as HTMLTextAreaElement; ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`; update(selected.id, { text: ta.value }); }}
                  class="block w-full resize-none rounded-lg border-2 border-brand bg-white px-3 py-2 text-[16px] leading-6 outline-none dark:bg-night-3" />
                <div class="flex flex-wrap items-center gap-1.5">
                  <button type="button" class={iconBtn} onClick={() => update(selected.id, { size: Math.max(6, selected.size - 2) })} aria-label="Smaller text">A−</button>
                  <span class="w-10 text-center text-xs font-semibold tabular-nums">{selected.size}pt</span>
                  <button type="button" class={iconBtn} onClick={() => update(selected.id, { size: Math.min(144, selected.size + 2) })} aria-label="Bigger text">A+</button>
                  <button type="button" class={chipCls(selected.bold)} onClick={() => update(selected.id, { bold: !selected.bold })} aria-pressed={selected.bold} aria-label="Bold"><b>B</b></button>
                  <select value={selected.font} onChange={(e) => update(selected.id, { font: (e.target as HTMLSelectElement).value as EditFont })} aria-label="Font"
                    class="h-10 rounded-lg border border-line bg-white px-2 text-sm dark:border-white/10 dark:bg-night-3">
                    <option value="helvetica">Sans</option><option value="times">Serif</option><option value="courier">Mono</option>
                  </select>
                  {COLORS.filter((c) => c !== '#ffffff' && c !== '#facc15').map((c) => (
                    <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={selected.color === c} onClick={() => update(selected.id, { color: c })}
                      class={`h-8 w-8 shrink-0 rounded-full border-[3px] ${selected.color === c ? 'border-brand-light' : 'border-white dark:border-night-3'} ring-1 ring-black/15`} style={{ background: c }} />
                  ))}
                  <button type="button" class={`${iconBtn} ml-auto text-danger`} onClick={() => { setItems((c) => c.filter((x) => x.id !== selected.id)); setSel(null); }} aria-label="Delete text">🗑</button>
                </div>
              </div>
            )}
            {selected?.kind === 'rect' && (
              <div class="space-y-2">
                <div class="flex flex-wrap items-center gap-1.5">
                  {COLORS.map((c) => (
                    <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={selected.color === c} onClick={() => update(selected.id, { color: c })}
                      class={`h-8 w-8 shrink-0 rounded-full border-[3px] ${selected.color === c ? 'border-brand-light' : 'border-white dark:border-night-3'} ring-1 ring-black/15`} style={{ background: c }} />
                  ))}
                  <label class="flex flex-1 items-center gap-2 text-xs font-semibold">Opacity
                    <input type="range" min={10} max={100} step={5} value={Math.round(selected.opacity * 100)} onInput={(e) => update(selected.id, { opacity: Number((e.target as HTMLInputElement).value) / 100 })} class="h-9 min-w-0 flex-1 accent-brand" />
                  </label>
                  <button type="button" class={`${iconBtn} text-danger`} onClick={() => { setItems((c) => c.filter((x) => x.id !== selected.id)); setSel(null); }} aria-label="Delete shape">🗑</button>
                </div>
                {selected.opacity >= 0.95 && (
                  <p class="text-xs text-amber-800 dark:text-amber-200">A shape only <strong>covers</strong> content. The text underneath is still in the file. To remove it for real, <a class="underline" href="/delete-pdf-pages">delete the page</a>.</p>
                )}
              </div>
            )}
            {selected?.kind === 'image' && (
              <div class="flex items-center gap-2 text-sm">
                <span class="text-muted dark:text-gray-400">Drag to move · blue dot to resize</span>
                <button type="button" class={`${iconBtn} ml-auto text-danger`} onClick={() => { setItems((c) => c.filter((x) => x.id !== selected.id)); setSel(null); }} aria-label="Delete image">🗑</button>
              </div>
            )}
            {(!selected || doc.pageCount > 1) && (
              <div class="flex items-center gap-2">
                {!selected && <p class="min-w-0 flex-1 text-xs text-muted dark:text-gray-400">{items.length ? 'Tap an item on the page to edit it.' : 'Tap Text, then type. It appears on the page.'}</p>}
                {doc.pageCount > 1 && (
                  <div class="ml-auto flex shrink-0 items-center gap-1">
                    <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3" disabled={page === 0} onClick={() => { setPage(page - 1); setSel(null); }} aria-label="Previous page">‹</button>
                    <span class="px-1 text-xs font-semibold tabular-nums text-ink dark:text-white">Page {page + 1}/{doc.pageCount}</span>
                    <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3" disabled={page >= doc.pageCount - 1} onClick={() => { setPage(page + 1); setSel(null); }} aria-label="Next page">›</button>
                  </div>
                )}
              </div>
            )}
          </StickyToolbar>

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
                  onPointerDown={(e) => down(e as unknown as PointerEvent, it, 'move')}
                  onDblClick={() => { if (it.kind === 'text') focusText(); }}>
                  {it.kind === 'text' && (
                    <div class="pointer-events-none whitespace-pre" style={{ fontFamily: CSS_FONT[it.font], fontWeight: it.bold ? 700 : 400, fontSize: `${it.size * pxPerPt}px`, lineHeight: 1.2, color: it.color }}>{it.text || ' '}</div>
                  )}
                  {it.kind === 'rect' && <div class="pointer-events-none h-full w-full" style={{ background: it.color, opacity: it.opacity }} />}
                  {it.kind === 'image' && <img src={it.url} alt="" draggable={false} class="pointer-events-none h-full w-full" />}
                  {on && (
                    <span class="absolute -bottom-4 -right-4 grid h-9 w-9 place-items-center" style={{ touchAction: 'none', cursor: 'nwse-resize' }} onPointerDown={(e) => down(e as unknown as PointerEvent, it, 'resize')} aria-hidden="true">
                      <span class="h-4 w-4 rounded-full border-2 border-white bg-brand shadow" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Saving your edits…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!items.length} onClick={apply}>
                {items.length ? `Save & download (${items.length} edit${items.length > 1 ? 's' : ''})` : 'Add text, an image or a shape first'}
              </button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
