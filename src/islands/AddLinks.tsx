import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { LinkSpec } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';
import { StickyToolbar, StickyActions } from '../components/ui/Sticky';

type Link = LinkSpec & { id: number; auto: boolean; on: boolean; text?: string };
let seq = 0;
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"')\]]+[^\s<>"')\].,;:!?]|[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})/gi;

let mctx: CanvasRenderingContext2D | null = null;
function textWidth(t: string, family: string) {
  mctx ??= document.createElement('canvas').getContext('2d');
  if (!mctx) return t.length;
  mctx.font = `100px ${family}`;
  return mctx.measureText(t).width;
}

/** Web addresses and e-mails in the text layer, with their boxes (fractions of the visual page). */
async function findLinks(bytes: Uint8Array, onPage: (n: number, of: number) => void): Promise<{ links: Link[]; existing: number }> {
  const { openPdf } = await import('../lib/pdfjs');
  const pdf = await openPdf(bytes.slice());
  const out: Link[] = [];
  let existing = 0;
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      onPage(p, pdf.numPages);
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      existing += (await page.getAnnotations()).filter((a: any) => a.subtype === 'Link').length;
      const tc = await page.getTextContent();
      const styles = tc.styles as Record<string, { fontFamily: string }>;
      for (const it of tc.items as any[]) {
        const s: string = it.str ?? '';
        if (!s || !/[@.]/.test(s)) continue;
        URL_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = URL_RE.exec(s))) {
          const [a, b, c, d, e, f] = it.transform;
          // where the match starts and ends inside the text item, measured with a similar font
          const fam = styles[it.fontName]?.fontFamily ?? 'sans-serif';
          const full = textWidth(s, fam) || 1;
          const u0 = (textWidth(s.slice(0, m.index), fam) / full) * (it.width ?? 0), u1 = (textWidth(s.slice(0, m.index + m[0].length), fam) / full) * (it.width ?? 0);
          const lu = Math.hypot(a, b) || 1, h = Math.hypot(c, d) || lu;
          const ux = a / lu, uy = b / lu, vx = c / h, vy = d / h;
          const corners = [[u0, -0.25], [u1, -0.25], [u0, 1], [u1, 1]].map(([du, k]) => { const px = e + ux * du + vx * h * k, py = f + uy * du + vy * h * k; const t = vp.transform; return [t[0] * px + t[2] * py + t[4], t[1] * px + t[3] * py + t[5]]; });
          const xs = corners.map((q) => q[0]), ys = corners.map((q) => q[1]);
          out.push({ id: seq++, auto: true, on: true, page: p - 1, text: m[0], url: m[0], x: Math.min(...xs) / vp.width, y: Math.min(...ys) / vp.height, w: (Math.max(...xs) - Math.min(...xs)) / vp.width, h: (Math.max(...ys) - Math.min(...ys)) / vp.height });
        }
      }
      page.cleanup();
    }
  } finally { await pdf.destroy(); }
  return { links: out, existing };
}

export default function AddLinks() {
  const doc = usePdfDoc(900);
  const [links, setLinks] = useState<Link[]>([]);
  const [existing, setExisting] = useState(0);
  const [scan, setScan] = useState<[number, number] | null>(null);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ bytes: Uint8Array; added: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<[number, number] | null>(null);
  // the latest box, readable from pointerup even before React re-renders
  const draftRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLinks([]); setPage(0); setSel(null); setExisting(0);
    if (!doc.bytes) return;
    findLinks(doc.bytes, (n, of) => setScan([n, of])).then((r) => { setLinks(r.links); setExisting(r.existing); setScan(null); }).catch((e) => { setError(friendlyError(e).message); setScan(null); });
  }, [doc.bytes]);
  useEffect(() => { if (sel !== null) setTimeout(() => urlInput.current?.focus({ preventScroll: true }), 80); }, [sel]);

  const upd = (id: number, p: Partial<Link>) => setLinks((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const setDraftBoth = (d: { x: number; y: number; w: number; h: number } | null) => { draftRef.current = d; setDraft(d); };
  const pt = (e: PointerEvent): [number, number] => { const r = box.current!.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  const down = (e: PointerEvent) => { e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); start.current = pt(e); setSel(null); setDraftBoth({ x: start.current[0], y: start.current[1], w: 0, h: 0 }); };
  const move = (e: PointerEvent) => { if (!start.current) return; const [x, y] = pt(e), [sx, sy] = start.current; setDraftBoth({ x: Math.min(x, sx), y: Math.min(y, sy), w: Math.abs(x - sx), h: Math.abs(y - sy) }); };
  const up = () => {
    const d = draftRef.current; start.current = null; setDraftBoth(null);
    if (!d || d.w < 0.01 || d.h < 0.008) return;
    const id = seq++;
    setLinks((l) => [...l, { id, auto: false, on: true, page, ...d, url: '' }]);
    setSel(id);
  };

  const active = links.filter((l) => l.on && (l.url?.trim() || l.toPage !== undefined));
  const run = async () => {
    if (!doc.bytes || !active.length) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      setOut(await pdfOp('addLinks', [doc.bytes.slice().buffer, active.map(({ page: p, x, y, w, h, url, toPage }) => ({ page: p, x, y, w, h, url: url?.trim() || undefined, toPage }))]));
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setLinks([]); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`${out.added} link${out.added === 1 ? '' : 's'} added!`} stats={[['Links', String(out.added)], ['Pages', String(doc.pageCount)], ['Size', formatBytes(out.bytes.length)]]}
          highlight="Readers can now click or tap them in any PDF viewer."
          onDownload={() => downloadBlob(out.bytes, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Use another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep editing</button>
        </ResultCard>
      </div>
    );
  }

  const selected = links.find((l) => l.id === sel) ?? null;
  const autos = links.filter((l) => l.auto);
  const t = doc.thumbs[page];
  const inputCls = 'h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-3';
  return (
    <div class="card space-y-4 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" hint="Web addresses and e-mails are found automatically." onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}${existing ? ` · ${existing} existing link${existing === 1 ? '' : 's'}` : ''}`} onRemove={phase === 'working' ? undefined : reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {scan && <ProgressBar label="Looking for web addresses and e-mails…" value={scan[0] / scan[1]} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}
      {doc.file && doc.pageCount > 0 && !scan && (
        <>
          {autos.length > 0 && (
            <details class="rounded-control border border-line p-3 dark:border-white/10" open={autos.length <= 8}>
              <summary class="cursor-pointer text-sm font-semibold text-ink dark:text-white">Found {autos.length} web address{autos.length === 1 ? '' : 'es'} and e-mail{autos.length === 1 ? '' : 's'} in the text · {autos.filter((a) => a.on).length} selected</summary>
              <ul class="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
                {autos.map((l) => (
                  <li key={l.id}><label class="flex min-h-9 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={l.on} onChange={() => upd(l.id, { on: !l.on })} /><span class="truncate">{l.text}</span><span class="ml-auto shrink-0 text-xs text-muted dark:text-gray-400">p. {l.page + 1}</span></label></li>
                ))}
              </ul>
            </details>
          )}
          <StickyToolbar>
            {selected ? (
              <div class="space-y-2">
                <div class="flex gap-2">
                  <input ref={urlInput} type="text" inputMode="url" value={selected.url ?? ''} placeholder="https://… or name@example.com" aria-label="Link address" class={inputCls}
                    onInput={(e) => upd(selected.id, { url: (e.target as HTMLInputElement).value, toPage: undefined })} />
                  <button type="button" class="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line text-danger dark:border-white/10" aria-label="Delete link" onClick={() => { setLinks((l) => l.filter((x) => x.id !== selected.id)); setSel(null); }}>🗑</button>
                </div>
                <label class="flex items-center gap-2 text-xs text-muted dark:text-gray-400">or jump to page
                  <input type="number" min={1} max={doc.pageCount} value={selected.toPage !== undefined ? selected.toPage + 1 : ''} class="h-9 w-20 rounded-lg border border-line bg-white px-2 text-[15px] text-ink dark:border-white/10 dark:bg-night-3 dark:text-white"
                    onInput={(e) => { const v = parseInt((e.target as HTMLInputElement).value, 10); upd(selected.id, v >= 1 && v <= doc.pageCount ? { toPage: v - 1, url: '' } : { toPage: undefined }); }} />
                </label>
              </div>
            ) : <p class="text-xs text-muted dark:text-gray-400">Drag a box over text or a picture to make it a link. Found links are shown in blue.</p>}
            {doc.pageCount > 1 && (
              <div class="flex items-center justify-end gap-1">
                <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3" disabled={page === 0} onClick={() => { setPage(page - 1); setSel(null); }} aria-label="Previous page">‹</button>
                <span class="px-1 text-xs font-semibold tabular-nums">Page {page + 1}/{doc.pageCount}</span>
                <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white dark:border-white/10 dark:bg-night-3" disabled={page >= doc.pageCount - 1} onClick={() => { setPage(page + 1); setSel(null); }} aria-label="Next page">›</button>
              </div>
            )}
          </StickyToolbar>
          <div ref={box} class="relative mx-auto w-full max-w-[720px] select-none overflow-hidden rounded-md border border-line bg-white shadow-sm dark:border-white/10" style={{ aspectRatio: `1 / ${t?.aspect ?? 1.414}`, touchAction: 'none', cursor: 'crosshair' }}
            onPointerDown={(e) => down(e as unknown as PointerEvent)} onPointerMove={(e) => move(e as unknown as PointerEvent)} onPointerUp={up} onPointerCancel={up}>
            {t?.url ? <img src={t.url} alt={`Page ${page + 1}`} draggable={false} class="pointer-events-none absolute inset-0 h-full w-full" /> : <span class="absolute inset-0 grid place-items-center"><span class="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" /></span>}
            {links.filter((l) => l.page === page && l.on).map((l) => (
              <button key={l.id} type="button" aria-label={`Link ${l.url || (l.toPage !== undefined ? `to page ${l.toPage + 1}` : '(no address yet)')}`}
                class={`absolute rounded-sm border-2 ${l.id === sel ? 'border-brand bg-brand/20' : l.url || l.toPage !== undefined ? 'border-sky-500/70 bg-sky-400/15' : 'border-dashed border-amber-500 bg-amber-300/20'}`}
                style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}
                onPointerDown={(e) => { e.stopPropagation(); setSel(l.id); }} />
            ))}
            {draft && <div class="absolute border-2 border-dashed border-brand bg-brand/10" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />}
          </div>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Adding links…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!active.length} onClick={run}>{active.length ? `Save PDF with ${active.length} link${active.length === 1 ? '' : 's'}` : 'Drag a box on the page to add a link'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
