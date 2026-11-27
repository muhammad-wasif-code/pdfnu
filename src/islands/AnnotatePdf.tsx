import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { Annot } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';
import { StickyToolbar, StickyActions } from '../components/ui/Sticky';

type Tool = 'select' | 'highlight' | 'underline' | 'strike' | 'ink' | 'square' | 'circle' | 'arrow' | 'text' | 'note';
type Item = Annot & { id: string };
interface Box { x: number; y: number; w: number; h: number; }

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'highlight', label: 'Highlight', icon: '▮' }, { id: 'underline', label: 'Underline', icon: 'U̲' }, { id: 'strike', label: 'Strike', icon: 'S̶' },
  { id: 'ink', label: 'Pen', icon: '✎' }, { id: 'text', label: 'Text', icon: 'T' }, { id: 'note', label: 'Note', icon: '💬' },
  { id: 'square', label: 'Box', icon: '▢' }, { id: 'circle', label: 'Circle', icon: '◯' }, { id: 'arrow', label: 'Arrow', icon: '↗' },
  { id: 'select', label: 'Select', icon: '⬚' },
];
const MARK_COLORS = ['#facc15', '#4ade80', '#38bdf8', '#f472b6', '#fb923c'];
const INK_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#111827', '#7c3aed'];
const isMark = (t: Tool) => t === 'highlight' || t === 'underline' || t === 'strike';
let seq = 0;

/** Text line boxes of a page (fractions of the visual page), for snapping highlights to text. */
async function textBoxes(bytes: Uint8Array, pageNo: number): Promise<Box[]> {
  const { openPdf } = await import('../lib/pdfjs');
  const pdf = await openPdf(bytes.slice());
  try {
    const page = await pdf.getPage(pageNo + 1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const out: Box[] = [];
    for (const it of tc.items as any[]) {
      if (!it.str?.trim()) continue;
      // corners of the item in PDF space → viewport (handles rotated pages and text)
      const [a, b, c, d, e, f] = it.transform;
      const t = vp.transform;
      const X = (x: number, y: number) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
      const lu = Math.hypot(a, b) || 1, lv = Math.hypot(c, d) || lu;
      const u = [a / lu, b / lu], v = [c / lv, d / lv], w = it.width ?? 0, h = lv;
      const pts = [[0, -0.22], [w, -0.22], [0, 1], [w, 1]].map(([dx, k]) => X(e + u[0] * dx + v[0] * h * k, f + u[1] * dx + v[1] * h * k));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      out.push({ x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height });
    }
    page.cleanup();
    return out;
  } finally { await pdf.destroy(); }
}

/** Snap a dragged rectangle to the text lines it covers; falls back to the rectangle itself (scans). */
function snap(r: Box, boxes: Box[]): Box[] {
  const hits = boxes.filter((b) => {
    const oy = Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y);
    const ox = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x);
    return ox > 0 && (oy > b.h * 0.4 || (r.h < b.h && oy > r.h * 0.5));
  });
  if (!hits.length) return [r];
  // group into lines by vertical centre
  const lines: Box[][] = [];
  for (const b of hits.sort((p, q) => p.y - q.y)) {
    const L = lines.find((l) => Math.abs((l[0].y + l[0].h / 2) - (b.y + b.h / 2)) < l[0].h * 0.5);
    if (L) L.push(b); else lines.push([b]);
  }
  return lines.map((l) => {
    const y = Math.min(...l.map((b) => b.y)), y1 = Math.max(...l.map((b) => b.y + b.h));
    const x = Math.max(r.x, Math.min(...l.map((b) => b.x))), x1 = Math.min(r.x + r.w, Math.max(...l.map((b) => b.x + b.w)));
    return { x, y, w: Math.max(0.002, x1 - x), h: y1 - y };
  });
}

export default function AnnotatePdf() {
  const doc = usePdfDoc(900);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [page, setPage] = useState(0);
  const [tool, setTool] = useState<Tool>('highlight');
  const [markColor, setMarkColor] = useState(MARK_COLORS[0]);
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [width, setWidth] = useState(2);
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Item | null>(null);
  // latest in-progress mark, readable by pointer handlers before React re-renders
  const draftRef = useRef<Item | null>(null);
  const setDraft = (d: Item | null) => { draftRef.current = d; setDraftState(d); };
  const [author, setAuthor] = useState('');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const textCache = useRef(new Map<number, Promise<Box[]>>());
  const start = useRef<[number, number] | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setPage(0); setItems([]); setSel(null); setSizes([]); textCache.current.clear();
    if (!doc.bytes) return;
    import('../lib/pdfWorker').then(({ pdfOp }) => pdfOp('pageSizes', [doc.bytes!.slice().buffer])).then(setSizes).catch(() => {});
  }, [doc.bytes]);
  useEffect(() => { try { setAuthor(localStorage.getItem('pdfsherpa-author') ?? ''); } catch { /* storage blocked */ } }, []);

  const ps = sizes[page] ?? { w: 595, h: (doc.thumbs[page]?.aspect ?? 1.414) * 595 };
  const texts = (p: number) => { let t = textCache.current.get(p); if (!t && doc.bytes) { t = textBoxes(doc.bytes, p).catch(() => []); textCache.current.set(p, t); } return t ?? Promise.resolve([]); };
  useEffect(() => { if (doc.bytes && doc.pageCount) texts(page); }, [doc.bytes, page]);

  const color = isMark(tool) ? markColor : inkColor;
  const selected = items.find((i) => i.id === sel) ?? null;
  const update = (id: string, patch: Partial<Item>) => setItems((c) => c.map((i) => (i.id === id ? ({ ...i, ...patch } as Item) : i)));
  const textH = (text: string, size: number) => ((text.split('\n').length * size * 1.2 + size * 0.6) / ps.h);
  const wantFocus = useRef(false);
  const focusEditor = () => { wantFocus.current = true; };
  // focus the comment box once it has rendered (after the pointer events of the tap have finished)
  useEffect(() => {
    if (!wantFocus.current) return;
    const t = setTimeout(() => { if (editor.current) { wantFocus.current = false; editor.current.focus({ preventScroll: true }); editor.current.select(); } }, 120);
    return () => clearTimeout(t);
  }, [sel, items]);

  const pt = (e: PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const down = (e: PointerEvent) => {
    if (tool === 'select') { setSel(null); return; }
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [x, y] = pt(e);
    start.current = [x, y];
    const id = `a${seq++}`;
    if (tool === 'text') {
      const it: Item = { id, kind: 'text', page, color: inkColor, size: 14, x, y, w: Math.min(0.45, 1 - x), h: textH('Your comment', 14), text: 'Your comment' };
      setItems((c) => [...c, it]); setSel(id); setTool('select'); focusEditor(); start.current = null; return;
    }
    if (tool === 'note') {
      const it: Item = { id, kind: 'note', page, color: markColor, x: Math.min(x, 1 - 20 / ps.w), y: Math.max(y, 20 / ps.h), text: '' };
      setItems((c) => [...c, it]); setSel(id); setTool('select'); focusEditor(); start.current = null; return;
    }
    if (tool === 'ink') setDraft({ id, kind: 'ink', page, color: inkColor, width, paths: [[[x, y]]] });
    else if (tool === 'arrow') setDraft({ id, kind: 'arrow', page, color: inkColor, width, x1: x, y1: y, x2: x, y2: y });
    else if (tool === 'square' || tool === 'circle') setDraft({ id, kind: tool, page, color: inkColor, width, x, y, w: 0, h: 0 });
    else setDraft({ id, kind: tool, page, color: markColor, quads: [{ x, y, w: 0, h: 0 }] } as Item);
  };
  const moveP = (e: PointerEvent) => {
    const draft = draftRef.current;
    if (!start.current || !draft) return;
    const [x, y] = pt(e), [sx, sy] = start.current;
    const r = { x: Math.min(x, sx), y: Math.min(y, sy), w: Math.abs(x - sx), h: Math.abs(y - sy) };
    if (draft.kind === 'ink') setDraft({ ...draft, paths: [[...draft.paths[0], [x, y]]] });
    else if (draft.kind === 'arrow') setDraft({ ...draft, x2: x, y2: y });
    else if (draft.kind === 'square' || draft.kind === 'circle') setDraft({ ...draft, ...r });
    else if ('quads' in draft) setDraft({ ...draft, quads: [r] });
  };
  const upP = async () => {
    const d = draftRef.current;
    start.current = null; setDraft(null);
    if (!d) return;
    if ('quads' in d) {
      const r = d.quads[0];
      if (r.w < 0.005) return;
      const quads = snap(r, await texts(d.page));
      setItems((c) => [...c, { ...d, quads }]);
      return;
    }
    if ((d.kind === 'square' || d.kind === 'circle') && (d.w < 0.01 || d.h < 0.005)) return;
    if (d.kind === 'arrow' && Math.hypot(d.x2 - d.x1, (d.y2 - d.y1) * (ps.h / ps.w)) < 0.02) return;
    setItems((c) => [...c, d]);
  };

  const run = async () => {
    if (!doc.bytes || !items.length) return;
    setPhase('working'); setError(null);
    try { localStorage.setItem('pdfsherpa-author', author); } catch { /* ignore */ }
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const list = items.filter((i) => !((i.kind === 'text' || i.kind === 'note') && !i.text.trim())).map(({ id: _id, ...a }) => a as Annot);
      setOut(await pdfOp('annotatePdf', [doc.bytes.slice().buffer, list, author]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setItems([]); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your annotations are saved!" stats={[['Annotations', String(items.length)], ['Pages', String(doc.pageCount)], ['Size', formatBytes(out.length)]]}
          highlight="They are real PDF comments: other people can see, reply to or remove them in Acrobat, Edge, Preview and more."
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'annotated PDF' : doc.file.name}`} onReset={reset} resetLabel="Annotate another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep annotating</button>
        </ResultCard>
      </div>
    );
  }

  // ---- drawing (SVG in points of the visual page) ----
  const X = (f: number) => f * ps.w, Y = (f: number) => f * ps.h;
  const render = (a: Item, ghost = false) => {
    const on = a.id === sel && !ghost;
    const pick = tool === 'select' && !ghost ? { onPointerDown: (e: PointerEvent) => { e.stopPropagation(); setSel(a.id); if (a.kind === 'text' || a.kind === 'note') focusEditor(); }, style: { cursor: 'pointer' } } : {};
    const outline = (b: Box) => on && <rect x={X(b.x) - 3} y={Y(b.y) - 3} width={X(b.w) + 6} height={Y(b.h) + 6} fill="none" stroke="#4f46e5" stroke-width={1.2} stroke-dasharray="4 3" />;
    switch (a.kind) {
      case 'highlight': case 'underline': case 'strike': {
        const bb = { x: Math.min(...a.quads.map((q) => q.x)), y: Math.min(...a.quads.map((q) => q.y)), w: 0, h: 0 };
        bb.w = Math.max(...a.quads.map((q) => q.x + q.w)) - bb.x; bb.h = Math.max(...a.quads.map((q) => q.y + q.h)) - bb.y;
        return (
          <g key={a.id} {...pick as any}>
            {a.quads.map((q, i) => a.kind === 'highlight'
              ? <rect key={i} x={X(q.x)} y={Y(q.y)} width={X(q.w)} height={Y(q.h)} fill={a.color} style={{ mixBlendMode: 'multiply' }} opacity={ghost ? 0.6 : 1} />
              : <g key={i}><rect x={X(q.x)} y={Y(q.y)} width={X(q.w)} height={Y(q.h)} fill="transparent" /><line x1={X(q.x)} x2={X(q.x + q.w)} y1={Y(q.y + q.h * (a.kind === 'underline' ? 0.92 : 0.55))} y2={Y(q.y + q.h * (a.kind === 'underline' ? 0.92 : 0.55))} stroke={a.color} stroke-width={Math.max(0.6, Y(q.h) * 0.07)} /></g>)}
            {outline(bb)}
          </g>
        );
      }
      case 'ink': {
        const pts = a.paths[0];
        const bb = { x: Math.min(...pts.map((p) => p[0])), y: Math.min(...pts.map((p) => p[1])), w: 0, h: 0 };
        bb.w = Math.max(...pts.map((p) => p[0])) - bb.x; bb.h = Math.max(...pts.map((p) => p[1])) - bb.y;
        return <g key={a.id} {...pick as any}><polyline points={pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')} fill="none" stroke={a.color} stroke-width={a.width} stroke-linecap="round" stroke-linejoin="round" />{on && outline(bb)}<polyline points={pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')} fill="none" stroke="transparent" stroke-width={12} /></g>;
      }
      case 'square': return <g key={a.id} {...pick as any}><rect x={X(a.x)} y={Y(a.y)} width={X(a.w)} height={Y(a.h)} fill="transparent" stroke={a.color} stroke-width={a.width} />{outline(a)}</g>;
      case 'circle': return <g key={a.id} {...pick as any}><ellipse cx={X(a.x + a.w / 2)} cy={Y(a.y + a.h / 2)} rx={X(a.w / 2)} ry={Y(a.h / 2)} fill="transparent" stroke={a.color} stroke-width={a.width} />{outline(a)}</g>;
      case 'arrow': {
        const x1 = X(a.x1), y1 = Y(a.y1), x2 = X(a.x2), y2 = Y(a.y2), L = Math.max(6, a.width * 4), ang = Math.atan2(y2 - y1, x2 - x1);
        return (
          <g key={a.id} {...pick as any}>
            <line x1={x1} y1={y1} x2={x2 - L * 0.8 * Math.cos(ang)} y2={y2 - L * 0.8 * Math.sin(ang)} stroke={a.color} stroke-width={a.width} stroke-linecap="round" />
            <polygon points={`${x2},${y2} ${x2 - L * Math.cos(ang - 0.45)},${y2 - L * Math.sin(ang - 0.45)} ${x2 - L * Math.cos(ang + 0.45)},${y2 - L * Math.sin(ang + 0.45)}`} fill={a.color} />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" stroke-width={14} />
            {on && outline({ x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) })}
          </g>
        );
      }
      case 'text': return (
        <g key={a.id} {...pick as any}>
          <rect x={X(a.x)} y={Y(a.y)} width={X(a.w)} height={Y(a.h)} fill="transparent" stroke={on ? '#4f46e5' : '#4f46e555'} stroke-dasharray="3 3" />
          <text x={X(a.x) + 2} y={Y(a.y) + a.size * 0.95} font-size={a.size} fill={a.color} font-family="Arial, Helvetica, sans-serif">
            {a.text.split('\n').map((l, i) => <tspan key={i} x={X(a.x) + 2} dy={i ? a.size * 1.2 : 0}>{l || ' '}</tspan>)}
          </text>
        </g>
      );
      case 'note': return (
        <g key={a.id} {...pick as any} transform={`translate(${X(a.x)},${Y(a.y) - 20})`}>
          <path d="M1 1h18v13H9l-5 5 1-5H1z" fill={a.color} stroke="#333" stroke-width={0.8} />
          <path d="M4 5h12M4 9h9" stroke="#333" stroke-width={1} />
          {on && <rect x={-3} y={-3} width={26} height={26} fill="none" stroke="#4f46e5" stroke-dasharray="4 3" />}
        </g>
      );
    }
  };

  const onPage = items.filter((i) => i.page === page);
  const t = doc.thumbs[page];
  const swatch = (c: string, active: boolean, set: (c: string) => void) => (
    <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={active} onClick={() => { set(c); if (selected) update(selected.id, { color: c } as Partial<Item>); }}
      class={`h-8 w-8 shrink-0 rounded-full border-[3px] ring-1 ring-black/15 ${active ? 'border-brand-light' : 'border-white dark:border-night-3'}`} style={{ background: c }} />
  );
  const palette = selected ? (selected.kind === 'highlight' || selected.kind === 'underline' || selected.kind === 'strike' || selected.kind === 'note' ? 'mark' : 'ink') : isMark(tool) || tool === 'note' ? 'mark' : 'ink';

  return (
    <div class="card space-y-4 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop the PDF to annotate" buttonLabel="Select PDF" hint="Highlight, comment, draw and add notes." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <>
          <StickyToolbar>
            <div class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5" role="toolbar" aria-label="Annotation tools">
              {TOOLS.map((tl) => (
                <button key={tl.id} type="button" aria-pressed={tool === tl.id} onClick={() => { setTool(tl.id); if (tl.id !== 'select') setSel(null); }}
                  class={`flex min-h-11 min-w-[3.4rem] shrink-0 flex-col items-center justify-center rounded-lg border px-1.5 text-[11px] font-semibold ${tool === tl.id ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-white text-gray-800 dark:border-white/10 dark:bg-night-3 dark:text-gray-100'}`}>
                  <span aria-hidden="true" class="text-base leading-none">{tl.icon}</span>{tl.label}
                </button>
              ))}
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              {palette === 'mark' ? MARK_COLORS.map((c) => swatch(c, (selected?.color ?? markColor) === c, setMarkColor)) : INK_COLORS.map((c) => swatch(c, (selected?.color ?? inkColor) === c, setInkColor))}
              {(['ink', 'square', 'circle', 'arrow'] as Tool[]).includes(selected?.kind as Tool ?? tool) && (
                <select aria-label="Line width" value={selected && 'width' in selected ? selected.width : width} class="h-9 rounded-lg border border-line bg-white px-2 text-sm dark:border-white/10 dark:bg-night-3"
                  onChange={(e) => { const v = +(e.target as HTMLSelectElement).value; setWidth(v); if (selected && 'width' in selected) update(selected.id, { width: v } as Partial<Item>); }}>
                  {[1, 2, 3, 5, 8].map((w) => <option key={w} value={w}>{w} pt</option>)}
                </select>
              )}
              <div class="ml-auto flex items-center gap-1">
                <button type="button" class="grid h-9 min-w-9 place-items-center rounded-lg border border-line bg-white px-2 text-sm dark:border-white/10 dark:bg-night-3" disabled={!items.length} onClick={() => { setItems((c) => c.slice(0, -1)); setSel(null); }} aria-label="Undo">↶</button>
                {selected && <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-danger dark:border-white/10 dark:bg-night-3" onClick={() => { setItems((c) => c.filter((x) => x.id !== selected.id)); setSel(null); }} aria-label="Delete annotation">🗑</button>}
              </div>
            </div>
            {selected && (selected.kind === 'text' || selected.kind === 'note') && (
              <div class="flex items-start gap-2">
                <textarea ref={editor} rows={2} value={selected.text} placeholder={selected.kind === 'note' ? 'Type your comment…' : 'Type text…'} aria-label="Annotation text"
                  onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; update(selected.id, selected.kind === 'text' ? { text: v, h: textH(v, selected.size) } as Partial<Item> : { text: v } as Partial<Item>); }}
                  class="block min-w-0 flex-1 resize-y rounded-lg border-2 border-brand bg-white px-3 py-2 text-[16px] leading-6 outline-none dark:bg-night-3" />
                {selected.kind === 'text' && (
                  <select aria-label="Text size" value={selected.size} class="h-11 rounded-lg border border-line bg-white px-2 text-sm dark:border-white/10 dark:bg-night-3"
                    onChange={(e) => { const s = +(e.target as HTMLSelectElement).value; update(selected.id, { size: s, h: textH(selected.text, s) } as Partial<Item>); }}>
                    {[9, 11, 12, 14, 18, 24, 32].map((s) => <option key={s} value={s}>{s}pt</option>)}
                  </select>
                )}
              </div>
            )}
            {selected && 'quads' in selected && (
              <input type="text" value={selected.note ?? ''} placeholder="Optional comment on this mark" aria-label="Comment" class="h-10 w-full rounded-lg border border-line bg-white px-3 text-[15px] dark:border-white/10 dark:bg-night-3"
                onInput={(e) => update(selected.id, { note: (e.target as HTMLInputElement).value } as Partial<Item>)} />
            )}
            <div class="flex items-center gap-2">
              <p class="min-w-0 flex-1 truncate text-xs text-muted dark:text-gray-400">
                {tool === 'select' ? 'Tap an annotation to edit or delete it.' : isMark(tool) ? 'Drag across the text to mark it.' : tool === 'ink' ? 'Draw on the page.' : tool === 'text' || tool === 'note' ? 'Tap where it should go.' : 'Drag on the page.'}
              </p>
              {doc.pageCount > 1 && (
                <div class="flex shrink-0 items-center gap-1">
                  <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3" disabled={page === 0} onClick={() => { setPage(page - 1); setSel(null); }} aria-label="Previous page">‹</button>
                  <span class="px-1 text-xs font-semibold tabular-nums">Page {page + 1}/{doc.pageCount}</span>
                  <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3" disabled={page >= doc.pageCount - 1} onClick={() => { setPage(page + 1); setSel(null); }} aria-label="Next page">›</button>
                </div>
              )}
            </div>
          </StickyToolbar>

          <div class="relative mx-auto w-full max-w-[720px] select-none overflow-hidden rounded-md border border-line bg-white shadow-sm dark:border-white/10" style={{ aspectRatio: `${ps.w} / ${ps.h}` }}>
            {t?.url ? <img src={t.url} alt={`Page ${page + 1}`} draggable={false} class="pointer-events-none absolute inset-0 h-full w-full" />
              : <span class="absolute inset-0 grid place-items-center"><span class="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" /></span>}
            <svg ref={box} viewBox={`0 0 ${ps.w} ${ps.h}`} class="absolute inset-0 h-full w-full" style={{ touchAction: tool === 'select' ? 'auto' : 'none', cursor: tool === 'select' ? 'default' : 'crosshair' }}
              onPointerDown={(e) => down(e as unknown as PointerEvent)} onPointerMove={(e) => moveP(e as unknown as PointerEvent)} onPointerUp={upP} onPointerCancel={upP}>
              {onPage.map((a) => render(a))}
              {draft && draft.page === page && render(draft, true)}
            </svg>
          </div>

          <label class="block text-sm">
            <span class="mb-1 block font-semibold text-ink dark:text-white">Your name <span class="font-normal text-muted dark:text-gray-400">(optional, shown as the comment author)</span></span>
            <input type="text" value={author} maxLength={60} onInput={(e) => setAuthor((e.target as HTMLInputElement).value)} class="h-11 w-full rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" />
          </label>

          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Saving annotations…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!items.length} onClick={run}>{items.length ? `Save PDF with ${items.length} annotation${items.length > 1 ? 's' : ''}` : 'Pick a tool and mark the page'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
