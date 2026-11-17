import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { StickyToolbar, StickyActions } from '../components/ui/Sticky';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { Box } from '../lib/redact';
import { usePdfDoc } from './usePdfDoc';

interface Mark extends Box { id: number; page: number; }
let seq = 0;

export default function RedactPdf() {
  const doc = usePdfDoc(900);
  const [page, setPage] = useState(0);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [draw, setDraw] = useState(true);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [strip, setStrip] = useState(true);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageBox = useRef<HTMLDivElement>(null);
  const pdf = useRef<any>(null);
  const drag = useRef<{ id: number; mode: 'new' | 'move' | 'resize'; sx: number; sy: number; start: Mark; rw: number; rh: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    setPage(0); setMarks([]); setSel(null); setNote(null);
    pdf.current?.destroy?.(); pdf.current = null;
  }, [doc.bytes]);
  useEffect(() => () => { pdf.current?.destroy?.(); }, []);

  const getPdf = async () => {
    if (!pdf.current) { const { openPdf } = await import('../lib/pdfjs'); pdf.current = await openPdf(doc.bytes!.slice()); }
    return pdf.current;
  };

  const t = doc.thumbs[page];
  const aspect = t?.aspect ?? 1.414;
  const onPage = marks.filter((m) => m.page === page);
  const pagesMarked = new Set(marks.map((m) => m.page)).size;
  const update = (id: number, patch: Partial<Mark>) => setMarks((c) => c.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

  const search = async () => {
    if (!query.trim() || !doc.bytes) return;
    setSearching(true); setNote(null); setError(null);
    try {
      const { findText } = await import('../lib/redact');
      const found = await findText(await getPdf(), query);
      let n = 0;
      const add: Mark[] = [];
      found.forEach((boxes, p) => boxes.forEach((b) => { n++; add.push({ ...b, id: seq++, page: p }); }));
      setMarks((c) => [...c, ...add]);
      if (n) { const first = Math.min(...found.keys()); setPage(first); }
      setNote(n ? `Marked ${n} match${n > 1 ? 'es' : ''} on ${found.size} page${found.size > 1 ? 's' : ''}. Check each box covers the whole word.`
        : 'No matches. If this PDF is a scan, its text is an image: draw boxes by hand instead.');
    } catch (e) { setError(friendlyError(e).message); }
    finally { setSearching(false); }
  };

  const point = (e: PointerEvent) => {
    const r = pageBox.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height), r };
  };
  const startNew = (e: PointerEvent) => {
    if (!draw) { setSel(null); return; }
    e.preventDefault();
    const { x, y, r } = point(e);
    const m: Mark = { id: seq++, page, x, y, w: 0, h: 0 };
    setMarks((c) => [...c, m]); setSel(m.id);
    drag.current = { id: m.id, mode: 'new', sx: e.clientX, sy: e.clientY, start: m, rw: r.width, rh: r.height, ox: x, oy: y };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const startEdit = (e: PointerEvent, m: Mark, mode: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation();
    setSel(m.id);
    const r = pageBox.current!.getBoundingClientRect();
    drag.current = { id: m.id, mode, sx: e.clientX, sy: e.clientY, start: m, rw: r.width, rh: r.height, ox: 0, oy: 0 };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'new') {
      const { x, y } = point(e);
      update(d.id, { x: Math.min(x, d.ox), y: Math.min(y, d.oy), w: Math.abs(x - d.ox), h: Math.abs(y - d.oy) });
      return;
    }
    const dx = (e.clientX - d.sx) / d.rw, dy = (e.clientY - d.sy) / d.rh, s = d.start;
    if (d.mode === 'move') update(d.id, { x: clamp01(Math.min(s.x + dx, 1 - s.w)), y: clamp01(Math.min(s.y + dy, 1 - s.h)) });
    else update(d.id, { w: Math.min(Math.max(0.01, s.w + dx), 1 - s.x), h: Math.min(Math.max(0.006, s.h + dy), 1 - s.y) });
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'new') setMarks((c) => c.filter((m) => m.id !== d.id || (m.w > 0.01 && m.h > 0.006)));
  };

  const apply = async () => {
    if (!doc.bytes || !marks.length) return;
    setPhase('working'); setError(null);
    try {
      const { flattenPage } = await import('../lib/redact');
      const p = await getPdf();
      const pages = [...new Set(marks.map((m) => m.page))].sort((a, b) => a - b);
      const flat = [];
      for (let i = 0; i < pages.length; i++) {
        setProgress({ label: `Redacting page ${pages[i] + 1} (${i + 1} of ${pages.length})…`, value: i / pages.length });
        flat.push({ index: pages[i], ...(await flattenPage(p, pages[i], marks.filter((m) => m.page === pages[i]), '#000000')) });
      }
      setProgress({ label: 'Building the new PDF…', value: 0.95 });
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('redactPages', [doc.bytes.slice().buffer, flat, strip], flat.map((f) => f.jpeg)));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setMarks([]); setOut(null); setPhase('edit'); setQuery(''); setNote(null); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Redaction complete" stats={[['Boxes', String(marks.length)], ['Pages redacted', `${pagesMarked} of ${doc.pageCount}`], ['Size', formatBytes(out.length)]]}
          highlight="Text under the boxes is removed from the file, not just hidden."
          onDownload={() => downloadBlob(out, doc.file!.name.replace(/\.pdf$/i, '') + '-redacted.pdf')} downloadLabel="Download redacted PDF" onReset={reset} resetLabel="Redact another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Back to boxes</button>
        </ResultCard>
      </div>
    );
  }

  const selected = marks.find((m) => m.id === sel);
  const navBtn = 'grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3';

  return (
    <div class="card space-y-4 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop the PDF to redact" buttonLabel="Select PDF" hint="Black out names, numbers and addresses for real." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}

      {doc.file && doc.pageCount > 0 && (
        <>
          <StickyToolbar>
            <form class="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
              <input type="search" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} placeholder="Find text to black out, e.g. a phone number"
                aria-label="Text to find" class="h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-[16px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-3" />
              <button type="submit" class="btn-secondary min-h-10 shrink-0 px-3 text-sm" disabled={searching || !query.trim()}>{searching ? 'Finding…' : 'Mark all'}</button>
            </form>
            <div class="flex items-center gap-1.5">
              <button type="button" aria-pressed={draw} onClick={() => setDraw(!draw)}
                class={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${draw ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-white dark:border-white/10 dark:bg-night-3'}`}>
                ✏️ Draw {draw ? 'on' : 'off'}
              </button>
              {selected && <button type="button" class="min-h-9 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-danger dark:border-white/10 dark:bg-night-3" onClick={() => { setMarks((c) => c.filter((m) => m.id !== sel)); setSel(null); }}>Delete box</button>}
              {!selected && onPage.length > 0 && <button type="button" class="min-h-9 rounded-lg px-2 text-xs font-semibold text-muted underline dark:text-gray-400" onClick={() => setMarks((c) => c.filter((m) => m.page !== page))}>Clear page</button>}
              {doc.pageCount > 1 && (
                <div class="ml-auto flex shrink-0 items-center gap-1">
                  <button type="button" class={navBtn} disabled={page === 0} onClick={() => { setPage(page - 1); setSel(null); }} aria-label="Previous page">‹</button>
                  <span class="px-1 text-xs font-semibold tabular-nums">Page {page + 1}/{doc.pageCount}</span>
                  <button type="button" class={navBtn} disabled={page >= doc.pageCount - 1} onClick={() => { setPage(page + 1); setSel(null); }} aria-label="Next page">›</button>
                </div>
              )}
            </div>
            {note && <p class="text-xs text-muted dark:text-gray-400">{note}</p>}
          </StickyToolbar>

          <div ref={pageBox} class="relative mx-auto w-full max-w-[680px] select-none overflow-hidden rounded-md border border-line bg-white shadow-sm dark:border-white/10"
            style={{ aspectRatio: `1 / ${aspect}`, touchAction: draw ? 'none' : 'pan-y', cursor: draw ? 'crosshair' : 'default' }}
            onPointerDown={(e) => startNew(e as unknown as PointerEvent)} onPointerMove={(e) => move(e as unknown as PointerEvent)} onPointerUp={up} onPointerCancel={up}>
            {t?.url ? <img src={t.url} alt={`Page ${page + 1}`} draggable={false} class="pointer-events-none absolute inset-0 h-full w-full" />
              : <span class="absolute inset-0 grid place-items-center"><span class="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" /></span>}
            {onPage.map((m) => (
              <div key={m.id} class={`absolute bg-black/80 ${m.id === sel ? 'outline outline-2 outline-offset-1 outline-brand' : ''}`}
                style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%`, touchAction: 'none', cursor: 'move' }}
                onPointerDown={(e) => startEdit(e as unknown as PointerEvent, m, 'move')}>
                {m.id === sel && (
                  <span class="absolute -bottom-4 -right-4 grid h-9 w-9 place-items-center" style={{ touchAction: 'none', cursor: 'nwse-resize' }} onPointerDown={(e) => startEdit(e as unknown as PointerEvent, m, 'resize')} aria-hidden="true">
                    <span class="h-4 w-4 rounded-full border-2 border-white bg-brand shadow" />
                  </span>
                )}
              </div>
            ))}
          </div>
          <p class="text-center text-xs text-muted dark:text-gray-400">{draw ? 'Drag on the page to draw a box. Tap a box to move, resize or delete it.' : 'Drawing is off, so you can scroll freely.'}</p>

          <div class="rounded-control bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
            Pages with boxes are turned into images so the hidden text is truly gone. Text on those pages can’t be selected or searched afterwards. Other pages stay exactly as they are.
          </div>
          <label class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={strip} onChange={(e) => setStrip((e.target as HTMLInputElement).checked)} />Also remove document info (title, author, keywords)</label>

          <StickyActions>
            {phase === 'working' ? <ProgressBar label={progress.label} value={progress.value} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!marks.length} onClick={apply}>
                {marks.length ? `Redact ${marks.length} area${marks.length > 1 ? 's' : ''} on ${pagesMarked} page${pagesMarked > 1 ? 's' : ''}` : 'Draw or find something to redact'}
              </button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
