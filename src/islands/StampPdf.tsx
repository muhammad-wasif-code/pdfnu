import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { StampSpec } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';
import { StickyActions } from '../components/ui/Sticky';

const PRESETS: { text: string; color: string }[] = [
  { text: 'APPROVED', color: '#16a34a' }, { text: 'PAID', color: '#dc2626' }, { text: 'RECEIVED', color: '#2563eb' },
  { text: 'DRAFT', color: '#6b7280' }, { text: 'CONFIDENTIAL', color: '#dc2626' }, { text: 'REJECTED', color: '#dc2626' },
  { text: 'COPY', color: '#2563eb' }, { text: 'FINAL', color: '#16a34a' }, { text: 'VOID', color: '#dc2626' },
  { text: 'URGENT', color: '#ea580c' }, { text: 'VERIFIED', color: '#16a34a' }, { text: 'FOR REVIEW', color: '#7c3aed' },
];
const COLORS = ['#dc2626', '#16a34a', '#2563eb', '#7c3aed', '#ea580c', '#111827', '#6b7280'];
type Shape = StampSpec['shape'];
type Scope = 'this' | 'all' | 'first' | 'last';

const today = () => new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

let mctx: CanvasRenderingContext2D | null = null;
/** Width of bold Arial text at 100px (the PDF uses the metric-compatible Liberation Sans Bold). */
const width100 = (t: string) => { mctx ??= document.createElement('canvas').getContext('2d'); if (!mctx) return t.length * 70; mctx.font = 'bold 100px Arial, Helvetica, sans-serif'; return mctx.measureText(t).width || 100; };

/** Preview that mirrors pdfOps.stampOps (same proportions). */
function StampSvg({ s, w }: { s: Pick<StampSpec, 'text' | 'sub' | 'color' | 'shape'>; w: number }) {
  const main = s.text.trim() || ' ', sub = s.sub.trim();
  const base = (w * 0.84 * 100) / width100(main);
  const subSize0 = base * 0.32;
  const subW = sub ? (width100(sub) * subSize0) / 100 : 0;
  const subSize = sub && subW > w * 0.84 ? (subSize0 * w * 0.84) / subW : subSize0;
  const H = base * 1.25 + (sub ? subSize * 1.5 : 0);
  const lw = Math.max(1.2, base * 0.07);
  const mainSize = s.shape === 'oval' ? base * 0.82 : base;
  const r = (inset: number) => {
    const ww = w - inset * 2, hh = H - inset * 2;
    if (s.shape === 'oval') return <ellipse cx={w / 2} cy={H / 2} rx={ww / 2} ry={hh / 2} />;
    const rad = s.shape === 'round' ? Math.min(ww, hh) / 2 * 0.35 : 0;
    return <rect x={inset} y={inset} width={ww} height={hh} rx={rad} />;
  };
  const asc = mainSize * 0.905 * 0.92; // Liberation Sans ascent × the same factor the PDF uses
  const top = H - (H - (asc + (sub ? subSize * 1.5 : 0))) / 2; // in y-up terms, like stampOps
  const y = (v: number) => H - v;
  return (
    <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} style={{ overflow: 'visible', display: 'block' }} aria-hidden="true">
      <g fill="none" stroke={s.color}>
        <g stroke-width={lw}>{r(lw / 2)}</g>
        <g stroke-width={lw * 0.45}>{r(lw * 2.2)}</g>
      </g>
      <text x={w / 2} y={y(top - asc)} text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size={mainSize} fill={s.color}>{main}</text>
      {sub && <text x={w / 2} y={y(top - asc - subSize * 1.3)} text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size={subSize} fill={s.color}>{sub}</text>}
    </svg>
  );
}

export default function StampPdf() {
  const doc = usePdfDoc(900);
  const [page, setPage] = useState(0);
  const [text, setText] = useState('APPROVED');
  const [subOn, setSubOn] = useState(true);
  const [sub, setSub] = useState(today());
  const [color, setColor] = useState('#16a34a');
  const [shape, setShape] = useState<Shape>('round');
  const [angle, setAngle] = useState(-12);
  const [opacity, setOpacity] = useState(0.85);
  const [pos, setPos] = useState({ cx: 0.72, cy: 0.18, w: 0.34 });
  const [scope, setScope] = useState<Scope>('this');
  const [boxW, setBoxW] = useState(600);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageBox = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'resize'; sx: number; sy: number; start: typeof pos; rw: number; rh: number } | null>(null);

  useEffect(() => { setPage(0); }, [doc.file]);
  useEffect(() => {
    const el = pageBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.file, phase]);

  const pages = scope === 'all' ? Array.from({ length: doc.pageCount }, (_, i) => i) : scope === 'first' ? [0] : scope === 'last' ? [doc.pageCount - 1] : [page];
  const spec = (p: number): StampSpec => ({ page: p, ...pos, text: text.trim(), sub: subOn ? sub : '', color, angle, opacity, shape });

  const down = (e: PointerEvent, mode: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation();
    const r = pageBox.current!.getBoundingClientRect();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: pos, rw: r.width, rh: r.height };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.rw, dy = (e.clientY - d.sy) / d.rh;
    if (d.mode === 'move') setPos({ ...d.start, cx: Math.min(1, Math.max(0, d.start.cx + dx)), cy: Math.min(1, Math.max(0, d.start.cy + dy)) });
    else setPos({ ...d.start, w: Math.min(0.95, Math.max(0.08, d.start.w + dx * 2)) });
  };
  const up = () => { drag.current = null; };

  const run = async () => {
    if (!doc.bytes || !text.trim()) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('stampPdf', [doc.bytes.slice().buffer, pages.map(spec)]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Stamp added!" stats={[['Stamp', text.trim().slice(0, 14)], ['Pages stamped', String(pages.length)], ['Size', formatBytes(out.length)]]}
          highlight="The stamp is part of the page, so it prints and can’t be moved by accident."
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'stamped PDF' : doc.file.name}`} onReset={reset} resetLabel="Stamp another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change the stamp</button>
        </ResultCard>
      </div>
    );
  }

  const t = doc.thumbs[page];
  const aspect = t?.aspect ?? 1.414;
  const showHere = pages.includes(page);
  const inputCls = 'h-11 min-w-0 flex-1 rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2';

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop the PDF to stamp" buttonLabel="Select PDF" hint="APPROVED, PAID, DRAFT, CONFIDENTIAL or your own text." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && (
        <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div class="order-2 space-y-3">
            <fieldset>
              <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Stamp</legend>
              <div class="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.text} type="button" aria-pressed={text === p.text} onClick={() => { setText(p.text); setColor(p.color); }}
                    class={`min-h-9 rounded-md border px-2 text-[11px] font-bold tracking-wide ${text === p.text ? 'ring-2 ring-brand' : ''}`} style={{ color: p.color, borderColor: p.color }}>{p.text}</button>
                ))}
              </div>
              <input type="text" class={`${inputCls} mt-2 w-full`} maxLength={40} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} aria-label="Stamp text" placeholder="Your own text" />
            </fieldset>
            <label class="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" class="h-5 w-5 accent-brand" checked={subOn} onChange={(e) => setSubOn((e.target as HTMLInputElement).checked)} />Second line (date, name)</label>
            {subOn && (
              <div class="flex gap-2">
                <input type="text" class={inputCls} maxLength={60} value={sub} onInput={(e) => setSub((e.target as HTMLInputElement).value)} aria-label="Second line" />
                <button type="button" class="btn-secondary min-h-11 shrink-0 px-3 text-sm" onClick={() => setSub(today())}>Today</button>
              </div>
            )}
            <div class="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Colour">
              {COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} class={`h-8 w-8 rounded-full border-[3px] ring-1 ring-black/15 ${color === c ? 'border-brand-light' : 'border-white dark:border-night-3'}`} style={{ background: c }} />)}
            </div>
            <OptionChips<Shape> label="Border" value={shape} onChange={(v) => v && setShape(v)} options={[{ value: 'round', label: 'Rounded' }, { value: 'rect', label: 'Square' }, { value: 'oval', label: 'Oval' }]} />
            <label class="flex items-center gap-2 text-sm font-semibold">Tilt <input type="range" min={-45} max={45} value={angle} class="h-9 min-w-0 flex-1 accent-brand" onInput={(e) => setAngle(+(e.target as HTMLInputElement).value)} /><span class="w-10 text-right tabular-nums">{angle}°</span></label>
            <label class="flex items-center gap-2 text-sm font-semibold">Opacity <input type="range" min={20} max={100} step={5} value={Math.round(opacity * 100)} class="h-9 min-w-0 flex-1 accent-brand" onInput={(e) => setOpacity(+(e.target as HTMLInputElement).value / 100)} /><span class="w-10 text-right tabular-nums">{Math.round(opacity * 100)}%</span></label>
            <OptionChips<Scope> label="Stamp which pages" value={scope} onChange={(v) => v && setScope(v)} options={[{ value: 'this', label: 'This page' }, { value: 'all', label: 'All pages' }, { value: 'first', label: 'First' }, { value: 'last', label: 'Last' }]} />
          </div>

          <div class="order-1 space-y-2">
            <div class="flex items-center gap-2">
              <p class="min-w-0 flex-1 text-xs text-muted dark:text-gray-400">Drag the stamp to move it. Drag the blue dot to resize.</p>
              {doc.pageCount > 1 && (
                <div class="flex shrink-0 items-center gap-1">
                  <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
                  <span class="px-1 text-xs font-semibold tabular-nums">Page {page + 1}/{doc.pageCount}</span>
                  <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3" disabled={page >= doc.pageCount - 1} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
                </div>
              )}
            </div>
            <div ref={pageBox} class="relative mx-auto w-full max-w-[640px] select-none overflow-hidden rounded-md border border-line bg-white shadow-sm dark:border-white/10"
              style={{ aspectRatio: `1 / ${aspect}` }} onPointerMove={(e) => move(e as unknown as PointerEvent)} onPointerUp={up} onPointerCancel={up}>
              {t?.url ? <img src={t.url} alt={`Page ${page + 1}`} draggable={false} class="pointer-events-none absolute inset-0 h-full w-full" />
                : <span class="absolute inset-0 grid place-items-center"><span class="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" /></span>}
              {showHere && text.trim() && (
                <div class="absolute cursor-move" style={{ left: `${pos.cx * 100}%`, top: `${pos.cy * 100}%`, transform: `translate(-50%, -50%) rotate(${-angle}deg)`, opacity, touchAction: 'none' }}
                  onPointerDown={(e) => down(e as unknown as PointerEvent, 'move')}>
                  <div class="outline-dashed outline-1 outline-offset-4 outline-brand/50"><StampSvg s={{ text, sub: subOn ? sub : '', color, shape }} w={pos.w * boxW} /></div>
                  <span class="absolute -bottom-5 -right-5 grid h-9 w-9 place-items-center" style={{ touchAction: 'none', cursor: 'nwse-resize' }} onPointerDown={(e) => down(e as unknown as PointerEvent, 'resize')} aria-hidden="true">
                    <span class="h-4 w-4 rounded-full border-2 border-white bg-brand shadow" />
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {doc.file && doc.pageCount > 0 && (
        <StickyActions>
          {phase === 'working' ? <ProgressBar label="Stamping…" value={null} /> : (
            <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!text.trim()} onClick={run}>{text.trim() ? `Stamp ${pages.length === 1 ? `page ${pages[0] + 1}` : `${pages.length} pages`}` : 'Type the stamp text'}</button>
          )}
        </StickyActions>
      )}
      <PrivacyNote />
    </div>
  );
}
