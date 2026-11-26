/**
 * Excel (.xlsx) / CSV → PDF in the browser. Lays sheets out on pages the way Excel prints them:
 * column widths, row heights, fonts and rich text, fills, borders, alignment and rotation, wrapped and
 * overflowing text, merged cells, conditional formatting (colours, data bars, icon sets), pictures,
 * shapes and text boxes, charts and chart sheets, print areas, repeated title rows, page breaks,
 * headers and footers. Text stays selectable (pdf-lib + the multilingual text engine).
 */
import {
  PDFDocument, type PDFImage, type PDFOperator, rectangle, fill, stroke, moveTo, lineTo, closePath, appendBezierCurve, setFillingRgbColor, setStrokingRgbColor,
  setLineWidth, setDashPattern, clip, endPath, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, fillAndStroke,
} from 'pdf-lib';
import { TextEngine, familyFor, pageKeyer, strongDir, type TextStyle, type Keyer } from './textEngine';
import type { XWorkbook, XSheet, XCellData, XFont, XEdge, XObj, XChartObj } from './xlsxRead';
import { drawShape, shapeTexts } from './xlsxDrawing';
import { drawChart, chartTexts } from './xlsxChart';
import { iconFor } from './xlsxCf';
import { themeFrom, type Theme } from './xlsxColor';

export type Paper = 'auto' | 'a4' | 'letter';
export type Orientation = 'auto' | 'portrait' | 'landscape';
export type Fit = 'width' | 'actual' | 'page';
export interface XlsxPdfOptions {
  /** indices into workbook.sheets; default: every visible sheet */
  sheets?: number[];
  paper?: Paper; orientation?: Orientation; fit?: Fit;
  /** 'auto': as Excel prints (print setting), or for plain lists that have no borders of their own */
  gridlines?: boolean | 'auto';
  title?: string; fileName?: string;
  fetchFont?: (url: string) => Promise<Uint8Array | null>;
  onProgress?: (done: number, of: number) => void;
}
export interface XlsxPdfResult { pdf: Uint8Array; pages: number; sheets: number; skippedObjects: number; missingGlyphs: number; }

const PAPERS: Record<number, [number, number]> = { 1: [612, 792], 3: [792, 1224], 5: [612, 1008], 8: [841.89, 1190.55], 9: [595.28, 841.89], 11: [419.53, 595.28], 13: [515.91, 728.5] };
const PAD = 2.25; // ≈ 3px cell padding
const LINE = 1.22; // Calibri line height / font size

const hex = (h: string): [number, number, number] => [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
const styleOf = (f: XFont): TextStyle => ({ family: familyFor(f.name), bold: f.b, italic: f.i });

interface Merge { r0: number; c0: number; r1: number; c1: number; }
interface Seg { text: string; font: XFont; }
interface Plan {
  sheet: XSheet; r0: number; r1: number; c0: number; c1: number;
  colX: number[]; rowY: number[]; // prefix sums relative to (r0, c0), length n+1
  merges: Merge[]; mergeAt: Map<number, Merge>;
  pageW: number; pageH: number; m: { l: number; r: number; t: number; b: number; header: number; footer: number };
  scale: number; bands: [number, number][]; chunks: [number, number][];
  titleRows?: [number, number]; titleCols?: [number, number];
}

const key = (r: number, c: number) => r * 16384 + c;
const cellText = (c: XCellData) => (c.style.wrap ? c.text : c.text.replace(/\r?\n/g, ' '));

/** Excel header/footer codes → left/centre/right strings. */
function hfParts(src: string | undefined, vars: { page: number; pages: number; sheet: string; file: string }): [string, string, string] {
  const out: [string, string, string] = ['', '', ''];
  if (!src) return out;
  let sec = 1;
  const now = new Date();
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== '&') { out[sec] += ch; continue; }
    const n = src[++i];
    if (n === undefined) break;
    if (n === 'L') sec = 0; else if (n === 'C') sec = 1; else if (n === 'R') sec = 2;
    else if (n === 'P') { let add = 0; const m = /^([+-]\d+)/.exec(src.slice(i + 1)); if (m) { add = +m[1]; i += m[1].length; } out[sec] += String(vars.page + add); }
    else if (n === 'N') out[sec] += String(vars.pages);
    else if (n === 'A') out[sec] += vars.sheet;
    else if (n === 'F') out[sec] += vars.file;
    else if (n === 'Z') { /* path: not known */ }
    else if (n === 'D') out[sec] += now.toLocaleDateString();
    else if (n === 'T') out[sec] += now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    else if (n === '&') out[sec] += '&';
    else if (n === '"') { const e = src.indexOf('"', i + 1); i = e < 0 ? src.length : e; }
    else if (n === 'K') i += 6;
    else if (/\d/.test(n)) { while (/\d/.test(src[i + 1] ?? '')) i++; }
  }
  return out.map((s) => s.trim()) as [string, string, string];
}

function edgeStyle(e: XEdge): { w: number; dash: number[]; double: boolean } {
  switch (e.style) {
    case 'hair': return { w: 0.25, dash: [], double: false };
    case 'medium': return { w: 1.1, dash: [], double: false };
    case 'thick': return { w: 1.75, dash: [], double: false };
    case 'double': return { w: 0.4, dash: [], double: true };
    case 'dashed': return { w: 0.5, dash: [3, 1.5], double: false };
    case 'dotted': return { w: 0.5, dash: [0.75, 0.75], double: false };
    case 'mediumDashed': return { w: 1.1, dash: [4, 2], double: false };
    case 'dashDot': return { w: 0.5, dash: [3, 1, 1, 1], double: false };
    case 'mediumDashDot': case 'slantDashDot': return { w: 1.1, dash: [4, 1.5, 1.5, 1.5], double: false };
    case 'dashDotDot': return { w: 0.5, dash: [3, 1, 1, 1, 1, 1], double: false };
    case 'mediumDashDotDot': return { w: 1.1, dash: [4, 1.5, 1.5, 1.5, 1.5, 1.5], double: false };
    default: return { w: 0.5, dash: [], double: false }; // thin
  }
}

/** The font a cell is drawn with, after conditional formatting. */
function cellFont(cell: XCellData, f: XFont = cell.style.font): XFont {
  const cf = cell.cf;
  if (!cf) return f;
  return { ...f, color: cf.color ?? f.color, b: cf.b ?? f.b, i: cf.i ?? f.i, u: cf.u ?? f.u, strike: cf.strike ?? f.strike };
}
function segsOf(cell: XCellData): Seg[] {
  const wrap = cell.style.wrap;
  const fix = (t: string) => (wrap ? t : t.replace(/\r?\n/g, ' '));
  if (cell.runs?.length && cell.kind === 's') return cell.runs.map((r) => ({ text: fix(r.text), font: cellFont(cell, r.font) })).filter((s) => s.text);
  return [{ text: fix(cell.text), font: cellFont(cell) }];
}

type Piece = { text: string; font: XFont; w: number };
type Line = { pieces: Piece[]; w: number; size: number };
function layoutSegs(te: TextEngine, segs: Seg[], width: number, wrap: boolean, shrink = 1): Line[] {
  const lines: Line[] = [];
  let cur: Line = { pieces: [], w: 0, size: 0 };
  const sz = (f: XFont) => f.sz * shrink;
  const push = () => { if (!cur.size) cur.size = sz(segs[0]?.font ?? { sz: 11 } as XFont); lines.push(cur); cur = { pieces: [], w: 0, size: 0 }; };
  const add = (text: string, font: XFont, w: number) => {
    const last = cur.pieces[cur.pieces.length - 1];
    if (last && last.font === font) { last.text += text; last.w += w; } else cur.pieces.push({ text, font, w });
    cur.w += w; cur.size = Math.max(cur.size, sz(font));
  };
  for (const s of segs) {
    const st = styleOf(s.font);
    for (const part of s.text.split(/(\n)/)) {
      if (part === '\n') { push(); continue; }
      if (!part) continue;
      const words = wrap ? part.split(/(?<=\s)/) : [part];
      for (const w of words) {
        const ww = te.measure(w, st, sz(s.font));
        if (wrap && cur.pieces.length && cur.w + te.measure(w.trimEnd(), st, sz(s.font)) > width) push();
        if (wrap && ww > width && [...w.trim()].length > 1) { // a word wider than the cell: break it by characters
          let chunk = '';
          for (const ch of w) {
            if (chunk && cur.w + te.measure(chunk + ch, st, sz(s.font)) > width) { add(chunk, s.font, te.measure(chunk, st, sz(s.font))); push(); chunk = ''; }
            chunk += ch;
          }
          if (chunk) add(chunk, s.font, te.measure(chunk, st, sz(s.font)));
          continue;
        }
        add(w, s.font, ww);
      }
    }
  }
  if (cur.pieces.length || !lines.length) push();
  // trailing spaces don't count
  for (const l of lines) { const last = l.pieces[l.pieces.length - 1]; if (last && /\s$/.test(last.text)) { const t = last.text.trimEnd(); const nw = te.measure(t, styleOf(last.font), sz(last.font)); l.w -= last.w - nw; last.text = t; last.w = nw; } }
  return lines;
}

const K = 0.5523;
function iconOps(kind: string, color: string, x: number, y: number, s: number): PDFOperator[] {
  const o: PDFOperator[] = [setFillingRgbColor(...hex(color)), setStrokingRgbColor(...hex(color))];
  const cx = x + s / 2, cy = y + s / 2, r = s / 2;
  const circle = (rr: number) => o.push(moveTo(cx + rr, cy), appendBezierCurve(cx + rr, cy + rr * K, cx + rr * K, cy + rr, cx, cy + rr), appendBezierCurve(cx - rr * K, cy + rr, cx - rr, cy + rr * K, cx - rr, cy), appendBezierCurve(cx - rr, cy - rr * K, cx - rr * K, cy - rr, cx, cy - rr), appendBezierCurve(cx + rr * K, cy - rr, cx + rr, cy - rr * K, cx + rr, cy), closePath());
  const arrow = (ang: number) => {
    const pts: [number, number][] = [[0, 0.5], [0.45, 0.05], [0.18, 0.05], [0.18, -0.5], [-0.18, -0.5], [-0.18, 0.05], [-0.45, 0.05]];
    const a = (ang * Math.PI) / 180;
    pts.forEach(([px, py], i) => { const X = cx + (px * Math.cos(a) - py * Math.sin(a)) * s, Y = cy + (px * Math.sin(a) + py * Math.cos(a)) * s; o.push(i ? lineTo(X, Y) : moveTo(X, Y)); });
    o.push(closePath(), fill());
  };
  switch (kind) {
    case 'up': arrow(0); break; case 'down': arrow(180); break; case 'side': arrow(-90); break; case 'upright': arrow(-45); break; case 'downright': arrow(-135); break;
    case 'dash': o.push(rectangle(x + s * 0.15, cy - s * 0.12, s * 0.7, s * 0.24), fill()); break;
    case 'diamond': o.push(moveTo(cx, y + s), lineTo(x + s, cy), lineTo(cx, y), lineTo(x, cy), closePath(), fill()); break;
    case 'triangle': o.push(moveTo(cx, y + s), lineTo(x + s, y), lineTo(x, y), closePath(), fill()); break;
    case 'flag': o.push(setLineWidth(s * 0.08), moveTo(x + s * 0.2, y), lineTo(x + s * 0.2, y + s), stroke(), moveTo(x + s * 0.2, y + s), lineTo(x + s * 0.9, y + s * 0.75), lineTo(x + s * 0.2, y + s * 0.5), closePath(), fill()); break;
    case 'check': case 'cross': case 'excl':
      circle(r); o.push(fill(), setStrokingRgbColor(1, 1, 1), setFillingRgbColor(1, 1, 1), setLineWidth(s * 0.12));
      if (kind === 'check') o.push(moveTo(x + s * 0.27, cy), lineTo(x + s * 0.45, y + s * 0.3), lineTo(x + s * 0.75, y + s * 0.7), stroke());
      else if (kind === 'cross') o.push(moveTo(x + s * 0.3, y + s * 0.3), lineTo(x + s * 0.7, y + s * 0.7), moveTo(x + s * 0.3, y + s * 0.7), lineTo(x + s * 0.7, y + s * 0.3), stroke());
      else o.push(moveTo(cx, y + s * 0.78), lineTo(cx, y + s * 0.42), stroke(), rectangle(cx - s * 0.06, y + s * 0.2, s * 0.12, s * 0.12), fill());
      break;
    default:
      if (kind.startsWith('star')) {
        const lvl = +kind.slice(4);
        const pts: [number, number][] = [];
        for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5; const rr = i % 2 ? r * 0.4 : r; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
        const path = () => { pts.forEach(([X, Y], i) => o.push(i ? lineTo(X, Y) : moveTo(X, Y))); o.push(closePath()); };
        path(); o.push(setLineWidth(0.5), lvl === 2 ? fillAndStroke() : stroke());
        if (lvl === 1) { o.push(pushGraphicsState(), rectangle(x, y, s / 2, s), clip(), endPath()); path(); o.push(fill(), popGraphicsState()); }
      } else if (kind.startsWith('rating')) {
        const [i, n] = kind.slice(6).split('/').map(Number);
        const bars = 4;
        for (let b = 0; b < bars; b++) { const lit = n ? (b + 1) / bars <= i / n + 1e-9 : false; const bh = s * (0.3 + (0.7 * (b + 1)) / bars); o.push(setFillingRgbColor(...hex(lit ? color : 'D9D9D9')), rectangle(x + (b * s) / bars + 0.5, y, s / bars - 1, bh), fill()); }
      } else { circle(r * 0.9); o.push(fill()); }
  }
  return o;
}

export async function xlsxToPdf(wb: XWorkbook, opts: XlsxPdfOptions = {}): Promise<XlsxPdfResult> {
  const doc = await PDFDocument.create();
  const te = await TextEngine.create(doc, opts.fetchFont);
  const theme: Theme = wb.theme ?? themeFrom(null);
  const which = (opts.sheets ?? wb.sheets.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0)).filter((i) => wb.sheets[i]);
  const gridOpt = opts.gridlines ?? 'auto';
  const autoGrid = (s: XSheet) => {
    if (s.gridLines) return true;
    if (!s.showGrid) return false;
    for (const row of s.cells.values()) for (const c of row.values()) { const b = c.style.border; if (b.l || b.r || b.t || b.b) return false; }
    return true;
  };
  let skipped = 0;

  // 1) every string that will be drawn → load its fonts once
  const calibri: TextStyle = { family: 'calibri' };
  const texts: { text: string; style: TextStyle }[] = [{ text: '#0123456789 Page of', style: calibri }];
  for (const i of which) {
    const s = wb.sheets[i];
    for (const row of s.cells.values()) for (const c of row.values()) if (c.text) { for (const g of segsOf(c)) texts.push({ text: g.text, style: styleOf(g.font) }); if (c.kind === 'n') texts.push({ text: '#', style: styleOf(c.style.font) }); }
    for (const t of [s.header, s.footer, s.firstHeader, s.firstFooter, s.evenHeader, s.evenFooter]) if (t) texts.push({ text: hfParts(t, { page: 1, pages: 1, sheet: s.name, file: opts.fileName ?? '' }).join(' '), style: calibri });
    for (const o of [...s.objects, ...(s.chartPage ? [s.chartPage] : [])]) {
      if (o.kind === 'shape') texts.push(...shapeTexts(o));
      if (o.kind === 'chart') for (const t of chartTexts(o.spec)) texts.push({ text: t, style: calibri }, { text: t, style: { family: 'calibri', bold: true } });
    }
  }
  await te.prepare(texts);

  // embedded pictures (once per image)
  const imgCache = new Map<Uint8Array, PDFImage | null>();
  for (const i of which) for (const o of wb.sheets[i].objects) {
    if (o.kind !== 'pic' || imgCache.has(o.bytes)) continue;
    let img: PDFImage | null = null;
    try { img = o.type === 'png' ? await doc.embedPng(o.bytes) : await doc.embedJpg(o.bytes); } catch { img = null; skipped++; }
    imgCache.set(o.bytes, img);
  }

  const pageSize = (s: XSheet): [number, number] => (opts.paper === 'a4' ? PAPERS[9] : opts.paper === 'letter' ? PAPERS[1] : PAPERS[s.paper ?? 9] ?? PAPERS[9]);
  const defMargins = { l: 0.7 * 72, r: 0.7 * 72, t: 0.75 * 72, b: 0.75 * 72, header: 0.3 * 72, footer: 0.3 * 72 };

  // 2) plan every sheet (range, sizes, scale, page grid)
  type Job = { kind: 'chart'; sheet: XSheet; chart: XChartObj } | { kind: 'cells'; plan: Plan };
  const jobs: Job[] = [];
  for (const i of which) {
    const s = wb.sheets[i];
    skipped += s.skipped;
    if (s.chartPage) { jobs.push({ kind: 'chart', sheet: s, chart: s.chartPage }); continue; }
    const colWOf = (c: number) => (s.hiddenCols.has(c) ? 0 : s.colW[c] ?? s.defColW);
    const rowHOf = (r: number) => (s.hiddenRows.has(r) ? 0 : s.rowH.get(r) ?? s.defRowH);
    // where an object ends, in cells
    const endOf = (o: XObj) => {
      if (o.w === undefined || o.h === undefined) return { r: o.r1, c: o.c1 };
      let x = o.dx0 + o.w, c = o.c0; while (c < 16383 && x > colWOf(c) && c - o.c0 < 500) { x -= colWOf(c); c++; }
      let y = o.dy0 + o.h, r = o.r0; while (r < 1048575 && y > rowHOf(r) && r - o.r0 < 2000) { y -= rowHOf(r); r++; }
      return { r, c };
    };
    // printed range: real content (cells with text, fill or borders, merges, drawings), not conditional-format-only cells
    let r1 = -1, c1 = -1;
    for (const [r, row] of s.cells) for (const [c, cell] of row) { const b = cell.style.border; if (cell.text || cell.style.fill || b.l || b.r || b.t || b.b || b.d) { r1 = Math.max(r1, r); c1 = Math.max(c1, c); } }
    for (const m of s.merges) if (s.cells.get(m.r0)?.get(m.c0)?.text) { r1 = Math.max(r1, m.r1); c1 = Math.max(c1, m.c1); }
    for (const o of s.objects) { const e = endOf(o); r1 = Math.max(r1, e.r); c1 = Math.max(c1, e.c); }
    if (r1 < 0 && !s.printArea) continue;
    let r0 = 0, c0 = 0;
    if (s.printArea) ({ r0, c0, r1, c1 } = s.printArea);
    const colX = [0];
    for (let c = c0; c <= c1; c++) colX.push(colX[colX.length - 1] + colWOf(c));
    const merges = s.merges.filter((m) => m.r1 >= r0 && m.r0 <= r1 && m.c1 >= c0 && m.c0 <= c1);
    const mergeAt = new Map<number, Merge>();
    for (const m of merges) for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) mergeAt.set(key(r, c), m);
    // row heights: stored, or grown to fit wrapped / large text like Excel's auto-fit
    const rowY = [0];
    for (let r = r0; r <= r1; r++) {
      let h = rowHOf(r);
      if (h && !s.rowH.has(r)) {
        const row = s.cells.get(r);
        if (row) for (const [c, cell] of row) {
          if (!cell.text || c < c0 || c > c1 || mergeAt.has(key(r, c))) continue;
          const lines = layoutSegs(te, segsOf(cell), Math.max(4, colWOf(c) - 2 * PAD), cell.style.wrap);
          let need = lines.reduce((t, l) => t + l.size * LINE, 0) + 2 * PAD;
          if (cell.style.rot && cell.style.rot !== 255) need = Math.max(need, Math.abs(Math.sin(((cell.style.rot > 90 ? cell.style.rot - 90 : cell.style.rot) * Math.PI) / 180)) * lines[0].w + 2 * PAD);
          if (cell.style.rot === 255) need = Math.max(need, [...cell.text].length * cell.style.font.sz * 1.1 + 2 * PAD);
          h = Math.max(h, Math.min(409, need));
        }
      }
      rowY.push(rowY[rowY.length - 1] + h);
    }
    const totalW = colX[colX.length - 1], totalH = rowY[rowY.length - 1];
    if (!totalW || !totalH) continue;

    const m = s.margins ?? defMargins;
    let [pw, ph] = pageSize(s);
    const fit = opts.fit ?? 'width';
    let landscape: boolean;
    if (opts.orientation === 'landscape') landscape = true;
    else if (opts.orientation === 'portrait') landscape = false;
    else landscape = s.landscape ?? (totalW > pw - m.l - m.r + 1 && (fit !== 'page' || totalW > totalH));
    if (landscape) [pw, ph] = [ph, pw];
    const W = pw - m.l - m.r, H = ph - m.t - m.b;
    let scale = fit === 'actual'
      ? (s.fitToPage && (s.fitW || s.fitH) ? Math.min(s.fitW ? (W * s.fitW) / totalW : 4, s.fitH ? (H * s.fitH) / totalH : 4, 1) : s.scale ? s.scale / 100 : 1)
      : fit === 'page' ? Math.min(1, W / totalW, H / totalH) : Math.min(1, W / totalW);
    scale = Math.max(0.1, Math.min(4, scale));

    // repeated title rows / columns (inside the printed range)
    const titleRows = s.repeatRows && s.repeatRows[0] >= r0 && s.repeatRows[1] <= r1 && fit !== 'page' ? ([s.repeatRows[0] - r0, s.repeatRows[1] - r0] as [number, number]) : undefined;
    const titleCols = s.repeatCols && s.repeatCols[0] >= c0 && s.repeatCols[1] <= c1 && fit === 'actual' ? ([s.repeatCols[0] - c0, s.repeatCols[1] - c0] as [number, number]) : undefined;
    const tH = titleRows ? (rowY[titleRows[1] + 1] - rowY[titleRows[0]]) * scale : 0;
    const tW = titleCols ? (colX[titleCols[1] + 1] - colX[titleCols[0]]) * scale : 0;

    // page grid: column bands across, row chunks down (Excel's "down, then over"), honouring manual breaks
    const split = (pre: number[], avail: number, breaks: Set<number>, offset: number, title?: [number, number], titleSize = 0): [number, number][] => {
      const out: [number, number][] = [];
      let start = 0;
      const room = (st: number) => avail - (title && st > title[1] ? titleSize : 0);
      for (let k = 0; k < pre.length - 1; k++) {
        const over = k > start && (pre[k + 1] - pre[start]) * scale > room(start) + 0.01;
        if (over || (k > start && breaks.has(k + offset))) { out.push([start, k - 1]); start = k; }
      }
      out.push([start, pre.length - 2]);
      return out;
    };
    jobs.push({
      kind: 'cells', plan: {
        sheet: s, r0, r1, c0, c1, colX, rowY, merges, mergeAt, pageW: pw, pageH: ph, m, scale,
        bands: fit === 'page' ? [[0, colX.length - 2]] : split(colX, W, fit === 'width' ? new Set() : s.colBreaks, c0, titleCols, tW),
        chunks: fit === 'page' ? [[0, rowY.length - 2]] : split(rowY, H, s.rowBreaks, r0, titleRows, tH),
        titleRows, titleCols,
      },
    });
  }
  if (!jobs.length) throw new Error('EMPTY');

  let pageCount = 0;
  const totalPages = jobs.reduce((n, j) => n + (j.kind === 'chart' ? 1 : j.plan.bands.length * j.plan.chunks.length), 0);

  const drawHF = (page: ReturnType<typeof doc.addPage>, keyer: Keyer, s: XSheet, pw: number, ph: number, m: Plan['m'], pageNo: number, pages: number) => {
    const vars = { page: pageNo, pages, sheet: s.name, file: opts.fileName ?? '' };
    const first = pageNo === 1 && s.diffFirst, even = pageNo % 2 === 0 && s.diffOddEven;
    const head = first ? s.firstHeader : even ? s.evenHeader : s.header;
    const foot = first ? s.firstFooter : even ? s.evenFooter : s.footer;
    for (const [src, top] of [[head, true], [foot, false]] as const) {
      hfParts(src, vars).forEach((t, i) => {
        if (!t) return;
        const lines = t.split(/\r?\n/);
        lines.forEach((line, li) => {
          const sh = te.shape(line, calibri, 10);
          const x = i === 0 ? m.l : i === 2 ? pw - m.r - sh.width : (pw - sh.width) / 2;
          const y = top ? ph - m.header - 10 - li * 12 : m.footer + 2 + (lines.length - 1 - li) * 12;
          page.pushOperators(...te.ops(sh, x, y, { key: keyer }));
        });
      });
    }
  };

  for (const job of jobs) {
    if (job.kind === 'chart') {
      const s = job.sheet;
      let [pw, ph] = pageSize(s);
      const landscape = opts.orientation === 'portrait' ? false : opts.orientation === 'landscape' ? true : s.landscape ?? true;
      if (landscape !== pw > ph) [pw, ph] = [ph, pw];
      const page = doc.addPage([pw, ph]);
      const keyer = pageKeyer(page);
      const m = s.margins ?? defMargins;
      page.pushOperators(...drawChart(job.chart.spec, { x: m.l, y: m.b, w: pw - m.l - m.r, h: ph - m.t - m.b }, te, keyer, theme));
      drawHF(page, keyer, s, pw, ph, m, 1, 1);
      opts.onProgress?.(++pageCount, totalPages);
      continue;
    }
    const plan = job.plan;
    const { sheet: s, r0, c0, colX, rowY, mergeAt, scale } = plan;
    const gridlines = gridOpt === 'auto' ? autoGrid(s) : gridOpt;
    const sheetPages = plan.bands.length * plan.chunks.length;
    let sheetPage = 0;
    const cellAt = (r: number, c: number) => s.cells.get(r)?.get(c);
    const colPos = (c: number) => { const k = c - c0; if (k >= 0 && k < colX.length) return colX[k]; if (k < 0) return -1e9; let x = colX[colX.length - 1]; for (let cc = c0 + colX.length - 1; cc < c; cc++) x += s.hiddenCols.has(cc) ? 0 : s.colW[cc] ?? s.defColW; return x; };
    const rowPos = (r: number) => { const k = r - r0; if (k >= 0 && k < rowY.length) return rowY[k]; if (k < 0) return -1e9; let y = rowY[rowY.length - 1]; for (let rr = r0 + rowY.length - 1; rr < r; rr++) y += s.hiddenRows.has(rr) ? 0 : s.rowH.get(rr) ?? s.defRowH; return y; };
    const objRect = (o: XObj) => {
      const x0 = colPos(o.c0) + o.dx0, y0 = rowPos(o.r0) + o.dy0;
      const w = o.w ?? colPos(o.c1) + o.dx1 - x0, h = o.h ?? rowPos(o.r1) + o.dy1 - y0;
      const f = o.frac ?? [0, 0, 1, 1];
      return { x: x0 + f[0] * w, y: y0 + f[1] * h, w: f[2] * w, h: f[3] * h };
    };

    for (const [ca, cb] of plan.bands) {
      for (const [ra, rb] of plan.chunks) {
        sheetPage++;
        const page = doc.addPage([plan.pageW, plan.pageH]);
        const keyer = pageKeyer(page);
        // regions on this page: repeated title rows / columns, then the page's own cells
        const tr = plan.titleRows && ra > plan.titleRows[1] ? plan.titleRows : undefined;
        const tc = plan.titleCols && ca > plan.titleCols[1] ? plan.titleCols : undefined;
        const trH = tr ? rowY[tr[1] + 1] - rowY[tr[0]] : 0, tcW = tc ? colX[tc[1] + 1] - colX[tc[0]] : 0;
        const regions: { rows: [number, number]; cols: [number, number]; ox: number; oy: number; main: boolean }[] = [];
        if (tr && tc) regions.push({ rows: tr, cols: tc, ox: 0, oy: 0, main: false });
        if (tr) regions.push({ rows: tr, cols: [ca, cb], ox: tcW, oy: 0, main: false });
        if (tc) regions.push({ rows: [ra, rb], cols: tc, ox: 0, oy: trH, main: false });
        regions.push({ rows: [ra, rb], cols: [ca, cb], ox: tcW, oy: trH, main: true });
        const contentW = tcW + colX[cb + 1] - colX[ca], contentH = trH + rowY[rb + 1] - rowY[ra];
        const W = plan.pageW - plan.m.l - plan.m.r, H = plan.pageH - plan.m.t - plan.m.b;
        const offX = s.hCenter ? Math.max(0, (W - contentW * scale) / 2) : 0;
        const offY = s.vCenter ? Math.max(0, (H - contentH * scale) / 2) : 0;

        for (const reg of regions) {
          const [ra_, rb_] = reg.rows, [ca_, cb_] = reg.cols;
          const ops: PDFOperator[] = [];
          const bx0 = colX[ca_], bandW = colX[cb_ + 1] - bx0;
          const by0 = rowY[ra_], chunkH = rowY[rb_ + 1] - by0;
          // sheet space → page: origin at the region's top-left, y up, scaled (mirrored placement for right-to-left sheets)
          const ox = s.rtl ? contentW - reg.ox - bandW : reg.ox;
          ops.push(pushGraphicsState(), concatTransformationMatrix(scale, 0, 0, scale, plan.m.l + offX + ox * scale, plan.pageH - plan.m.t - offY - reg.oy * scale));
          ops.push(rectangle(0, -chunkH, bandW, chunkH), clip(), endPath());
          const X = (x: number, w: number) => (s.rtl ? bandW - (x - bx0) - w : x - bx0);
          const Y = (y: number) => -(y - by0);
          const rectOf = (r: number, c: number, mg?: Merge) => {
            const ra2 = mg ? mg.r0 : r, rb2 = mg ? mg.r1 : r, ca2 = mg ? mg.c0 : c, cb2 = mg ? mg.c1 : c;
            const x = colX[Math.max(0, ca2 - c0)] ?? 0, y = rowY[Math.max(0, ra2 - r0)] ?? 0;
            const x1 = colX[Math.min(colX.length - 1, cb2 - c0 + 1)], y1 = rowY[Math.min(rowY.length - 1, rb2 - r0 + 1)];
            return { x, y, w: x1 - x, h: y1 - y };
          };
          const inRegion = (rc: { x: number; y: number; w: number; h: number }) => rc.x < colX[cb_ + 1] && rc.x + rc.w > bx0 && rc.y < rowY[rb_ + 1] && rc.y + rc.h > by0;

          const items: { r: number; c: number; mg?: Merge; cell?: XCellData }[] = [];
          for (let r = r0 + ra_; r <= r0 + rb_; r++) {
            const row = s.cells.get(r);
            if (!row) continue;
            for (const [c, cell] of row) { if (c < c0 + ca_ || c > c0 + cb_ || mergeAt.has(key(r, c))) continue; items.push({ r, c, cell }); }
          }
          for (const mg of plan.merges) { const rc = rectOf(mg.r0, mg.c0, mg); if (inRegion(rc)) items.push({ r: mg.r0, c: mg.c0, mg, cell: cellAt(mg.r0, mg.c0) }); }

          // gridlines (under fills, like Excel)
          if (gridlines) {
            ops.push(setStrokingRgbColor(0.78, 0.78, 0.78), setLineWidth(0.4 / Math.max(scale, 0.4)), setDashPattern([], 0));
            for (let k = ra_; k <= rb_ + 1; k++) { const y = Y(rowY[k]); ops.push(moveTo(0, y), lineTo(bandW, y), stroke()); }
            for (let k = ca_; k <= cb_ + 1; k++) { const x = s.rtl ? bandW - (colX[k] - bx0) : colX[k] - bx0; ops.push(moveTo(x, 0), lineTo(x, -chunkH), stroke()); }
          }
          // fills (merged cells without a fill get white, to hide interior gridlines)
          for (const it of items) {
            const own = it.cell?.cf?.fill ?? it.cell?.style.fill;
            const fillHex = own ?? (it.mg && gridlines ? 'FFFFFF' : undefined);
            if (!fillHex) continue;
            const rc = rectOf(it.r, it.c, it.mg);
            const inset = !own ? 0.3 : 0;
            ops.push(setFillingRgbColor(...hex(fillHex)), rectangle(X(rc.x, rc.w) + inset, Y(rc.y + rc.h) + inset, rc.w - 2 * inset, rc.h - 2 * inset), fill());
          }
          // data bars
          for (const it of items) {
            const bar = it.cell?.cf?.bar;
            if (!bar) continue;
            const rc = rectOf(it.r, it.c, it.mg);
            const bw = Math.max(0, (rc.w - 2) * bar.frac), bh = Math.max(1, rc.h - 3);
            const color = hex(bar.neg ? 'FF0000' : bar.color);
            const x = s.rtl ? X(rc.x, rc.w) + rc.w - 1 - bw : X(rc.x, rc.w) + 1;
            ops.push(setFillingRgbColor(...(color.map((v) => v + (1 - v) * 0.35) as [number, number, number])), setStrokingRgbColor(...color), setLineWidth(0.4), rectangle(x, Y(rc.y + rc.h) + 1.5, bw, bh), fillAndStroke());
          }
          // borders (cells inside a merge only draw the edges on the merge's outline)
          const edge = (e: XEdge, x0: number, y0: number, x1: number, y1: number, vertical: boolean) => {
            const st = edgeStyle(e);
            ops.push(setStrokingRgbColor(...hex(e.color)), setLineWidth(st.w), setDashPattern(st.dash, 0));
            if (st.double) {
              const o = 0.75;
              for (const d of [-o, o]) ops.push(vertical ? moveTo(x0 + d, y0) : moveTo(x0, y0 + d), vertical ? lineTo(x1 + d, y1) : lineTo(x1, y1 + d), stroke());
            } else ops.push(moveTo(x0, y0), lineTo(x1, y1), stroke());
          };
          for (let r = r0 + ra_; r <= r0 + rb_; r++) {
            const row = s.cells.get(r);
            if (!row) continue;
            for (const [c, cell] of row) {
              if (c < c0 + ca_ || c > c0 + cb_) continue;
              const b = cell.style.border;
              if (!b.l && !b.r && !b.t && !b.b && !b.d) continue;
              const mg = mergeAt.get(key(r, c));
              const rc = rectOf(r, c);
              const x = X(rc.x, rc.w), yTop = Y(rc.y), yBot = Y(rc.y + rc.h);
              const left = s.rtl ? b.r : b.l, right = s.rtl ? b.l : b.r;
              const onL = !mg || (s.rtl ? c === mg.c1 : c === mg.c0), onR = !mg || (s.rtl ? c === mg.c0 : c === mg.c1);
              if (b.t && (!mg || r === mg.r0)) edge(b.t, x, yTop, x + rc.w, yTop, false);
              if (b.b && (!mg || r === mg.r1)) edge(b.b, x, yBot, x + rc.w, yBot, false);
              if (left && onL) edge(left, x, yTop, x, yBot, true);
              if (right && onR) edge(right, x + rc.w, yTop, x + rc.w, yBot, true);
              if (b.d && (!mg || (r === mg.r0 && c === mg.c0))) {
                const full = mg ? rectOf(r, c, mg) : rc;
                const fx = X(full.x, full.w), ft = Y(full.y), fb = Y(full.y + full.h);
                if (b.up) edge(b.d, fx, fb, fx + full.w, ft, false);
                if (b.down) edge(b.d, fx, ft, fx + full.w, fb, false);
              }
            }
          }
          ops.push(setDashPattern([], 0));

          // text (and icon sets)
          for (const it of items) {
            const cell = it.cell;
            if (!cell) continue;
            const rc = rectOf(it.r, it.c, it.mg);
            if (rc.w <= 0 || rc.h <= 0) continue; // hidden row or column
            const st = cell.style;
            const baseFont = cellFont(cell);
            let iconW = 0;
            const icon = cell.cf?.icon;
            if (icon) {
              const ic = iconFor(icon.set, icon.idx, icon.count);
              const sz = Math.max(4, Math.min(rc.h - 2, baseFont.sz * 1.05));
              const ix = s.rtl ? X(rc.x, rc.w) + rc.w - PAD - sz : X(rc.x, rc.w) + PAD;
              ops.push(pushGraphicsState(), ...iconOps(ic.kind, ic.color, ix, Y(rc.y + rc.h) + (rc.h - sz) / 2, sz), popGraphicsState());
              iconW = sz + 2;
              if (!icon.showValue) continue;
            }
            if (cell.cf?.bar && !cell.cf.bar.showValue) continue;
            if (!cell.text) continue;
            let h = st.h ?? 'general';
            if (h === 'general') h = cell.kind === 'n' ? 'right' : cell.kind === 'b' || cell.kind === 'e' ? 'center' : 'left';
            if (h === 'centerContinuous' || h === 'distributed') h = 'center';
            if (h === 'fill' || h === 'justify') h = 'left';
            const isRtlText = strongDir(cell.text) === 'R';
            if (s.rtl) h = h === 'left' ? 'right' : h === 'right' ? 'left' : h;
            const indent = st.indent * 7.5 + (h === 'left' && !s.rtl ? iconW : 0);
            const avail = Math.max(1, rc.w - 2 * PAD - st.indent * 7.5 - iconW);
            let segs = segsOf(cell);
            let shrink = 1;
            let clipX = rc.x, clipW = rc.w;

            // rotated text
            if (st.rot) {
              const sz = baseFont.sz;
              const color = hex(cell.color ?? baseFont.color ?? '000000');
              const style = styleOf(baseFont);
              ops.push(pushGraphicsState(), rectangle(X(rc.x, rc.w), Y(rc.y + rc.h), rc.w, rc.h), clip(), endPath());
              if (st.rot === 255) { // stacked letters
                const chars = [...cellText(cell)];
                const lh = sz * 1.1, total = chars.length * lh;
                let y = st.v === 'top' ? rc.y + PAD : st.v === 'center' ? rc.y + (rc.h - total) / 2 : rc.y + rc.h - PAD - total;
                for (const ch of chars) { const sh = te.shape(ch, style, sz); ops.push(...te.ops(sh, X(rc.x, rc.w) + rc.w / 2 - sh.width / 2, Y(y + sz * 0.9), { color, key: keyer })); y += lh; }
              } else {
                const ang = st.rot <= 90 ? st.rot : -(st.rot - 90);
                const a = (ang * Math.PI) / 180;
                const sh = te.shape(cellText(cell), style, sz);
                const Wt = sh.width, Ht = sh.ascent + sh.descent;
                const bw = Math.abs(Wt * Math.cos(a)) + Math.abs(Ht * Math.sin(a)), bh = Math.abs(Wt * Math.sin(a)) + Math.abs(Ht * Math.cos(a));
                const cx0 = X(rc.x, rc.w);
                const bx = h === 'right' ? cx0 + rc.w - PAD - bw : h === 'center' || (Math.abs(ang) === 90 && !st.h) ? cx0 + (rc.w - bw) / 2 : cx0 + PAD;
                const v = st.v ?? 'bottom';
                const byTop = v === 'top' ? Y(rc.y) - PAD : v === 'center' ? Y(rc.y) - (rc.h - bh) / 2 : Y(rc.y + rc.h) + PAD + bh;
                const ccx = bx + bw / 2, ccy = byTop - bh / 2;
                const ux = Math.cos(a), uy = Math.sin(a), nx = -Math.sin(a), ny = Math.cos(a);
                const mid = (sh.ascent - sh.descent) / 2;
                ops.push(...te.ops(sh, ccx - (Wt / 2) * ux - mid * nx, ccy - (Wt / 2) * uy - mid * ny, { color, key: keyer, rotate: ang }));
              }
              ops.push(popGraphicsState());
              continue;
            }

            let lines = layoutSegs(te, segs, avail, st.wrap);
            if (!st.wrap) {
              const w = lines[0]?.w ?? 0;
              if (w > avail) {
                if (cell.kind === 'n') {
                  const k = avail / w;
                  if (k >= 0.6 || st.shrink) { shrink = Math.max(k, 0.3); lines = layoutSegs(te, segs, avail, false, shrink); }
                  else { const hw = te.measure('#', styleOf(baseFont), baseFont.sz); segs = [{ text: '#'.repeat(Math.max(1, Math.floor(avail / hw))), font: baseFont }]; lines = layoutSegs(te, segs, avail, false); }
                } else if (st.shrink) { shrink = Math.max(avail / w, 0.3); lines = layoutSegs(te, segs, avail, false, shrink); }
                else if (!it.mg) {
                  // overflow into empty neighbours (in visual direction)
                  const free = (cc: number) => { const n = cellAt(it.r, cc); return (!n || !n.text) && !mergeAt.has(key(it.r, cc)) && cc >= c0 && cc <= plan.c1; };
                  const grow = (dir: 1 | -1) => {
                    let k = 1, added = 0;
                    while (true) {
                      const cc = it.c + (s.rtl ? -dir : dir) * k;
                      if (!free(cc)) break;
                      added += colX[cc - c0 + 1] - colX[cc - c0]; k++;
                      if (h === 'center' ? added * 2 + avail >= w : added + avail >= w) break;
                    }
                    return added;
                  };
                  let extraR = 0, extraL = 0;
                  if (h === 'left') extraR = grow(1);
                  else if (h === 'right') extraL = grow(-1);
                  else { extraR = grow(1); extraL = grow(-1); const e = Math.min(extraR, extraL); extraR = extraL = e; }
                  const addLeft = s.rtl ? extraR : extraL, addRight = s.rtl ? extraL : extraR;
                  clipX = rc.x - addLeft; clipW = rc.w + addLeft + addRight;
                }
              }
            }
            const blockH = lines.reduce((t, l) => t + l.size * LINE, 0);
            const v = st.v ?? 'bottom';
            let y = v === 'top' ? rc.y + PAD : v === 'center' || v === 'distributed' || v === 'justify' ? rc.y + (rc.h - blockH) / 2 : rc.y + rc.h - PAD - blockH;
            const cx = X(clipX, clipW);
            const needClip = clipW !== rc.w || blockH > rc.h || lines.some((l) => l.w > avail + 0.5);
            if (needClip) ops.push(pushGraphicsState(), rectangle(cx, Y(rc.y + rc.h), clipW, rc.h), clip(), endPath());
            const boxL = cx + PAD, boxR = cx + clipW - PAD;
            for (const line of lines) {
              const lh = line.size * LINE;
              const base = y + lh * 0.78;
              y += lh;
              if (!line.pieces.length) continue;
              let x = h === 'right' ? boxR - line.w - (s.rtl ? indent : st.indent * 7.5) - (s.rtl ? iconW : 0) : h === 'center' ? (boxL + boxR) / 2 - line.w / 2 : boxL + indent;
              const pieces = isRtlText && line.pieces.length > 1 ? line.pieces.slice().reverse() : line.pieces;
              for (const p of pieces) {
                const f = p.font;
                const size = f.sz * shrink;
                const small = f.vert === 'superscript' || f.vert === 'subscript';
                const sh = te.shape(p.text, styleOf(f), small ? size * 0.65 : size);
                const lift = f.vert === 'superscript' ? size * 0.33 : f.vert === 'subscript' ? -size * 0.15 : 0;
                const color = hex(cell.color ?? f.color ?? '000000');
                ops.push(...te.ops(sh, x, Y(base) + lift, { color, key: keyer }));
                if (f.u || f.strike) {
                  ops.push(setStrokingRgbColor(...color), setLineWidth(Math.max(0.4, size * 0.05)));
                  if (f.u) ops.push(moveTo(x, Y(base + size * 0.12)), lineTo(x + sh.width, Y(base + size * 0.12)), stroke());
                  if (f.strike) ops.push(moveTo(x, Y(base - size * 0.28)), lineTo(x + sh.width, Y(base - size * 0.28)), stroke());
                }
                x += sh.width;
              }
            }
            if (needClip) ops.push(popGraphicsState());
          }

          // drawing layer: pictures, shapes, charts (in file order)
          if (reg.main) for (const o of s.objects) {
            const rc = objRect(o);
            if (rc.w <= 0 || rc.h <= 0 || !inRegion(rc)) continue;
            const x = X(rc.x, rc.w), yb = Y(rc.y + rc.h);
            if (o.kind === 'pic') {
              const img = imgCache.get(o.bytes);
              if (!img) continue;
              const name = keyer.image(img);
              ops.push(pushGraphicsState());
              if (o.crop) {
                const [l, t, r, b] = o.crop;
                const fw = rc.w / Math.max(0.01, 1 - l - r), fh = rc.h / Math.max(0.01, 1 - t - b);
                ops.push(rectangle(x, yb, rc.w, rc.h), clip(), endPath(), concatTransformationMatrix(fw, 0, 0, fh, x - l * fw, yb - b * fh));
              } else ops.push(concatTransformationMatrix(rc.w, 0, 0, rc.h, x, yb));
              ops.push(drawObject(name), popGraphicsState());
            } else if (o.kind === 'shape') ops.push(...drawShape(o, x, yb, rc.w, rc.h, te, keyer));
            else ops.push(...drawChart(o.spec, { x, y: yb, w: rc.w, h: rc.h }, te, keyer, theme));
          }
          ops.push(popGraphicsState());
          page.pushOperators(...ops);
        }
        drawHF(page, keyer, s, plan.pageW, plan.pageH, plan.m, sheetPage, sheetPages);
        opts.onProgress?.(++pageCount, totalPages);
      }
    }
  }

  if (opts.title) doc.setTitle(opts.title);
  doc.setProducer('PDFSherpa');
  doc.setCreator('PDFSherpa Excel to PDF');
  return { pdf: await doc.save(), pages: doc.getPageCount(), sheets: jobs.length, skippedObjects: skipped, missingGlyphs: te.missing };
}
