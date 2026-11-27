import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';

interface Row { id: number; name: string; bytes: number; pages?: number; sizes?: string; landscape?: number; locked?: boolean; error?: string; }
let seq = 0;

/** Name a page size in points (portrait or landscape), allowing for rounding. */
function sizeName(w: number, h: number): string {
  const [a, b] = [Math.min(w, h), Math.max(w, h)];
  const mm = (v: number) => Math.round((v / 72) * 25.4);
  const known: [string, number, number][] = [['A4', 595.3, 841.9], ['Letter', 612, 792], ['Legal', 612, 1008], ['A3', 841.9, 1190.6], ['A5', 419.5, 595.3], ['Tabloid', 792, 1224], ['B5', 498.9, 708.7]];
  const k = known.find(([, x, y]) => Math.abs(a - x) < 4 && Math.abs(b - y) < 4);
  return k ? k[0] : `${mm(w)}×${mm(h)} mm`;
}

export default function PageCounter() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(0);

  const add = async (files: File[]) => {
    const fresh = files.map((f) => ({ id: seq++, name: f.name, bytes: f.size, file: f }));
    setRows((r) => [...r, ...fresh.map(({ file: _f, ...x }) => x)]);
    setBusy((b) => b + fresh.length);
    const [{ assertPdf, isPdfName, UserError }, { pdfOp }] = await Promise.all([import('../lib/errors'), import('../lib/pdfWorker')]);
    for (const f of fresh) {
      try {
        // password-protected files can still be counted: the page tree isn't encrypted
        if (!isPdfName(f.file)) throw new UserError(`“${f.name}” is not a PDF file.`, 'type');
        await assertPdf(f.file);
        const buf = await f.file.arrayBuffer();
        let info: { pageCount: number; encrypted: boolean };
        try { info = await pdfOp('inspect', [buf.slice(0)]); } catch { throw new UserError(`“${f.name}” looks damaged or isn’t a valid PDF.`, 'corrupt'); }
        const pdf = { pageCount: info.pageCount, encrypted: info.encrypted };
        const sizes = await pdfOp('pageSizes', [buf]).catch(() => [] as { w: number; h: number }[]);
        const names = new Map<string, number>();
        for (const s of sizes) { const n = sizeName(s.w, s.h); names.set(n, (names.get(n) ?? 0) + 1); }
        const sizeText = [...names.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => (names.size > 1 ? `${n} ×${c}` : n)).join(', ');
        setRows((r) => r.map((x) => (x.id === f.id ? { ...x, pages: pdf.pageCount, sizes: sizeText || '–', landscape: sizes.filter((s) => s.w > s.h).length, locked: pdf.encrypted } : x)));
      } catch (e) {
        setRows((r) => r.map((x) => (x.id === f.id ? { ...x, error: friendlyError(e).message } : x)));
      }
      setBusy((b) => b - 1);
    }
  };

  const ok = rows.filter((r) => r.pages !== undefined);
  const total = ok.reduce((t, r) => t + (r.pages ?? 0), 0);
  const copy = () => {
    const text = ['File\tPages\tPage size\tFile size', ...ok.map((r) => `${r.name}\t${r.pages}\t${r.sizes}\t${formatBytes(r.bytes)}`), `Total\t${total}`].join('\n');
    navigator.clipboard?.writeText(text).catch(() => {});
  };
  const csv = () => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const text = ['File,Pages,Page size,Bytes', ...ok.map((r) => [q(r.name), r.pages, q(r.sizes ?? ''), r.bytes].join(',')), `Total,${total},,`].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
    a.download = 'page-count.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <Dropzone accept="application/pdf,.pdf" multiple compact={rows.length > 0} title={rows.length ? 'Add more PDFs' : 'Drag & drop your PDFs here'} buttonLabel={rows.length ? 'Add PDFs' : 'Select PDFs'} hint={rows.length ? undefined : 'Add one file or hundreds. Pages are counted instantly.'} onFiles={add} />
      {rows.length > 0 && (
        <>
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="rounded-control bg-brand-soft p-3 dark:bg-brand/15"><p class="text-2xl font-bold tabular-nums text-brand dark:text-brand-light">{total.toLocaleString()}</p><p class="text-xs text-muted dark:text-gray-400">total pages</p></div>
            <div class="rounded-control bg-surface p-3 dark:bg-white/5"><p class="text-2xl font-bold tabular-nums">{ok.length}</p><p class="text-xs text-muted dark:text-gray-400">PDF{ok.length === 1 ? '' : 's'}</p></div>
            <div class="rounded-control bg-surface p-3 dark:bg-white/5"><p class="text-2xl font-bold tabular-nums">{formatBytes(ok.reduce((t, r) => t + r.bytes, 0))}</p><p class="text-xs text-muted dark:text-gray-400">total size</p></div>
          </div>
          {busy > 0 && <p class="text-sm text-muted dark:text-gray-400">Counting {busy} more…</p>}
          <div class="overflow-x-auto">
            <table class="w-full min-w-[480px] text-left text-sm">
              <thead><tr class="border-b border-line text-xs text-muted dark:border-white/10 dark:text-gray-400"><th class="py-2 pr-2 font-semibold">File</th><th class="py-2 pr-2 text-right font-semibold">Pages</th><th class="py-2 pr-2 font-semibold">Page size</th><th class="py-2 pr-2 text-right font-semibold">File size</th><th class="w-8" /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} class="border-b border-line/60 dark:border-white/5">
                    <td class="max-w-[14rem] truncate py-2 pr-2 font-medium" title={r.name}>{r.name}</td>
                    <td class="py-2 pr-2 text-right font-semibold tabular-nums">{r.error ? '–' : r.pages ?? '…'}</td>
                    <td class="py-2 pr-2 text-muted dark:text-gray-400">{r.error ? <span class="text-danger">{r.error}</span> : r.sizes ?? ''}{r.landscape ? ` · ${r.landscape} landscape` : ''}{r.locked ? ' · 🔒 protected' : ''}</td>
                    <td class="py-2 pr-2 text-right tabular-nums text-muted dark:text-gray-400">{formatBytes(r.bytes)}</td>
                    <td><button type="button" class="grid h-9 w-9 place-items-center text-muted hover:text-danger" aria-label={`Remove ${r.name}`} onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-secondary min-h-11 px-4 text-sm" disabled={!ok.length} onClick={copy}>Copy table</button>
            <button type="button" class="btn-secondary min-h-11 px-4 text-sm" disabled={!ok.length} onClick={csv}>Download CSV</button>
            <button type="button" class="btn-secondary min-h-11 px-4 text-sm" onClick={() => setRows([])}>Clear</button>
          </div>
        </>
      )}
      {rows.some((r) => r.error) && <ErrorBox>Some files couldn’t be counted because they are damaged or not PDFs.</ErrorBox>}
      <PrivacyNote />
    </div>
  );
}
