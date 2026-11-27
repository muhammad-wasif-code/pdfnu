import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';
import { StickyToolbar, StickyActions } from '../components/ui/Sticky';

type Repeat = 'this' | 'all' | 'odd' | 'even';
interface Placed { jpg: boolean; id: string; page: number; x: number; y: number; w: number; h: number; url: string; blob: Blob; aspect: number; opacity: number; repeat: Repeat; }
let seq = 0;

const SNAP: { label: string; x: (w: number) => number; y: (h: number) => number }[] = [
  { label: '↖', x: () => 0.04, y: () => 0.03 }, { label: '↑', x: (w) => (1 - w) / 2, y: () => 0.03 }, { label: '↗', x: (w) => 0.96 - w, y: () => 0.03 },
  { label: '•', x: (w) => (1 - w) / 2, y: (h) => (1 - h) / 2 },
  { label: '↙', x: () => 0.04, y: (h) => 0.97 - h }, { label: '↓', x: (w) => (1 - w) / 2, y: (h) => 0.97 - h }, { label: '↘', x: (w) => 0.96 - w, y: (h) => 0.97 - h },
];

export default function AddImagePdf() {
  const doc = usePdfDoc(900);
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Placed[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ bytes: Uint8Array; marks: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageBox = useRef<HTMLDivElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; start: Placed; rw: number; rh: number } | null>(null);

  useEffect(() => { setPage(0); setItems([]); setSel(null); }, [doc.file]);
  const aspect = doc.thumbs[page]?.aspect ?? 1.414;
  const selected = items.find((i) => i.id === sel) ?? null;
  const update = (id: string, patch: Partial<Placed>) => setItems((c) => c.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const pagesOf = (it: Placed) => Array.from({ length: doc.pageCount }, (_, i) => i).filter((i) => it.repeat === 'all' || (it.repeat === 'odd' && i % 2 === 0) || (it.repeat === 'even' && i % 2 === 1) || (it.repeat === 'this' && i === it.page));

  const addImages = async (files: File[]) => {
    setError(null);
    const { decodeImage, draw, toBlob } = await import('../lib/image');
    for (const f of files) {
      try {
        const d = await decodeImage(f, f.name);
        const s = Math.min(1, 2000 / Math.max(d.width, d.height));
        const c = draw(d, Math.round(d.width * s), Math.round(d.height * s), 'stretch', null);
        d.close();
        const jpg = /jpe?g/i.test(f.type) || /\.jpe?g$/i.test(f.name);
        const blob = await toBlob(c, jpg ? 'image/jpeg' : 'image/png', 0.92);
        const imgAspect = c.width / c.height;
        c.width = c.height = 0;
        let w = 0.4, h = w / (imgAspect * aspect);
        if (h > 0.5) { h = 0.5; w = h * imgAspect * aspect; }
        const it: Placed = { jpg, id: `i${seq++}`, page, x: (1 - w) / 2, y: (1 - h) / 2, w, h, url: URL.createObjectURL(blob), blob, aspect: imgAspect, opacity: 1, repeat: 'this' };
        setItems((cur) => [...cur, it]); setSel(it.id);
      } catch (e) { setError(friendlyError(e).message); }
    }
  };

  const down = (e: PointerEvent, it: Placed, mode: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation(); setSel(it.id);
    const r = pageBox.current!.getBoundingClientRect();
    drag.current = { id: it.id, mode, sx: e.clientX, sy: e.clientY, start: it, rw: r.width, rh: r.height };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.rw, dy = (e.clientY - d.sy) / d.rh, s = d.start;
    if (d.mode === 'move') update(d.id, { x: Math.min(Math.max(-s.w * 0.5, s.x + dx), 1 - s.w * 0.5), y: Math.min(Math.max(-s.h * 0.5, s.y + dy), 1 - s.h * 0.5) });
    else { const w = Math.max(0.03, Math.min(1.5, s.w + dx)); update(d.id, { w, h: w / (s.aspect * aspect) }); }
  };
  const up = () => { drag.current = null; };

  const run = async () => {
    if (!doc.bytes || !items.length) return;
    setPhase('working'); setError(null);
    try {
      const bufs = new Map<Blob, ArrayBuffer>();
      for (const it of items) if (!bufs.has(it.blob)) bufs.set(it.blob, await it.blob.arrayBuffer());
      const payload = items.map((it) => ({ pages: pagesOf(it), x: it.x, y: it.y, w: it.w, h: it.h, png: bufs.get(it.blob)!, opacity: it.opacity, type: it.jpg ? 'jpg' as const : 'png' as const }));
      const { pdfOp } = await import('../lib/pdfWorker');
      const bytes = await pdfOp('placeImages', [doc.bytes.slice().buffer, payload]);
      setOut({ bytes, marks: payload.reduce((s, p) => s + p.pages.length, 0) });
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { items.forEach((i) => URL.revokeObjectURL(i.url)); doc.clear(); setItems([]); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Image added to your PDF!" stats={[['Images', String(items.length)], ['Placed on', `${out.marks} page${out.marks === 1 ? '' : 's'}`], ['Size', formatBytes(out.bytes.length)]]}
          highlight="Each image is stored once, even when it appears on every page."
          onDownload={() => downloadBlob(out.bytes, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Use another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep editing</button>
        </ResultCard>
      </div>
    );
  }

  const visible = items.filter((it) => pagesOf(it).includes(page));
  const iconBtn = 'grid h-10 min-w-10 shrink-0 place-items-center rounded-lg border border-line bg-white px-2 text-sm dark:border-white/10 dark:bg-night-3';
  return (
    <div class="card space-y-4 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Next, add a logo, photo or signature image." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <>
          <StickyToolbar>
            <div class="flex items-center gap-2">
              <button type="button" class="btn-primary min-h-11 px-4 text-sm" onClick={() => imgInput.current?.click()}>+ Add image</button>
              <input ref={imgInput} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" class="sr-only" tabIndex={-1} aria-hidden="true"
                onChange={(e) => { const l = (e.target as HTMLInputElement).files; if (l) addImages(Array.from(l)); (e.target as HTMLInputElement).value = ''; }} />
              {doc.pageCount > 1 && (
                <div class="ml-auto flex shrink-0 items-center gap-1">
                  <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3" disabled={page === 0} onClick={() => { setPage(page - 1); setSel(null); }} aria-label="Previous page">‹</button>
                  <span class="px-1 text-xs font-semibold tabular-nums">Page {page + 1}/{doc.pageCount}</span>
                  <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3" disabled={page >= doc.pageCount - 1} onClick={() => { setPage(page + 1); setSel(null); }} aria-label="Next page">›</button>
                </div>
              )}
            </div>
            {selected ? (
              <div class="space-y-2">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-xs font-semibold">Show on</span>
                  {([['this', `Page ${selected.page + 1}`], ['all', 'All pages'], ['odd', 'Odd'], ['even', 'Even']] as [Repeat, string][]).map(([v, l]) => (
                    <button key={v} type="button" aria-pressed={selected.repeat === v} onClick={() => update(selected.id, { repeat: v, page: v === 'this' ? page : selected.page })}
                      class={`min-h-9 rounded-lg border px-2.5 text-xs font-semibold ${selected.repeat === v ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-white dark:border-white/10 dark:bg-night-3'}`}>{l}</button>
                  ))}
                  <button type="button" class={`${iconBtn} ml-auto text-danger`} onClick={() => { URL.revokeObjectURL(selected.url); setItems((c) => c.filter((x) => x.id !== selected.id)); setSel(null); }} aria-label="Remove image">🗑</button>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                  {SNAP.map((s) => <button key={s.label} type="button" class={iconBtn} onClick={() => update(selected.id, { x: s.x(selected.w), y: s.y(selected.h) })} aria-label={`Move to ${s.label}`}>{s.label}</button>)}
                  <label class="flex min-w-[10rem] flex-1 items-center gap-2 text-xs font-semibold">Opacity
                    <input type="range" min={10} max={100} step={5} value={Math.round(selected.opacity * 100)} class="h-9 min-w-0 flex-1 accent-brand" onInput={(e) => update(selected.id, { opacity: +(e.target as HTMLInputElement).value / 100 })} />
                  </label>
                </div>
              </div>
            ) : <p class="text-xs text-muted dark:text-gray-400">{items.length ? 'Tap an image to move, resize or repeat it.' : 'Add an image. You can drag it anywhere and resize it.'}</p>}
          </StickyToolbar>

          <div ref={pageBox} class="relative mx-auto w-full max-w-[680px] select-none overflow-hidden rounded-md border border-line bg-white shadow-sm dark:border-white/10"
            style={{ aspectRatio: `1 / ${aspect}` }} onPointerMove={(e) => move(e as unknown as PointerEvent)} onPointerUp={up} onPointerCancel={up} onPointerDown={() => setSel(null)}>
            {doc.thumbs[page]?.url ? <img src={doc.thumbs[page].url} alt={`Page ${page + 1}`} draggable={false} class="pointer-events-none absolute inset-0 h-full w-full" />
              : <span class="absolute inset-0 grid place-items-center"><span class="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" /></span>}
            {visible.map((it) => {
              const on = it.id === sel;
              return (
                <div key={it.id} class={`absolute cursor-move ${on ? 'outline outline-2 outline-brand' : 'outline-dashed outline-1 outline-brand/40'}`}
                  style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, width: `${it.w * 100}%`, height: `${it.h * 100}%`, touchAction: 'none' }}
                  onPointerDown={(e) => down(e as unknown as PointerEvent, it, 'move')}>
                  <img src={it.url} alt="" draggable={false} class="pointer-events-none h-full w-full" style={{ opacity: it.opacity }} />
                  {on && <span class="absolute -bottom-4 -right-4 grid h-9 w-9 place-items-center" style={{ touchAction: 'none', cursor: 'nwse-resize' }} onPointerDown={(e) => down(e as unknown as PointerEvent, it, 'resize')} aria-hidden="true"><span class="h-4 w-4 rounded-full border-2 border-white bg-brand shadow" /></span>}
                </div>
              );
            })}
          </div>

          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Adding images…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!items.length} onClick={run}>{items.length ? `Save PDF with ${items.length} image${items.length > 1 ? 's' : ''}` : 'Add an image first'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
