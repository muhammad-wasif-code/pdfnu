/**
 * Read an Excel workbook (.xlsx / .xlsm / .xltx) or a CSV file into a sheet model ready to print:
 * values formatted the way Excel shows them (formulas without saved results are calculated),
 * rich text, fonts, fills, borders, alignment and rotation, column widths, row heights, merged cells,
 * conditional formatting, pictures, shapes, charts and chart sheets, print area and titles,
 * page breaks, paper and margins, headers and footers.
 */
import { parseXml, kids, kid, find, type XNode } from './xml';
import { BUILTIN_FORMATS, formatNumber, formatText, isDateFormat } from './numFmt';
import { themeFrom, sheetColor, tint, type Theme } from './xlsxColor';
import { parseDrawing, type XObj, type XChartObj } from './xlsxDrawing';
import { fillChartData } from './xlsxChart';
import { evaluate, shiftFormula, FErr, type FCtx, type Scalar } from './formula';
import { parseCf, parseDxfs, applyCf, type CfEffect, type CfBlock } from './xlsxCf';

export interface XFont { name: string; sz: number; b: boolean; i: boolean; u: boolean; strike: boolean; color?: string; vert?: string; }
export interface XEdge { style: string; color: string; }
export interface XStyle {
  fmt: string; font: XFont; fill?: string;
  border: { l?: XEdge; r?: XEdge; t?: XEdge; b?: XEdge; d?: XEdge; up?: boolean; down?: boolean };
  h?: string; v?: string; wrap: boolean; indent: number; shrink: boolean; rot: number;
}
export interface XRunCell { text: string; font: XFont; }
export interface XCellData {
  /** shown text (already number-formatted) */
  text: string;
  kind: 'n' | 's' | 'b' | 'e' | 'empty';
  style: XStyle;
  /** colour from the number format, e.g. [Red] */
  color?: string;
  raw?: Scalar; formula?: string;
  /** rich text with several fonts in one cell */
  runs?: XRunCell[];
  cf?: CfEffect;
}
export type { XObj, XPicture, XShape, XChartObj } from './xlsxDrawing';
export interface XSheet {
  name: string; hidden: boolean; rtl: boolean;
  cells: Map<number, Map<number, XCellData>>;
  /** column widths in pt (index = column), rows heights in pt; undefined = default */
  colW: number[]; rowH: Map<number, number>; customRowH: Set<number>;
  hiddenCols: Set<number>; hiddenRows: Set<number>;
  defColW: number; defRowH: number;
  merges: { r0: number; c0: number; r1: number; c1: number }[];
  maxR: number; maxC: number;
  /** print settings */
  landscape?: boolean; paper?: number; fitToPage?: boolean; fitW?: number; fitH?: number; scale?: number; gridLines: boolean;
  hCenter?: boolean; vCenter?: boolean;
  /** gridlines shown on screen (sheetView showGridLines) */ showGrid: boolean;
  margins?: { l: number; r: number; t: number; b: number; header: number; footer: number };
  header?: string; footer?: string; firstHeader?: string; firstFooter?: string; evenHeader?: string; evenFooter?: string; diffFirst?: boolean; diffOddEven?: boolean;
  printArea?: { r0: number; c0: number; r1: number; c1: number };
  repeatRows?: [number, number]; repeatCols?: [number, number];
  rowBreaks: Set<number>; colBreaks: Set<number>;
  objects: XObj[];
  /** a chart sheet: one chart on its own page */
  chartPage?: XChartObj;
  /** objects that could not be drawn (SmartArt, new chart types, OLE objects, EMF/WMF pictures) */
  skipped: number;
}
export interface XWorkbook { sheets: XSheet[]; date1904: boolean; formulasWithoutValue: number; theme?: Theme; }

// ───────── cell references ─────────
export function colIndex(letters: string): number { let n = 0; for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
export function colName(i: number): string { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function ref(r: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(r.trim());
  return m ? { c: colIndex(m[1]), r: +m[2] - 1 } : null;
}
function range(s: string) {
  const [a, b] = s.split(':');
  const p = ref(a), q = ref(b ?? a);
  if (!p || !q) return null;
  return { r0: Math.min(p.r, q.r), c0: Math.min(p.c, q.c), r1: Math.max(p.r, q.r), c1: Math.max(p.c, q.c) };
}

const pxToPt = 0.75;
/** Excel column width (characters of the default font, padding included) → pt. */
export const colWidthPt = (w: number) => Math.round(w * 7) * pxToPt;

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}

const DEFAULT_FONT: XFont = { name: 'Calibri', sz: 11, b: false, i: false, u: false, strike: false };
const emptyStyle = (font: XFont = DEFAULT_FONT): XStyle => ({ fmt: 'General', font, border: {}, wrap: false, indent: 0, shrink: false, rot: 0 });

function fontOf(f: XNode | undefined, theme: Theme, base?: XFont): XFont {
  const val = (n: string) => kid(f, n);
  const flag = (n: string, d: boolean) => { const e = val(n); return e ? e.a.val !== '0' && e.a.val !== 'false' : d; };
  const u = val('u');
  return {
    name: val('name')?.a.val ?? val('rFont')?.a.val ?? base?.name ?? 'Calibri', sz: +(val('sz')?.a.val ?? base?.sz ?? 11) || 11,
    b: flag('b', base?.b ?? false), i: flag('i', base?.i ?? false), u: u ? u.a.val !== 'none' : base?.u ?? false, strike: flag('strike', base?.strike ?? false),
    color: sheetColor(val('color'), theme) ?? base?.color, vert: val('vertAlign')?.a.val ?? base?.vert,
  };
}

function parseStyles(x: XNode | null, theme: Theme): XStyle[] {
  if (!x) return [emptyStyle()];
  const fmts = new Map<number, string>();
  for (const f of kids(kid(x, 'numFmts'), 'numFmt')) fmts.set(+f.a.numFmtId, f.a.formatCode ?? 'General');
  const fonts: XFont[] = kids(kid(x, 'fonts'), 'font').map((f) => fontOf(f, theme));
  const fills: (string | undefined)[] = kids(kid(x, 'fills'), 'fill').map((f) => {
    const p = kid(f, 'patternFill');
    if (p) {
      const type = p.a.patternType ?? (kid(p, 'fgColor') ? 'solid' : 'none');
      if (type === 'none') return undefined;
      const fg = sheetColor(kid(p, 'fgColor'), theme), bg = sheetColor(kid(p, 'bgColor'), theme);
      if (type === 'solid') return fg ?? bg;
      // patterned fills print as a tint of the foreground colour
      const density = /gray0625/.test(type) ? 0.94 : /gray125/.test(type) ? 0.88 : /light/.test(type) ? 0.7 : /mediumGray/.test(type) ? 0.5 : 0.35;
      return fg ? tint(fg, density) : undefined;
    }
    const g = kid(f, 'gradientFill');
    if (g) { const stops = find(g, 'stop'); return sheetColor(kid(stops[Math.floor(stops.length / 2)] ?? stops[0], 'color'), theme); }
    return undefined;
  });
  const borders = kids(kid(x, 'borders'), 'border').map((b) => {
    const edge = (n: string): XEdge | undefined => {
      const e = kid(b, n);
      const st = e?.a.style;
      if (!e || !st || st === 'none') return undefined;
      return { style: st, color: sheetColor(kid(e, 'color'), theme, '000000')! };
    };
    return { l: edge('left') ?? edge('start'), r: edge('right') ?? edge('end'), t: edge('top'), b: edge('bottom'), d: edge('diagonal'), up: b.a.diagonalUp === '1', down: b.a.diagonalDown === '1' };
  });
  return kids(kid(x, 'cellXfs'), 'xf').map((xf) => {
    const id = +(xf.a.numFmtId ?? 0);
    const al = kid(xf, 'alignment');
    return {
      fmt: fmts.get(id) ?? BUILTIN_FORMATS[id] ?? 'General',
      font: fonts[+(xf.a.fontId ?? 0)] ?? DEFAULT_FONT,
      fill: fills[+(xf.a.fillId ?? 0)],
      border: borders[+(xf.a.borderId ?? 0)] ?? {},
      h: al?.a.horizontal, v: al?.a.vertical,
      wrap: al?.a.wrapText === '1' || al?.a.wrapText === 'true',
      indent: +(al?.a.indent ?? 0) || 0,
      shrink: al?.a.shrinkToFit === '1' || al?.a.shrinkToFit === 'true',
      rot: +(al?.a.textRotation ?? 0) || 0,
    };
  });
}

/** _x000D_ style escapes used by Excel for control characters */
const unescapeX = (s: string) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

interface SstItem { text: string; runs?: { text: string; rPr?: XNode }[]; }
function richText(si: XNode): SstItem {
  // plain <t>, or rich runs <r><t>; skip phonetic guides <rPh>
  let text = '';
  const runs: { text: string; rPr?: XNode }[] = [];
  for (const c of si.c) {
    if (c.n === 't') { text += c.t; runs.push({ text: unescapeX(c.t) }); }
    else if (c.n === 'r') { const t = kids(c, 't').map((x) => x.t).join(''); text += t; runs.push({ text: unescapeX(t), rPr: kid(c, 'rPr') }); }
  }
  return { text: unescapeX(text), runs: runs.length > 1 && runs.some((r) => r.rPr) ? runs : undefined };
}

export interface ReadOptions {
  /** convert pictures that are not PNG/JPEG (GIF, BMP, WebP…) to PNG; return null to skip */
  convertImage?: (bytes: Uint8Array, type: string) => Promise<Uint8Array | null>;
  /** "today" for TODAY()/NOW() and date-based highlighting (tests) */
  today?: Date;
}

function newSheet(name: string, defColW = 48, defRowH = 15): XSheet {
  return { name, hidden: false, rtl: false, cells: new Map(), colW: [], rowH: new Map(), customRowH: new Set(), hiddenCols: new Set(), hiddenRows: new Set(), defColW, defRowH, merges: [], maxR: -1, maxC: -1, gridLines: false, showGrid: true, rowBreaks: new Set(), colBreaks: new Set(), objects: [], skipped: 0 };
}

export function formatValue(raw: Scalar, st: XStyle, date1904: boolean): { text: string; kind: XCellData['kind']; color?: string } {
  if (raw instanceof FErr) return { text: raw.code, kind: 'e' };
  if (typeof raw === 'number') { const r = formatNumber(raw, st.fmt, date1904); return { text: r.text, kind: 'n', color: r.color }; }
  if (typeof raw === 'boolean') return { text: raw ? 'TRUE' : 'FALSE', kind: 'b' };
  if (raw === null || raw === undefined) return { text: '', kind: 'empty' };
  return { text: formatText(raw, st.fmt), kind: 's' };
}

export async function readXlsx(input: ArrayBuffer | Uint8Array, opts: ReadOptions = {}): Promise<XWorkbook> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new Error('OLE_FILE');
  const { default: JSZip } = await import('jszip');
  let zip: any;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('NOT_XLSX'); }
  const read = async (path: string): Promise<string | null> => { const f = zip.file(path) ?? zip.file(decodeURIComponent(path)); return f ? await f.async('string') : null; };
  const xml = async (path: string | null) => { if (!path) return null; const s = await read(path); return s ? parseXml(s) : null; };
  const relsOf = async (part: string) => {
    const dir = part.split('/').slice(0, -1).join('/');
    const x = await xml(`${dir ? dir + '/' : ''}_rels/${part.split('/').pop()}.rels`);
    const m = new Map<string, { target: string; type: string }>();
    for (const r of kids(x ?? undefined, 'Relationship')) m.set(r.a.Id, { target: r.a.TargetMode === 'External' ? r.a.Target : resolvePath(part, r.a.Target ?? ''), type: r.a.Type ?? '' });
    return m;
  };

  const root = await relsOf('');
  const wbPath = [...root.values()].find((r) => /officeDocument$/.test(r.type))?.target ?? 'xl/workbook.xml';
  const wb = await xml(wbPath);
  if (!wb || wb.n !== 'workbook') throw new Error('NOT_XLSX');
  const wbRels = await relsOf(wbPath);
  const partOf = (re: RegExp) => [...wbRels.values()].find((r) => re.test(r.type))?.target ?? null;

  const theme = themeFrom(await xml(partOf(/\/theme$/)));
  const stylesX = await xml(partOf(/\/styles$/));
  const styles = parseStyles(stylesX, theme);
  const dxfs = parseDxfs(stylesX, theme);
  const sstX = await xml(partOf(/\/sharedStrings$/));
  const sst = kids(sstX ?? undefined, 'si').map(richText);
  const date1904 = ['1', 'true'].includes(kid(wb, 'workbookPr')?.a.date1904 ?? '');

  const sheetEls = kids(kid(wb, 'sheets'), 'sheet');
  const local = new Map<number, Map<string, string>>();
  const globalNames = new Map<string, string>();
  for (const d of kids(kid(wb, 'definedNames'), 'definedName')) {
    const name = (d.a.name ?? '').toLowerCase();
    if (d.a.localSheetId !== undefined) { const i = +d.a.localSheetId; if (!local.has(i)) local.set(i, new Map()); local.get(i)!.set(name, d.t); }
    else globalNames.set(name, d.t);
  }

  const drawingCtx = (rels: Map<string, { target: string; type: string }>) => ({
    theme, rels, convertImage: opts.convertImage,
    file: async (p: string) => { const f = zip.file(p); return f ? ((await f.async('uint8array')) as Uint8Array) : null; },
    xml: (p: string) => xml(p),
  });

  const sheets: XSheet[] = [];
  const sheetIndex: number[] = []; // workbook position of each parsed sheet
  const cfBlocks = new Map<XSheet, CfBlock[]>();
  for (let si = 0; si < sheetEls.length; si++) {
    const se = sheetEls[si];
    const rel = wbRels.get(se.a.id);
    if (!rel) continue;
    const name = se.a.name ?? `Sheet${si + 1}`;
    const hidden = se.a.state === 'hidden' || se.a.state === 'veryHidden';
    if (/\/chartsheet$/.test(rel.type)) {
      const cx = await xml(rel.target);
      const dr = cx ? kid(cx, 'drawing') : undefined;
      const sheetRels = await relsOf(rel.target);
      const dPath = dr ? sheetRels.get(dr.a.id)?.target : undefined;
      const dx = await xml(dPath ?? null);
      const sheet = newSheet(name);
      sheet.hidden = hidden;
      if (dx && dPath) {
        const { objects, skipped } = await parseDrawing(dx, drawingCtx(await relsOf(dPath)));
        sheet.chartPage = objects.find((o): o is XChartObj => o.kind === 'chart');
        sheet.skipped += skipped + (sheet.chartPage ? 0 : objects.length ? 0 : 1);
      }
      const ps = cx ? kid(cx, 'pageSetup') : undefined;
      sheet.landscape = ps?.a.orientation ? ps.a.orientation === 'landscape' : true;
      if (ps?.a.paperSize) sheet.paper = +ps.a.paperSize;
      sheets.push(sheet); sheetIndex.push(si);
      continue;
    }
    if (!/\/worksheet$/.test(rel.type)) continue; // dialog / macro sheets
    const sx = await xml(rel.target);
    if (!sx) continue;
    const fmtPr = kid(sx, 'sheetFormatPr');
    const baseW = +(fmtPr?.a.baseColWidth ?? 8);
    const defColW = fmtPr?.a.defaultColWidth ? colWidthPt(+fmtPr.a.defaultColWidth) : Math.ceil((baseW * 7 + 5) / 8) * 8 * pxToPt;
    const defRowH = +(fmtPr?.a.defaultRowHeight ?? 15) || 15;
    const sheet = newSheet(name, defColW, defRowH);
    sheet.hidden = hidden;
    const view = kid(kid(sx, 'sheetViews'), 'sheetView');
    sheet.rtl = view?.a.rightToLeft === '1';
    sheet.showGrid = view?.a.showGridLines !== '0' && view?.a.showGridLines !== 'false';
    const po = kid(sx, 'printOptions');
    sheet.gridLines = po?.a.gridLines === '1' || po?.a.gridLines === 'true';
    sheet.hCenter = po?.a.horizontalCentered === '1'; sheet.vCenter = po?.a.verticalCentered === '1';
    for (const col of kids(kid(sx, 'cols'), 'col')) {
      const lo = +col.a.min - 1, hi = Math.min(+col.a.max - 1, 16383);
      const w = col.a.width !== undefined ? colWidthPt(+col.a.width) : defColW;
      const hid = col.a.hidden === '1' || col.a.hidden === 'true' || +col.a.width === 0;
      for (let c = lo; c <= Math.min(hi, lo + 1024); c++) { sheet.colW[c] = w; if (hid) sheet.hiddenCols.add(c); }
    }
    const shared = new Map<string, { f: string; r: number; c: number }>();
    let rIdx = -1;
    for (const row of kids(kid(sx, 'sheetData'), 'row')) {
      rIdx = row.a.r ? +row.a.r - 1 : rIdx + 1;
      if (row.a.ht) { sheet.rowH.set(rIdx, +row.a.ht); if (row.a.customHeight === '1' || row.a.customHeight === 'true') sheet.customRowH.add(rIdx); }
      if (row.a.hidden === '1' || row.a.hidden === 'true') sheet.hiddenRows.add(rIdx);
      const rowStyle = row.a.customFormat === '1' && row.a.s ? styles[+row.a.s] : undefined;
      let cIdx = -1;
      for (const c of kids(row, 'c')) {
        const p = c.a.r ? ref(c.a.r) : null;
        cIdx = p ? p.c : cIdx + 1;
        const st = styles[+(c.a.s ?? -1)] ?? rowStyle ?? styles[0] ?? emptyStyle();
        const t = c.a.t ?? 'n';
        const v = kid(c, 'v')?.t;
        const fEl = kid(c, 'f');
        let formula: string | undefined;
        if (fEl) {
          if (fEl.a.t === 'shared' && fEl.a.si !== undefined) {
            if (fEl.t.trim()) { shared.set(fEl.a.si, { f: fEl.t, r: rIdx, c: cIdx }); formula = fEl.t; }
            else { const m = shared.get(fEl.a.si); if (m) formula = shiftFormula(m.f, rIdx - m.r, cIdx - m.c); }
          } else if (fEl.t.trim()) formula = fEl.t;
        }
        let raw: Scalar | undefined;
        let runs: XRunCell[] | undefined;
        if (t === 's' && v !== undefined) { const it = sst[+v]; raw = it?.text ?? ''; if (it?.runs) runs = it.runs.map((r) => ({ text: r.text, font: r.rPr ? fontOf(r.rPr, theme, st.font) : st.font })); }
        else if (t === 'inlineStr') { const it = richText(kid(c, 'is') ?? { n: '', a: {}, c: [], t: '' }); raw = it.text; if (it.runs) runs = it.runs.map((r) => ({ text: r.text, font: r.rPr ? fontOf(r.rPr, theme, st.font) : st.font })); }
        else if (t === 'str' && v !== undefined) raw = unescapeX(v);
        else if (t === 'b' && v !== undefined) raw = v === '1' || v === 'true';
        else if (t === 'e' && v !== undefined) raw = new FErr(v);
        else if (t === 'd' && v !== undefined) { const ms = Date.parse(v); raw = isNaN(ms) ? v : ms / 86400000 + 25569 - (date1904 ? 1462 : 0); }
        else if (v !== undefined && v !== '') { const n = +v; raw = isNaN(n) ? v : n; }
        let cell: XCellData | null = null;
        if (raw !== undefined) {
          const style = t === 'd' && !isDateFormat(st.fmt) ? { ...st, fmt: 'm/d/yyyy' } : st;
          const f = formatValue(raw, style, date1904);
          cell = { text: f.text, kind: f.kind, color: f.color, style, raw, formula, runs };
        } else if (formula) cell = { text: '', kind: 'empty', style: st, formula };
        else if (st.fill || st.border.l || st.border.r || st.border.t || st.border.b || st.border.d) cell = { text: '', kind: 'empty', style: st };
        if (!cell) continue;
        let r = sheet.cells.get(rIdx);
        if (!r) { r = new Map(); sheet.cells.set(rIdx, r); }
        r.set(cIdx, cell);
        sheet.maxR = Math.max(sheet.maxR, rIdx); sheet.maxC = Math.max(sheet.maxC, cIdx);
      }
    }
    for (const m of kids(kid(sx, 'mergeCells'), 'mergeCell')) {
      const g = m.a.ref ? range(m.a.ref) : null;
      if (g && (g.r1 > g.r0 || g.c1 > g.c0)) { sheet.merges.push(g); if (sheet.cells.get(g.r0)?.get(g.c0)) { sheet.maxR = Math.max(sheet.maxR, g.r1); sheet.maxC = Math.max(sheet.maxC, g.c1); } }
    }
    const ps = kid(sx, 'pageSetup');
    if (ps) {
      if (ps.a.orientation && ps.a.orientation !== 'default') sheet.landscape = ps.a.orientation === 'landscape';
      if (ps.a.paperSize) sheet.paper = +ps.a.paperSize;
      if (ps.a.scale) sheet.scale = +ps.a.scale;
      if (ps.a.fitToWidth !== undefined) sheet.fitW = +ps.a.fitToWidth;
      if (ps.a.fitToHeight !== undefined) sheet.fitH = +ps.a.fitToHeight;
    }
    sheet.fitToPage = kid(kid(sx, 'sheetPr'), 'pageSetUpPr')?.a.fitToPage === '1';
    const pm = kid(sx, 'pageMargins');
    if (pm) sheet.margins = { l: +(pm.a.left ?? 0.7) * 72, r: +(pm.a.right ?? 0.7) * 72, t: +(pm.a.top ?? 0.75) * 72, b: +(pm.a.bottom ?? 0.75) * 72, header: +(pm.a.header ?? 0.3) * 72, footer: +(pm.a.footer ?? 0.3) * 72 };
    const hf = kid(sx, 'headerFooter');
    if (hf) {
      sheet.header = kid(hf, 'oddHeader')?.t || undefined; sheet.footer = kid(hf, 'oddFooter')?.t || undefined;
      sheet.firstHeader = kid(hf, 'firstHeader')?.t; sheet.firstFooter = kid(hf, 'firstFooter')?.t;
      sheet.evenHeader = kid(hf, 'evenHeader')?.t; sheet.evenFooter = kid(hf, 'evenFooter')?.t;
      sheet.diffFirst = hf.a.differentFirst === '1'; sheet.diffOddEven = hf.a.differentOddEven === '1';
    }
    for (const b of kids(kid(sx, 'rowBreaks'), 'brk')) if (+b.a.id > 0) sheet.rowBreaks.add(+b.a.id);
    for (const b of kids(kid(sx, 'colBreaks'), 'brk')) if (+b.a.id > 0) sheet.colBreaks.add(+b.a.id);
    const names = local.get(si);
    const pa = names?.get('_xlnm.print_area');
    if (pa) { const first = pa.split(',')[0].replace(/^.*!/, '').replace(/\$/g, ''); const g = range(first); if (g) sheet.printArea = g; }
    const pt = names?.get('_xlnm.print_titles');
    if (pt) for (const part of pt.split(',')) {
      const body = part.replace(/^.*!/, '').replace(/\$/g, '');
      let m = /^(\d+):(\d+)$/.exec(body);
      if (m) sheet.repeatRows = [+m[1] - 1, +m[2] - 1];
      m = /^([A-Za-z]+):([A-Za-z]+)$/.exec(body);
      if (m) sheet.repeatCols = [colIndex(m[1]), colIndex(m[2])];
    }
    cfBlocks.set(sheet, parseCf(sx, dxfs, theme));

    // drawing layer (pictures, shapes, charts)
    const dr = kid(sx, 'drawing');
    if (dr) {
      const sheetRels = await relsOf(rel.target);
      const dPath = sheetRels.get(dr.a.id)?.target;
      const dx = await xml(dPath ?? null);
      if (dx && dPath) {
        const { objects, skipped } = await parseDrawing(dx, drawingCtx(await relsOf(dPath)));
        sheet.objects = objects; sheet.skipped += skipped;
      }
    }
    // legacy form controls / OLE objects that print
    sheet.skipped += kids(kid(sx, 'oleObjects'), 'oleObject').length;
    sheets.push(sheet); sheetIndex.push(si);
  }
  if (!sheets.length) throw new Error('NOT_XLSX');

  // ───── formulas without saved results → calculate ─────
  const byName = new Map(sheets.map((s) => [s.name.toLowerCase(), s]));
  const busy = new Set<XCellData>();
  let current: XSheet = sheets[0];
  let formulasWithoutValue = 0;
  const valueOf = (s: XSheet, r: number, c: number): Scalar => {
    const cell = s.cells.get(r)?.get(c);
    if (!cell) return null;
    if (cell.raw !== undefined) return cell.raw;
    if (!cell.formula) return null;
    if (busy.has(cell)) return new FErr('#REF!');
    busy.add(cell);
    const prev = current;
    current = s;
    const res = evaluate(cell.formula, makeCtx(s, r, c));
    current = prev;
    busy.delete(cell);
    let v: Scalar = Array.isArray(res) ? res[0]?.[0] ?? null : res;
    if (v instanceof FErr && v.unsupported) { cell.raw = null; formulasWithoutValue++; return null; }
    cell.raw = v;
    if (v === null) v = 0; // an empty result shows as 0
    const f = formatValue(v, cell.style, date1904);
    cell.text = f.text; cell.kind = f.kind; cell.color = f.color;
    return cell.raw;
  };
  const sheetFor = (name: string | undefined, fallback: XSheet) => (name ? byName.get(name.toLowerCase()) : fallback);
  const makeCtx = (s: XSheet, r: number, c: number): FCtx => ({
    cell: (sheet, rr, cc) => { const t = sheetFor(sheet, s); return t ? valueOf(t, rr, cc) : new FErr('#REF!'); },
    bounds: (sheet) => { const t = sheetFor(sheet, s); return { maxR: t?.maxR ?? 0, maxC: t?.maxC ?? 0 }; },
    name: (n) => { const k = n.toLowerCase(); const si = sheetIndex[sheets.indexOf(s)]; return local.get(si)?.get(k) ?? globalNames.get(k); },
    here: { r, c },
  });
  for (const s of sheets) for (const [r, row] of s.cells) for (const [c, cell] of row) if (cell.formula && cell.raw === undefined) valueOf(s, r, c);

  // ───── charts without cached data: read the cells ─────
  const rangeValues = (refStr: string, s: XSheet): Scalar[] => {
    const parts = refStr.replace(/^\(|\)$/g, '').split(',');
    const out: Scalar[] = [];
    for (const part of parts) {
      const m = /^(?:'?(.+?)'?!)?(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)$/i.exec(part.trim());
      if (!m) continue;
      const t = m[1] ? byName.get(m[1].replace(/''/g, "'").toLowerCase()) : s;
      const g = range(m[2].replace(/\$/g, ''));
      if (!t || !g) continue;
      for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) out.push(valueOf(t, r, c));
    }
    return out;
  };
  for (const s of sheets) {
    const charts = [...s.objects.filter((o): o is XChartObj => o.kind === 'chart'), ...(s.chartPage ? [s.chartPage] : [])];
    for (const ch of charts) fillChartData(ch.spec, (rf) => rangeValues(rf, s).map((v) => (v instanceof FErr ? null : v)));
  }

  // ───── conditional formatting ─────
  for (const s of sheets) {
    const blocks = cfBlocks.get(s);
    if (!blocks?.length) continue;
    const ctx = makeCtx(s, 0, 0);
    const base = styles[0] ?? emptyStyle();
    applyCf(blocks, ctx, { maxR: s.maxR, maxC: s.maxC }, (r, c) => valueOf(s, r, c), (r, c, e) => {
      let row = s.cells.get(r);
      if (!row) { row = new Map(); s.cells.set(r, row); }
      let cell = row.get(c);
      if (!cell) { cell = { text: '', kind: 'empty', style: base }; row.set(c, cell); }
      cell.cf = { ...cell.cf, ...e };
    }, opts.today);
  }

  return { sheets, date1904, formulasWithoutValue, theme };
}

// ───────── CSV ─────────
function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20000).split(/\r?\n/).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map((l) => l.split(d).length - 1).filter((n) => n > 0);
    if (!counts.length) continue;
    const same = counts.filter((n) => n === counts[0]).length;
    const score = same * 10 + counts[0];
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

export function parseCsv(text: string, delim = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

/** A CSV file as a one-sheet workbook; columns are sized to their content. */
export function csvToWorkbook(text: string, name = 'Sheet1', delim?: string): XWorkbook {
  const clean = text.replace(/^\ufeff/, '');
  const rows = delim ? parseCsv(clean, delim) : parseCsv(clean);
  const st = emptyStyle();
  const sheet = newSheet(name);
  sheet.gridLines = true;
  const widest: number[] = [];
  rows.forEach((r, ri) => {
    const m = new Map<number, XCellData>();
    r.forEach((v, ci) => {
      if (v === '') return;
      const num = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v.trim()) && !/^-?0\d/.test(v.trim()) ? +v : NaN;
      m.set(ci, { text: isNaN(num) ? v : formatNumber(num, 'General').text, kind: isNaN(num) ? 's' : 'n', style: st, raw: isNaN(num) ? v : num });
      widest[ci] = Math.max(widest[ci] ?? 0, Math.min(50, Math.max(...v.split('\n').map((l) => [...l].length))));
      sheet.maxC = Math.max(sheet.maxC, ci);
    });
    if (m.size) { sheet.cells.set(ri, m); sheet.maxR = ri; }
  });
  sheet.colW = Array.from({ length: widest.length }, (_, i) => colWidthPt(Math.max(8.43, (widest[i] ?? 0) * 1.1 + 1)));
  return { sheets: [sheet], date1904: false, formulasWithoutValue: 0 };
}
