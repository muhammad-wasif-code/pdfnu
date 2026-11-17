import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { StickyActions } from '../components/ui/Sticky';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { Op } from '../lib/diff';

interface Side { file: File; pages: string[][] }
interface Change { pageA: number; pageB: number; before: string[]; del: string[]; ins: string[]; after: string[] }
const CTX = 8;
/** Long blocks are shortened on screen (the downloaded report keeps everything). */
const clip = (w: string[]) => (w.length > 60 ? `${w.slice(0, 40).join(' ')} … [${w.length - 50} more words] … ${w.slice(-10).join(' ')}` : w.join(' '));

async function readWords(file: File, onPage: (n: number, of: number) => void): Promise<string[][]> {
  const { readPdf } = await import('../lib/pdfFile');
  const { openPdf } = await import('../lib/pdfjs');
  const { words } = await import('../lib/diff');
  const pdf = await readPdf(file);
  const doc = await openPdf(pdf.bytes.slice());
  const out: string[][] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onPage(n, doc.numPages);
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      out.push(words((tc.items as any[]).map((i) => (typeof i.str === 'string' ? i.str + (i.hasEOL ? '\n' : '') : '')).join(' ')));
      page.cleanup();
    }
  } finally { await doc.destroy(); }
  return out;
}

/** Turn diff ops into change blocks with a little context and page numbers. */
function blocks(ops: Op[], pageOfA: number[], pageOfB: number[]): Change[] {
  const res: Change[] = [];
  let ia = 0, ib = 0;
  const flatA: string[] = [];
  ops.forEach((o) => { if (o.t !== 'ins') flatA.push(...o.v); });
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.t === 'eq') { ia += o.v.length; ib += o.v.length; continue; }
    const del: string[] = [], ins: string[] = [];
    const startA = ia, startB = ib;
    while (i < ops.length && ops[i].t !== 'eq') {
      if (ops[i].t === 'del') { del.push(...ops[i].v); ia += ops[i].v.length; } else { ins.push(...ops[i].v); ib += ops[i].v.length; }
      i++;
    }
    i--;
    const next = ops[i + 1];
    res.push({
      pageA: pageOfA[Math.min(startA, pageOfA.length - 1)] ?? 0, pageB: pageOfB[Math.min(startB, pageOfB.length - 1)] ?? 0,
      before: flatA.slice(Math.max(0, startA - CTX), startA), del, ins, after: next?.t === 'eq' ? next.v.slice(0, CTX) : [],
    });
  }
  return res;
}

export default function ComparePdf() {
  const [a, setA] = useState<Side | null>(null);
  const [b, setB] = useState<Side | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [changes, setChanges] = useState<Change[]>([]);
  const [stats, setStats] = useState({ added: 0, removed: 0 });
  const [error, setError] = useState<string | null>(null);

  const load = (which: 'a' | 'b') => async (files: File[]) => {
    setError(null); setPhase('edit');
    try {
      const f = files[0];
      const pages = await readWords(f, (n, of) => setLoading(`Reading ${which === 'a' ? 'original' : 'new version'}: page ${n} of ${of}…`));
      (which === 'a' ? setA : setB)({ file: f, pages });
    } catch (e) { setError(friendlyError(e).message); }
    finally { setLoading(null); }
  };

  const run = async () => {
    if (!a || !b) return;
    setPhase('working'); setError(null);
    await new Promise((r) => setTimeout(r, 30)); // let the progress bar paint
    try {
      const { diff } = await import('../lib/diff');
      const flat = (s: Side) => { const w: string[] = [], p: number[] = []; s.pages.forEach((pg, i) => pg.forEach((x) => { w.push(x); p.push(i); })); return { w, p }; };
      const A = flat(a), B = flat(b);
      if (!A.w.length || !B.w.length) throw new Error(`${!A.w.length ? a.file.name : b.file.name} has no text layer (it may be a scan), so there is nothing to compare.`);
      const all = diff(A.w, B.w, 3000);
      let res: Change[];
      if (all) res = blocks(all, A.p, B.p);
      else {
        // very different documents: compare page by page instead
        res = [];
        const n = Math.max(a.pages.length, b.pages.length);
        for (let i = 0; i < n; i++) {
          const pa = a.pages[i] ?? [], pb = b.pages[i] ?? [];
          const ops = diff(pa, pb, 2000) ?? [{ t: 'del', v: pa }, { t: 'ins', v: pb }] as Op[];
          res.push(...blocks(ops, pa.map(() => i), pb.map(() => i)));
        }
      }
      setStats({ added: res.reduce((s, c) => s + c.ins.length, 0), removed: res.reduce((s, c) => s + c.del.length, 0) });
      setChanges(res);
      setPhase('done');
    } catch (e) { setError(e instanceof Error && /no text layer/.test(e.message) ? e.message : friendlyError(e).message); setPhase('edit'); }
  };

  const report = () => {
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
    const rows = changes.map((c, i) => `<section><h3>Change ${i + 1} · page ${c.pageA + 1} → ${c.pageB + 1}</h3><p>…${esc(c.before.join(' '))} ${c.del.length ? `<del>${esc(c.del.join(' '))}</del>` : ''} ${c.ins.length ? `<ins>${esc(c.ins.join(' '))}</ins>` : ''} ${esc(c.after.join(' '))}…</p></section>`).join('\n');
    const html = `<!doctype html><meta charset="utf-8"><title>Comparison: ${esc(a!.file.name)} vs ${esc(b!.file.name)}</title><style>body{font:15px/1.6 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#111}del{background:#fee2e2;color:#991b1b}ins{background:#dcfce7;color:#166534;text-decoration:none}h3{font-size:13px;color:#555;margin:1.5rem 0 .25rem}</style><h1>PDF comparison</h1><p><b>Original:</b> ${esc(a!.file.name)}<br><b>New:</b> ${esc(b!.file.name)}<br>${changes.length} changes · ${stats.removed} words removed · ${stats.added} words added</p>${rows || '<p>No text differences found.</p>'}<p style="color:#777;font-size:12px">Made with PDFSherpa, compared on your device.</p>`;
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `compare-${stripExt(a!.file.name)}.html`, 'text/html');
  };

  const side = (label: string, s: Side | null, which: 'a' | 'b') => (
    <div class="space-y-2">
      <p class="text-sm font-semibold text-ink dark:text-white">{label}</p>
      {s ? <FileRow name={s.file.name} size={`${s.pages.length} pages · ${formatBytes(s.file.size)}`} onRemove={phase === 'working' ? undefined : () => { (which === 'a' ? setA : setB)(null); setPhase('edit'); }} />
        : <Dropzone accept="application/pdf,.pdf" title={which === 'a' ? 'Drop the original PDF' : 'Drop the new version'} buttonLabel="Select PDF" onFiles={load(which)} />}
    </div>
  );

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <div class="grid gap-4 md:grid-cols-2">
        {side('1. Original', a, 'a')}
        {side('2. New version', b, 'b')}
      </div>
      {loading && <ProgressBar label={loading} value={null} />}
      {error && <ErrorBox onRetry={() => setError(null)}>{error}</ErrorBox>}

      {phase === 'done' && (
        <div class="space-y-4">
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="rounded-control bg-surface p-3 dark:bg-white/5"><div class="text-xl font-bold">{changes.length}</div><div class="text-xs text-muted dark:text-gray-400">changes</div></div>
            <div class="rounded-control bg-red-50 p-3 dark:bg-red-500/10"><div class="text-xl font-bold text-red-700 dark:text-red-300">−{stats.removed}</div><div class="text-xs text-muted dark:text-gray-400">words removed</div></div>
            <div class="rounded-control bg-green-50 p-3 dark:bg-green-500/10"><div class="text-xl font-bold text-green-700 dark:text-green-300">+{stats.added}</div><div class="text-xs text-muted dark:text-gray-400">words added</div></div>
          </div>
          {changes.length === 0 ? <p class="rounded-control bg-green-50 p-4 text-center font-semibold text-green-800 dark:bg-green-500/10 dark:text-green-200">✓ The text of both PDFs is identical.</p> : (
            <ol class="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {changes.slice(0, 500).map((c, i) => (
                <li key={i} class="rounded-control border border-line p-3 text-[15px] leading-7 dark:border-white/10">
                  <div class="mb-1 text-xs font-semibold text-muted dark:text-gray-400">#{i + 1} · page {c.pageA + 1}{c.pageA !== c.pageB ? ` → ${c.pageB + 1}` : ''}</div>
                  <span class="text-gray-600 dark:text-gray-400">…{c.before.join(' ')} </span>
                  {c.del.length > 0 && <del class="rounded bg-red-100 px-0.5 text-red-800 dark:bg-red-500/20 dark:text-red-200">{clip(c.del)}</del>}{' '}
                  {c.ins.length > 0 && <ins class="rounded bg-green-100 px-0.5 text-green-800 no-underline dark:bg-green-500/20 dark:text-green-200">{clip(c.ins)}</ins>}
                  <span class="text-gray-600 dark:text-gray-400"> {c.after.join(' ')}…</span>
                </li>
              ))}
              {changes.length > 500 && <li class="text-center text-sm text-muted">…and {changes.length - 500} more in the downloadable report.</li>}
            </ol>
          )}
          <button type="button" class="btn-secondary min-h-12 w-full" onClick={report}>Download report (.html)</button>
        </div>
      )}

      {a && b && phase !== 'done' && (
        <StickyActions>
          {phase === 'working' ? <ProgressBar label="Comparing…" value={null} /> : (
            <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Compare PDFs</button>
          )}
        </StickyActions>
      )}
      <PrivacyNote />
    </div>
  );
}
