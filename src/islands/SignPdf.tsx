import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import SignaturePad, { type SignatureImage } from '../components/ui/SignaturePad';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { usePdfDoc } from './usePdfDoc';

interface Placed { id: string; page: number; x: number; y: number; w: number; h: number; img: SignatureImage; }
let seq = 0;

/** Render a short text (date, name) to a crisp transparent PNG. */
async function textToPng(text: string, color = '#111827'): Promise<SignatureImage> {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const size = 96;
  ctx.font = `${size}px Helvetica, Arial, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = w; c.height = Math.round(size * 1.35);
  ctx.font = `${size}px Helvetica, Arial, sans-serif`;
  ctx.fillStyle = color; ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, c.height / 2);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  return { blob, url: URL.createObjectURL(blob), aspect: c.width / c.height };
}

export default function SignPdf() {
  const doc = usePdfDoc(900);
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Placed[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [library, setLibrary] = useState<SignatureImage[]>([]);
  const [pad, setPad] = useState<null | 'signature' | 'initials'>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [textVal, setTextVal] = useState('');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageBox = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; start: Placed; rw: number; rh: number } | null>(null);

  useEffect(() => () => { library.forEach((l) => URL.revokeObjectURL(l.url)); }, []);
  useEffect(() => { setPage(0); setItems([]); }, [doc.file]);

  const aspect = doc.thumbs[page]?.aspect ?? 1.414; // page height / width

  const place = (img: SignatureImage, widthFrac = 0.28) => {
    const w = widthFrac;
    const h = w / (img.aspect * aspect);
    const it: Placed = { id: `s${seq++}`, page, x: (1 - w) / 2, y: Math.min(0.85, 0.7), w, h: Math.min(h, 0.4), img };
    if (it.h !== h) it.w = it.h * img.aspect * aspect;
    setItems((c) => [...c, it]);
    setSelected(it.id);
  };

  const addFromPad = (img: SignatureImage) => {
    setLibrary((l) => [...l, img]);
    place(img, pad === 'initials' ? 0.12 : 0.28);
    setPad(null);
  };

  const addDate = async () => {
    const d = new Date();
    const text = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    place(await textToPng(text), 0.2);
  };
  const addText = async () => {
    if (!textVal.trim()) return;
    place(await textToPng(textVal.trim()), Math.min(0.5, 0.04 + textVal.trim().length * 0.018));
    setTextVal(''); setTextOpen(false);
  };

  const down = (e: PointerEvent, it: Placed, mode: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation();
    setSelected(it.id);
    const r = pageBox.current!.getBoundingClientRect();
    drag.current = { id: it.id, mode, sx: e.clientX, sy: e.clientY, start: it, rw: r.width, rh: r.height };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.rw, dy = (e.clientY - d.sy) / d.rh;
    const s = d.start;
    let next: Placed;
    if (d.mode === 'move') {
      next = { ...s, x: Math.min(Math.max(0, s.x + dx), 1 - s.w), y: Math.min(Math.max(0, s.y + dy), 1 - s.h) };
    } else {
      const w = Math.min(Math.max(0.03, s.w + dx), 1 - s.x);
      const h = w / (s.img.aspect * aspect);
      if (s.y + h > 1) return;
      next = { ...s, w, h };
    }
    setItems((c) => c.map((x) => (x.id === d.id ? next : x)));
  };
  const up = () => { drag.current = null; };

  const apply = async () => {
    if (!doc.bytes || !items.length) return;
    setPhase('working'); setError(null);
    try {
      const buffers = new Map<SignatureImage, ArrayBuffer>();
      for (const it of items) if (!buffers.has(it.img)) buffers.set(it.img, await it.img.blob.arrayBuffer());
      const { pdfOp } = await import('../lib/pdfWorker');
      const res = await pdfOp('stamp', [doc.bytes.slice().buffer, items.map((it) => ({ page: it.page, x: it.x, y: it.y, w: it.w, h: it.h, png: buffers.get(it.img)! }))]);
      setOut(res); setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };

  const reset = () => { doc.clear(); setItems([]); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    const pagesSigned = new Set(items.map((i) => i.page)).size;
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is signed!" stats={[['Items placed', String(items.length)], ['Pages', `${pagesSigned} of ${doc.pageCount}`], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'signed PDF' : doc.file.name}`} onReset={reset} resetLabel="Sign another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep editing</button>
        </ResultCard>
      </div>
    );
  }

  const t = doc.thumbs[page];
  const onPage = items.filter((i) => i.page === page);

  return (
    <div class="card space-y-4 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop the PDF to sign" buttonLabel="Select PDF" onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}

      {doc.file && doc.pageCount > 0 && (
        <>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-primary min-h-11 px-4" onClick={() => setPad('signature')}>✍️ Add signature</button>
            <button type="button" class="btn-secondary min-h-11 px-3" onClick={() => setPad('initials')}>Initials</button>
            <button type="button" class="btn-secondary min-h-11 px-3" onClick={addDate}>Date</button>
            <button type="button" class="btn-secondary min-h-11 px-3" onClick={() => setTextOpen((v) => !v)}>Text</button>
          </div>

          {textOpen && (
            <form class="flex gap-2" onSubmit={(e) => { e.preventDefault(); addText(); }}>
              <input type="text" maxLength={60} value={textVal} onInput={(e) => setTextVal((e.target as HTMLInputElement).value)} placeholder="e.g. your full name or place"
                class="h-11 min-w-0 flex-1 rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" aria-label="Text to place" />
              <button type="submit" class="btn-primary min-h-11 px-4">Place</button>
            </form>
          )}

          {library.length > 0 && (
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-semibold text-muted dark:text-gray-400">Reuse:</span>
              {library.map((l, i) => (
                <button key={i} type="button" class="grid h-11 place-items-center rounded-lg border border-line bg-white px-2 dark:border-white/10" onClick={() => place(l, 0.28)} aria-label="Place this signature again">
                  <img src={l.url} alt="" class="max-h-8 max-w-[7rem]" />
                </button>
              ))}
            </div>
          )}

          <div class="flex items-center justify-between gap-2 text-sm">
            <button type="button" class="btn-ghost min-h-11 px-3" disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(null); }}>‹ Prev</button>
            <span class="font-semibold tabular-nums text-ink dark:text-white">Page {page + 1} of {doc.pageCount}</span>
            <button type="button" class="btn-ghost min-h-11 px-3" disabled={page >= doc.pageCount - 1} onClick={() => { setPage(page + 1); setSelected(null); }}>Next ›</button>
          </div>

          <div
            ref={pageBox}
            class="relative mx-auto w-full max-w-[640px] select-none overflow-hidden rounded-md border border-line bg-white shadow-sm dark:border-white/10"
            style={{ aspectRatio: `1 / ${aspect}` }}
            onPointerMove={(e) => move(e as unknown as PointerEvent)} onPointerUp={up} onPointerCancel={up}
            onPointerDown={() => setSelected(null)}
          >
            {t?.url ? <img src={t.url} alt={`Page ${page + 1}`} draggable={false} class="pointer-events-none absolute inset-0 h-full w-full" />
              : <span class="absolute inset-0 grid place-items-center"><span class="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" /></span>}
            {onPage.map((it) => {
              const sel = it.id === selected;
              return (
                <div key={it.id} class={`absolute cursor-move ${sel ? 'outline outline-2 outline-brand' : 'outline-dashed outline-1 outline-brand/40'}`}
                  style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, width: `${it.w * 100}%`, height: `${it.h * 100}%`, touchAction: 'none' }}
                  onPointerDown={(e) => down(e as unknown as PointerEvent, it, 'move')}>
                  <img src={it.img.url} alt="" draggable={false} class="pointer-events-none h-full w-full" />
                  {sel && (
                    <>
                      <button type="button" class="absolute -right-3 -top-3 grid h-8 w-8 place-items-center rounded-full bg-white text-danger shadow ring-1 ring-black/10 dark:bg-night-3"
                        onPointerDown={(e) => e.stopPropagation()} onClick={() => { setItems((c) => c.filter((x) => x.id !== it.id)); setSelected(null); }} aria-label="Remove">
                        <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
                      </button>
                      <span class="absolute -bottom-4 -right-4 grid h-9 w-9 place-items-center" style={{ touchAction: 'none', cursor: 'nwse-resize' }}
                        onPointerDown={(e) => down(e as unknown as PointerEvent, it, 'resize')} aria-hidden="true">
                        <span class="h-4 w-4 rounded-full border-2 border-white bg-brand shadow" />
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <p class="text-center text-xs text-muted dark:text-gray-400">Drag to move · drag the blue dot to resize · tap ✕ to remove</p>

          {phase === 'working' ? <ProgressBar label="Signing your PDF…" value={null} /> : (
            <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!items.length} onClick={apply}>
              {items.length ? `Sign & download (${items.length} item${items.length > 1 ? 's' : ''})` : 'Add a signature first'}
            </button>
          )}
        </>
      )}
      {pad && <SignaturePad title={pad === 'initials' ? 'Create your initials' : 'Create your signature'} onDone={addFromPad} onClose={() => setPad(null)} />}
      <PrivacyNote />
    </div>
  );
}
