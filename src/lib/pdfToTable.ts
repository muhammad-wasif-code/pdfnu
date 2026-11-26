/**
 * PDF → spreadsheet rows. Text pieces are grouped into rows by baseline and into cells by the gaps
 * between them; columns come from the vertical "white rivers" through the rows (and from the table's
 * vertical rules when it has them). Wrapped lines inside a cell are joined back together. The page's
 * graphics give each cell its shading and borders, text keeps its bold/italic, colour and size,
 * row heights follow the PDF and pictures are placed at their rows.
 * Numbers such as 1,234.50, (75.00), 12% or $9.99 become real numbers you can add up.
 */
import type { WCell, WImage } from './xlsxWrite';
import type { PageGraphics } from './pdfGraphics';

export interface TItem { x0: number; x1: number; /** baseline, measured from the top */ y: number; size: number; str: string; bold?: boolean; italic?: boolean; color?: string; }
interface Chunk { x0: number; x1: number; text: string; bold: boolean; italic: boolean; size: number; color?: string; y: number; }
export interface TCell { text: string; bold: boolean; italic?: boolean; size?: number; color?: string; fill?: string; border?: { t?: string; b?: string; l?: string; r?: string }; align?: 'right' | 'center'; }
export interface TPage { rows: TCell[][]; rtl: boolean; /** height of each row in PDF points */ heights: number[]; images: { id: string; row: number; col: number; dx: number; dy: number; w: number; h: number }[]; bodySize: number; }

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/g;
const isRtl = (s: string) => (s.match(RTL)?.length ?? 0) > s.replace(/\s/g, '').length / 2;

/** Items of one row → cells (pieces closer than ~0.6 em join into one cell). */
function chunksOf(row: TItem[]): Chunk[] {
  // split pieces that use runs of spaces for alignment ("Total     1,200")
  const parts: TItem[] = [];
  for (const it of row) {
    if (!/\S\s{2,}\S|\t/.test(it.str)) { parts.push(it); continue; }
    const len = it.str.length || 1, w = it.x1 - it.x0;
    const re = /[^\s][^\t]*?(?=\s{2,}|\t|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(it.str))) parts.push({ ...it, str: m[0], x0: it.x0 + (m.index / len) * w, x1: it.x0 + ((m.index + m[0].length) / len) * w });
  }
  parts.sort((a, b) => a.x0 - b.x0);
  const out: { items: TItem[]; x0: number; x1: number; size: number }[] = [];
  for (const it of parts) {
    if (!it.str.trim()) continue;
    const cur = out[out.length - 1];
    const gap = cur ? it.x0 - cur.x1 : Infinity;
    if (cur && gap < Math.max(cur.size, it.size) * 0.6) { cur.items.push(it); cur.x1 = Math.max(cur.x1, it.x1); cur.size = Math.max(cur.size, it.size); }
    else out.push({ items: [it], x0: it.x0, x1: it.x1, size: it.size });
  }
  return out.map((c) => {
    let items = c.items;
    const joined = items.map((i) => i.str).join('');
    const reversed = isRtl(joined) && items.length > 1;
    if (reversed) items = items.slice().reverse();
    let text = '';
    items.forEach((it, k) => {
      const prev = items[k - 1];
      const gap = prev ? (reversed ? prev.x0 - it.x1 : it.x0 - prev.x1) : 0;
      const needSpace = prev && !/\s$/.test(text) && !/^\s/.test(it.str) && gap > Math.min(prev.size, it.size) * 0.12;
      text += (needSpace ? ' ' : '') + it.str;
    });
    const n = joined.length || 1;
    const share = (f: (i: TItem) => boolean | undefined) => c.items.reduce((s, i) => s + (f(i) ? i.str.length : 0), 0) > n / 2;
    const colors = new Map<string, number>();
    for (const i of c.items) if (i.color) colors.set(i.color, (colors.get(i.color) ?? 0) + i.str.length);
    const color = [...colors].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { x0: c.x0, x1: c.x1, text: text.replace(/\s+/g, ' ').trim(), bold: share((i) => i.bold), italic: share((i) => i.italic), size: c.size, color, y: Math.max(...c.items.map((i) => i.y)) };
  }).filter((c) => c.text);
}

/** Group items into rows (top to bottom) by baseline. */
function rowsOf(items: TItem[]): TItem[][] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const rows: { y: number; size: number; items: TItem[] }[] = [];
  for (const it of sorted) {
    const cur = rows[rows.length - 1];
    if (cur && Math.abs(it.y - cur.y) <= Math.min(cur.size, it.size) * 0.45) { cur.items.push(it); cur.size = Math.max(cur.size, it.size); }
    else rows.push({ y: it.y, size: it.size, items: [it] });
  }
  return rows.map((r) => r.items);
}

/** Column intervals from the rows that have two or more cells, split at the table's vertical rules. */
function columnsOf(rows: Chunk[][], vrules: number[]): [number, number][] {
  const multi = rows.filter((r) => r.length >= 2);
  const cols: [number, number][] = [];
  if (multi.length) {
    let lo = Infinity, hi = -Infinity;
    for (const r of multi) for (const c of r) { lo = Math.min(lo, c.x0); hi = Math.max(hi, c.x1); }
    const n = Math.ceil(hi - lo) + 2;
    const cov = new Int32Array(n);
    for (const r of multi) for (const c of r) { const a = Math.max(0, Math.floor(c.x0 - lo)), b = Math.min(n - 1, Math.ceil(c.x1 - lo)); for (let k = a; k <= b; k++) cov[k]++; }
    // a few long cells may bridge two columns: tolerate them
    const tol = Math.floor(multi.length * 0.08);
    let start = -1;
    for (let k = 0; k < n; k++) {
      if (cov[k] > tol) { if (start < 0) start = k; }
      else if (start >= 0) { cols.push([start + lo, k - 1 + lo]); start = -1; }
    }
    if (start >= 0) cols.push([start + lo, n - 1 + lo]);
  }
  // a ruled table: its vertical rules are the column boundaries; text-found columns outside it stay
  if (vrules.length >= 3) {
    const lo = vrules[0], hi = vrules[vrules.length - 1];
    const ruled: [number, number][] = [];
    for (let k = 0; k + 1 < vrules.length; k++) {
      const a = vrules[k], b = vrules[k + 1];
      if (b - a < 3) continue;
      if (rows.some((r) => r.some((c) => (c.x0 + c.x1) / 2 > a && (c.x0 + c.x1) / 2 < b))) ruled.push([a + 0.5, b - 0.5]);
    }
    if (ruled.length >= 2) return [...cols.filter(([a, b]) => b < lo - 1), ...ruled, ...cols.filter(([a]) => a > hi + 1)].sort((x, y) => x[0] - y[0]);
  }
  return cols;
}

const NUMERIC = /^[-−(]?\s*(?:[$€£¥₹]|Rs\.?)?\s*[\d.,]+\)?%?-?$|^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/;

/** One page's text items (and graphics) → rows of cells aligned to columns. */
export function pageTable(items: TItem[], gfx?: PageGraphics, page?: { w: number; h: number }): TPage {
  // vertical rules of the biggest ruled table on the page (rules whose heights overlap form one table)
  const vl = (gfx?.vlines ?? []).filter((l) => l.y1 - l.y0 > 8).sort((a, b) => a.y0 - b.y0);
  const clusters: { y0: number; y1: number; xs: Set<number> }[] = [];
  for (const l of vl) {
    const c = clusters.find((k) => l.y0 < k.y1 - 1 && l.y1 > k.y0 + 1);
    if (c) { c.y0 = Math.min(c.y0, l.y0); c.y1 = Math.max(c.y1, l.y1); c.xs.add(Math.round(l.x0)); }
    else clusters.push({ y0: l.y0, y1: l.y1, xs: new Set([Math.round(l.x0)]) });
  }
  const main = clusters.filter((c) => c.xs.size >= 3).sort((a, b) => b.y1 - b.y0 - (a.y1 - a.y0))[0];
  const vrules = main ? [...main.xs].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 2) : [];
  let rows = rowsOf(items).map(chunksOf).filter((r) => r.length);
  const allText = rows.flat().map((c) => c.text).join(' ');
  const rtl = isRtl(allText);
  const sizes = rows.flat().flatMap((c) => Array(Math.min(50, c.text.length)).fill(Math.round(c.size * 2) / 2)).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] ?? 10;
  let cols = columnsOf(rows, vrules);
  const single = cols.length < 2;
  if (single) {
    let lo = Infinity, hi = -Infinity;
    for (const c of rows.flat()) { lo = Math.min(lo, c.x0); hi = Math.max(hi, c.x1); }
    cols = [[isFinite(lo) ? lo : 0, isFinite(hi) ? hi : 1]];
  }
  const overlap = (c: Chunk, k: number) => Math.max(0, Math.min(c.x1, cols[k][1]) - Math.max(c.x0, cols[k][0]));
  type Row = { cells: (Chunk | null)[]; top: number; bottom: number; base: number; image?: number };
  let grid: Row[] = rows.map((r) => {
    const cells: (Chunk | null)[] = new Array(cols.length).fill(null);
    for (const c of r) {
      let best = -1;
      if (single) best = 0;
      else if (r.length === 1) {
        best = cols.findIndex(([a, b]) => c.x0 >= a - 1 && c.x0 <= b + 1);
        if (best < 0) best = cols.findIndex((_, k) => overlap(c, k) > 0);
      } else {
        // the column the text starts in; right-aligned numbers end in theirs
        const num = NUMERIC.test(c.text);
        best = num ? cols.findIndex(([a, b]) => c.x1 >= a - 1 && c.x1 <= b + 1) : cols.findIndex(([a, b]) => c.x0 >= a - 1 && c.x0 <= b + 1);
        if (best < 0) { let bestOv = 0; cols.forEach((_, k) => { const ov = overlap(c, k); if (ov > bestOv) { bestOv = ov; best = k; } }); }
      }
      if (best < 0) { const mid = (c.x0 + c.x1) / 2; let d = Infinity; cols.forEach(([a, b], k) => { const dd = Math.min(Math.abs(mid - a), Math.abs(mid - b)); if (dd < d) { d = dd; best = k; } }); }
      const prev = cells[best];
      cells[best] = prev ? { ...prev, text: rtl ? `${c.text} ${prev.text}` : `${prev.text} ${c.text}`, x0: Math.min(prev.x0, c.x0), x1: Math.max(prev.x1, c.x1), bold: prev.bold && c.bold, size: Math.max(prev.size, c.size) } : c;
    }
    const size = Math.max(...r.map((c) => c.size)), base = Math.max(...r.map((c) => c.y));
    return { cells, top: base - size * 0.85, bottom: base + size * 0.25, base };
  });

  // rows between which a horizontal rule runs
  const hl = gfx?.hlines ?? [];
  const ruleBetween = (a: Row, b: Row) => hl.some((l) => l.y0 > a.base + 0.5 && l.y0 < b.top + 0.5 && l.x1 - l.x0 > 10);

  // wrapped text: a line that only continues text cells of the row above is part of that row
  if (!single) {
    const multi = grid.filter((g) => g.cells.filter(Boolean).length >= 2);
    const pitches = multi.slice(1).map((g, i) => g.base - multi[i].base).filter((p) => p > 0).sort((a, b) => a - b);
    const pitch = pitches[Math.floor(pitches.length / 2)] ?? Infinity;
    const merged: Row[] = [];
    for (const g of grid) {
      const prev = merged[merged.length - 1];
      const filled = g.cells.map((c, k) => (c ? k : -1)).filter((k) => k >= 0);
      const ok = prev && prev.cells.filter(Boolean).length >= 2 && filled.length > 0 && filled.length < prev.cells.filter(Boolean).length &&
        filled.every((k) => { const p = prev.cells[k], c = g.cells[k]!; return p && !NUMERIC.test(p.text) && !NUMERIC.test(c.text) && Math.abs(c.x0 - p.x0) < Math.max(4, c.size) && c.bold === p.bold && Math.abs(c.size - p.size) < 0.6; }) &&
        g.base - prev.base <= (pitches.length >= 2 ? pitch * 0.92 : prev.cells.find(Boolean)!.size * 1.3) && !ruleBetween(prev, g);
      if (ok) {
        for (const k of filled) { const p = prev.cells[k]!; const c = g.cells[k]!; prev.cells[k] = { ...p, text: `${p.text} ${c.text}`.replace(/(\w)- (\w)/, '$1$2'), x1: Math.max(p.x1, c.x1) }; }
        prev.bottom = g.bottom; prev.base = g.base;
      } else merged.push(g);
    }
    grid = merged;
  }

  // pictures: beside text rows they anchor to that row; elsewhere they get a row of their own
  const pw = page?.w ?? Infinity, ph = page?.h ?? Infinity;
  const pics = (gfx?.images ?? []).filter((im) => im.x1 - im.x0 >= 8 && im.y1 - im.y0 >= 8 && (im.x1 - im.x0) * (im.y1 - im.y0) < pw * ph * 0.7);
  const seen = new Set<string>();
  pics.forEach((im, i) => {
    const k = `${im.id}|${Math.round(im.x0)}|${Math.round(im.y0)}`;
    if (seen.has(k)) return;
    seen.add(k);
    const beside = grid.some((g) => g.image === undefined && g.bottom > im.y0 && g.top < im.y1);
    if (!beside) grid.push({ cells: new Array(cols.length).fill(null), top: im.y0, bottom: im.y1, base: im.y1, image: i });
  });
  grid.sort((a, b) => a.top - b.top);

  // geometry: column edges halfway between columns; row bands halfway between rows
  const edges = [cols[0][0] - 3, ...cols.slice(1).map((c, k) => (cols[k][1] + c[0]) / 2), cols[cols.length - 1][1] + 3];
  const bandTop = (i: number) => (i === 0 ? grid[0].top - 2 : (grid[i - 1].bottom + grid[i].top) / 2);
  const bandBot = (i: number) => (i === grid.length - 1 ? grid[i].bottom + 2 : (grid[i].bottom + grid[i + 1].top) / 2);
  const out: TCell[][] = grid.map((g) => g.cells.map((c) => (c ? { text: c.text, bold: c.bold, italic: c.italic || undefined, size: c.size, color: c.color && c.color !== '000000' ? c.color : undefined } : { text: '', bold: false })));

  // alignment of text inside its column
  grid.forEach((g, i) => g.cells.forEach((c, k) => {
    if (!c || single || g.cells.filter(Boolean).length < 2) return;
    const a = cols[k][0], b = cols[k][1];
    const l = c.x0 - a, r = b - c.x1;
    if (r < -1 || l < -1) return; // runs past its column
    if (l > 3 && r > 3 && Math.abs(l - r) < 2.5) out[i][k].align = 'center';
    else if (l > 3 && r < 1.5 && !NUMERIC.test(c.text)) out[i][k].align = 'right';
  }));

  if (gfx && grid.length) {
    // shading: the smallest filled rectangle under each cell's centre
    const fills = gfx.fills.filter((f) => !/^(F[5-9A-F]){3}$/i.test(f.color) && (f.x1 - f.x0) * (f.y1 - f.y0) < pw * ph * 0.6);
    for (let i = 0; i < grid.length; i++) for (let k = 0; k < cols.length; k++) {
      const cx = (edges[k] + edges[k + 1]) / 2, cy = (bandTop(i) + bandBot(i)) / 2;
      let best: { a: number; color: string } | null = null;
      for (const f of fills) if (cx >= f.x0 && cx <= f.x1 && cy >= f.y0 && cy <= f.y1) { const a = (f.x1 - f.x0) * (f.y1 - f.y0); if (!best || a < best.a) best = { a, color: f.color }; }
      if (best) out[i][k].fill = best.color;
    }
    // borders from rules
    const setB = (i: number, k: number, side: 't' | 'b' | 'l' | 'r', color: string) => { if (out[i]?.[k]) (out[i][k].border ??= {})[side] = color; };
    for (const l of gfx.hlines) {
      let row = -1, side: 't' | 'b' = 'b';
      if (l.y0 < grid[0].top + 1) { if (l.y0 > grid[0].top - grid[0].bottom + grid[0].top - 6) { row = 0; side = 't'; } }
      else for (let i = 0; i < grid.length; i++) { if (l.y0 >= grid[i].base - 0.5 && (i === grid.length - 1 ? l.y0 < grid[i].bottom + 8 : l.y0 <= grid[i + 1].top + 1)) { row = i; side = 'b'; break; } }
      if (row < 0) continue;
      for (let k = 0; k < cols.length; k++) {
        const w = edges[k + 1] - edges[k];
        const ov = Math.min(l.x1, edges[k + 1]) - Math.max(l.x0, edges[k]);
        if (ov > w * 0.5) setB(row, k, side, l.color);
      }
    }
    for (const l of gfx.vlines) {
      // which column boundary: the gap the rule runs through (rules through text are not borders)
      const x = l.x0, n = cols.length;
      let b = -1;
      if (x <= cols[0][0] + 1) b = 0;
      else if (x >= cols[n - 1][1] - 1) b = n;
      else for (let j = 1; j < n; j++) if (x >= cols[j - 1][1] - 1 && x <= cols[j][0] + 1) { b = j; break; }
      if (b < 0) continue;
      for (let i = 0; i < grid.length; i++) {
        // the rule must run past most of the row's text, not just touch its band
        const t = grid[i].top, bt = grid[i].bottom;
        if (Math.min(l.y1, bt) - Math.max(l.y0, t) < (bt - t) * 0.6) continue;
        if (b > 0) setB(i, b - 1, 'r', l.color);
        if (b < cols.length) setB(i, b, 'l', l.color);
      }
    }
  }

  // pictures → anchors
  const images: TPage['images'] = [];
  const done = new Set<string>();
  for (const im of pics) {
    const k = `${im.id}|${Math.round(im.x0)}|${Math.round(im.y0)}`;
    if (done.has(k)) continue;
    done.add(k);
    let row = grid.findIndex((g) => g.bottom > im.y0 + 0.5);
    if (row < 0) row = grid.length - 1;
    let col = edges.findIndex((e, j) => j < cols.length && im.x0 >= e - 1 && im.x0 < edges[j + 1]);
    if (col < 0) col = im.x0 < edges[0] ? 0 : cols.length - 1;
    images.push({ id: im.id, row, col, dx: Math.max(0, im.x0 - edges[col]), dy: Math.max(0, im.y0 - bandTop(row)), w: im.x1 - im.x0, h: im.y1 - im.y0 });
  }

  const heights = grid.map((g, i) => (i < grid.length - 1 ? Math.max(1, bandTop(i + 1) - bandTop(i)) : bandBot(i) - bandTop(i)));
  // right-to-left documents: first column is the rightmost one
  const final = rtl ? out.map((r) => r.slice().reverse().map((c) => (c.border ? { ...c, border: { ...c.border, l: c.border.r, r: c.border.l } } : c))) : out;
  if (rtl) for (const im of images) im.col = cols.length - 1 - im.col;
  return { rows: final, rtl, heights, images, bodySize };
}

const CURRENCY = /^(?:(US\$|C\$|A\$|\$|€|£|¥|₹|₨|Rs\.?|PKR|INR|USD|EUR|GBP|AED|SAR)\s?)/i;
const CURRENCY_END = /\s?(US\$|\$|€|£|¥|₹|₨|Rs\.?|PKR|INR|USD|EUR|GBP|AED|SAR)$/i;

/** "1,234.50" → 1234.5 with a matching Excel format; null when it isn't a plain number. */
export function parseNumber(src: string): { v: number; fmt: string } | null {
  let s = src.trim().replace(/[−‒–]/g, '-').replace(/ /g, ' ');
  if (!s || s.length > 30) return null;
  let neg = false, paren = false, sym = '', pct = false;
  if (/^\(.*\)$/.test(s)) { neg = paren = true; s = s.slice(1, -1).trim(); }
  if (/^-/.test(s)) { neg = true; s = s.slice(1).trim(); }
  let m = CURRENCY.exec(s);
  if (m) { sym = m[1]; s = s.slice(m[0].length); }
  else if ((m = CURRENCY_END.exec(s))) { sym = m[1]; s = s.slice(0, -m[0].length); }
  if (/^-/.test(s)) { neg = true; s = s.slice(1).trim(); }
  if (/^\(.*\)$/.test(s)) { neg = paren = true; s = s.slice(1, -1).trim(); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1).trim(); }
  if (/\s?(CR|DR|Cr|Dr)$/.test(s)) return null;
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1).trim(); }
  const thousands = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s);
  if (!thousands && !/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length > 15) return null; // card / account numbers stay text
  if (/^0\d/.test(s) && !sym && !pct) return null; // IDs, codes and phone numbers with leading zeros
  let v = parseFloat(s.replace(/,/g, ''));
  if (!isFinite(v)) return null;
  const dec = (s.split('.')[1] ?? '').length;
  let base = (thousands || (sym && v >= 1000) ? '#,##0' : '0') + (dec ? '.' + '0'.repeat(dec) : '');
  if (pct) { v /= 100; base += '%'; }
  if (sym) { const q = sym.replace(/"/g, ''); base = /^[A-Z]{3}$|^Rs/i.test(q) ? `"${q} "${base}` : `"${q}"${base}`; }
  if (neg) v = -v;
  const fmt = paren ? `${base};(${base})` : base;
  return { v, fmt: fmt === '0' ? 'General' : fmt };
}

/** Rows of text cells → workbook cells (numbers converted when `numbers` is on). Font sizes are scaled so body text is 11 pt. */
export function toCells(rows: TCell[][], numbers: boolean, bodySize = 11): (WCell | null)[][] {
  const k = 11 / (bodySize || 11);
  return rows.map((r) => r.map((c) => {
    const style: Partial<WCell> = {};
    if (c.bold) style.b = true;
    if (c.italic) style.i = true;
    // light text whose background wasn't a table cell (e.g. a rounded badge) would be invisible: keep it dark
    const light = (h: string) => { const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2] > 0.8; };
    if (c.color && !(light(c.color) && !c.fill)) style.color = c.color;
    if (c.fill) style.fill = c.fill;
    if (c.border && Object.values(c.border).some(Boolean)) style.border = c.border;
    if (c.align) style.align = c.align;
    if (c.size) { const sz = Math.round(c.size * k * 2) / 2; if (Math.abs(sz - 11) >= 1) style.sz = Math.max(6, Math.min(48, sz)); }
    if (!c.text) return Object.keys(style).length ? { v: '', ...style } : null;
    const n = numbers ? parseNumber(c.text) : null;
    return n ? { v: n.v, fmt: n.fmt, ...style, align: style.align === 'center' ? 'center' : undefined } : { v: c.text, ...style };
  }));
}

/** Pages → one sheet's rows, heights and pictures (rows of all pages one after another). */
export function stackPages(pages: TPage[], numbers: boolean, png: Map<string, { bytes: Uint8Array; w: number; h: number }>, pageKey = (_p: number, id: string) => id) {
  const body = pages.map((p) => p.bodySize).sort((a, b) => a - b)[Math.floor(pages.length / 2)] ?? 11;
  const k = 11 / (body || 11);
  const rows: (WCell | null)[][] = [], heights: (number | undefined)[] = [], images: WImage[] = [];
  pages.forEach((p, pi) => {
    const off = rows.length;
    rows.push(...toCells(p.rows, numbers, body));
    // keep the PDF's spacing; very large gaps are capped
    heights.push(...p.heights.map((h) => Math.max(12.75, Math.min(160, h * k))));
    for (const im of p.images) {
      const img = png.get(pageKey(pi, im.id));
      if (img) images.push({ bytes: img.bytes, row: off + im.row, col: im.col, dx: im.dx * k, dy: im.dy * k, w: im.w * k, h: im.h * k });
    }
  });
  return { rows, heights, images, rtl: pages.filter((p) => p.rtl).length > pages.length / 2 };
}

/** pdf.js text content → items (viewport coordinates, top-down). `style(fontName)` gives bold/italic; `colors` from pdfGraphics. */
export function itemsFromTextContent(tc: any, viewport: any, style?: (fontName: string) => { b: boolean; i: boolean } | boolean, colors?: (string | undefined)[]): TItem[] {
  const out: TItem[] = [];
  const list = (tc.items as any[]).filter((it) => typeof it.str === 'string');
  list.forEach((it, idx) => {
    if (!it.str.trim()) return;
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 10;
    const len = Math.hypot(a, b) || 1;
    const w = it.width ?? 0;
    const p0 = viewport.convertToViewportPoint(e, f);
    const p1 = viewport.convertToViewportPoint(e + (a / len) * w, f + (b / len) * w);
    const st = style?.(it.fontName);
    const bold = typeof st === 'boolean' ? st : st?.b, italic = typeof st === 'object' ? st.i : undefined;
    const color = colors?.[idx];
    if (Math.abs(p1[1] - p0[1]) > Math.abs(p1[0] - p0[0]) + 1) {
      // vertical text (rotated headers, margin notes): keep it, placed where it starts
      const x = Math.min(p0[0], p1[0]);
      out.push({ x0: x - size * 0.8, x1: x + size * 0.2, y: Math.max(p0[1], p1[1]), size, str: it.str, bold, italic, color });
      return;
    }
    out.push({ x0: Math.min(p0[0], p1[0]), x1: Math.max(p0[0], p1[0]), y: p0[1], size, str: it.str, bold, italic, color });
  });
  return out;
}
