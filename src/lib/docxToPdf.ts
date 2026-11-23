/**
 * Word (.docx) → PDF, entirely in the browser.
 * Reads the Office Open XML package with jszip + DOMParser, resolves styles and numbering,
 * lays text out with real font metrics and draws it with pdf-lib (text stays selectable).
 * Supported: paragraphs, headings, bold/italic/underline/strike, sizes, colours, highlight,
 * alignment (incl. justify), indents, spacing, bullets/numbering, tabs, page breaks, sections,
 * tables (borders, shading, merged cells, rows split across pages), images (PNG/JPEG, others
 * via the browser), text boxes, headers and footers with page numbers, custom tab stops with leaders,
 * right-to-left paragraphs and every script the text engine supports (see textEngine.ts).
 */
import { PDFDocument, rgb, type PDFImage, type PDFPage } from 'pdf-lib';
import { TextEngine, familyFor, strongDir, bidiLevels, visualOrder, type TextStyle } from './textEngine';

// ───────────────────────── XML helpers ─────────────────────────
const kids = (el: Element | null | undefined, name?: string): Element[] =>
  el ? Array.from(el.children).filter((c) => !name || c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] as Element | undefined;
function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return null;
}
const num = (v: string | null) => (v == null || v === '' || isNaN(+v) ? undefined : +v);
const tw = (v: string | null) => { const n = num(v); return n === undefined ? undefined : n / 20; }; // twips → pt
function onOff(el: Element | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = attr(el, 'val');
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}
function descendants(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === name);
}
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
const merge = <T extends object>(...xs: (Partial<T> | undefined)[]): T => Object.assign({}, ...xs.map((x) => (x ? defined(x) : {})));

// ───────────────────────── properties ─────────────────────────
interface RPr { b?: boolean; i?: boolean; u?: boolean; strike?: boolean; caps?: boolean; vanish?: boolean; sz?: number; color?: string; highlight?: string; vert?: 'superscript' | 'subscript'; rStyle?: string; font?: string; szCs?: number; bCs?: boolean; iCs?: boolean; csFont?: string; }
interface Tab { val: string; pos: number; leader?: string; }
interface PPr { styleId?: string; jc?: 'left' | 'center' | 'right' | 'both'; before?: number; after?: number; line?: number; lineRule?: string; left?: number; right?: number; firstLine?: number; hanging?: number; pageBreakBefore?: boolean; keepNext?: boolean; contextual?: boolean; numId?: string; ilvl?: number; shd?: string; bidi?: boolean; tabs?: Tab[]; tabsRaw?: Tab[]; }

const HIGHLIGHT: Record<string, string> = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000', white: 'FFFFFF' };

function parseRPr(el: Element | undefined): RPr {
  if (!el) return {};
  const u = kid(el, 'u');
  const color = attr(kid(el, 'color'), 'val');
  const hl = attr(kid(el, 'highlight'), 'val');
  const shd = attr(kid(el, 'shd'), 'fill');
  const va = attr(kid(el, 'vertAlign'), 'val');
  const sz = num(attr(kid(el, 'sz'), 'val')), szCs = num(attr(kid(el, 'szCs'), 'val'));
  const rf = kid(el, 'rFonts');
  const theme = (t: string | null) => (t ? (/major/i.test(t) ? 'theme:major' : 'theme:minor') : undefined);
  return defined({
    b: onOff(kid(el, 'b')), i: onOff(kid(el, 'i')), u: u ? attr(u, 'val') !== 'none' : undefined,
    strike: onOff(kid(el, 'strike')) ?? onOff(kid(el, 'dstrike')), caps: onOff(kid(el, 'caps')), vanish: onOff(kid(el, 'vanish')),
    sz: sz === undefined ? undefined : sz / 2,
    color: color && color !== 'auto' ? color : undefined,
    highlight: hl && hl !== 'none' ? HIGHLIGHT[hl] : shd && shd !== 'auto' ? shd : undefined,
    vert: va === 'superscript' || va === 'subscript' ? va : undefined,
    rStyle: attr(kid(el, 'rStyle'), 'val') ?? undefined,
    font: attr(rf, 'ascii') ?? attr(rf, 'hAnsi') ?? theme(attr(rf, 'asciiTheme') ?? attr(rf, 'hAnsiTheme')),
    szCs: szCs === undefined ? undefined : szCs / 2, bCs: onOff(kid(el, 'bCs')), iCs: onOff(kid(el, 'iCs')),
    csFont: attr(rf, 'cs') ?? theme(attr(rf, 'cstheme')),
  }) as RPr;
}

function parsePPr(el: Element | undefined): PPr {
  if (!el) return {};
  const sp = kid(el, 'spacing'), ind = kid(el, 'ind'), np = kid(el, 'numPr');
  const jc = attr(kid(el, 'jc'), 'val');
  const JC: Record<string, PPr['jc']> = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'both', distribute: 'both', justify: 'both' };
  const shd = attr(kid(el, 'shd'), 'fill');
  return defined({
    styleId: attr(kid(el, 'pStyle'), 'val') ?? undefined,
    jc: jc ? JC[jc] : undefined,
    before: attr(sp, 'beforeAutospacing') === '1' ? 14 : tw(attr(sp, 'before')),
    after: attr(sp, 'afterAutospacing') === '1' ? 14 : tw(attr(sp, 'after')),
    line: num(attr(sp, 'line')), lineRule: attr(sp, 'lineRule') ?? (attr(sp, 'line') ? 'auto' : undefined),
    left: tw(attr(ind, 'left') ?? attr(ind, 'start')), right: tw(attr(ind, 'right') ?? attr(ind, 'end')),
    firstLine: tw(attr(ind, 'firstLine')), hanging: tw(attr(ind, 'hanging')),
    pageBreakBefore: onOff(kid(el, 'pageBreakBefore')), keepNext: onOff(kid(el, 'keepNext')), contextual: onOff(kid(el, 'contextualSpacing')),
    numId: attr(kid(np, 'numId'), 'val') ?? undefined, ilvl: num(attr(kid(np, 'ilvl'), 'val')),
    shd: shd && shd !== 'auto' ? shd : undefined,
    bidi: onOff(kid(el, 'bidi')),
    tabsRaw: kid(el, 'tabs') ? kids(kid(el, 'tabs'), 'tab').map((t) => ({ val: attr(t, 'val') ?? 'left', pos: tw(attr(t, 'pos')) ?? 0, leader: attr(t, 'leader') ?? undefined })) : undefined,
  }) as PPr;
}

interface Style { type: string; basedOn?: string; p: PPr; r: RPr; borders: boolean | undefined; }
class Styles {
  map = new Map<string, Style>();
  defP: PPr = {}; defR: RPr = { sz: 10 };
  defaultPara?: string; defaultChar?: string; defaultTable?: string;
  private cache = new Map<string, { p: PPr; r: RPr; borders?: boolean }>();
  constructor(doc: Document | null) {
    if (!doc) { this.defR = { sz: 11 }; this.defP = { after: 8, line: 259, lineRule: 'auto' }; return; }
    const root = doc.documentElement;
    const dd = kid(root, 'docDefaults');
    this.defR = merge<RPr>({ sz: 10 }, parseRPr(kid(kid(dd, 'rPrDefault'), 'rPr')));
    this.defP = parsePPr(kid(kid(dd, 'pPrDefault'), 'pPr'));
    for (const s of kids(root, 'style')) {
      const id = attr(s, 'styleId'); if (!id) continue;
      const type = attr(s, 'type') ?? 'paragraph';
      this.map.set(id, { type, basedOn: attr(kid(s, 'basedOn'), 'val') ?? undefined, p: parsePPr(kid(s, 'pPr')), r: parseRPr(kid(s, 'rPr')), borders: tableBorders(kid(kid(s, 'tblPr'), 'tblBorders')) });
      if (attr(s, 'default') === '1') {
        if (type === 'paragraph') this.defaultPara = id; else if (type === 'character') this.defaultChar = id; else if (type === 'table') this.defaultTable = id;
      }
    }
  }
  resolve(id: string | undefined, depth = 0): { p: PPr; r: RPr; borders?: boolean } {
    if (!id || depth > 20) return { p: {}, r: {} };
    const hit = this.cache.get(id); if (hit) return hit;
    const s = this.map.get(id); if (!s) return { p: {}, r: {} };
    const base = this.resolve(s.basedOn, depth + 1);
    const out = { p: merge<PPr>(base.p, s.p), r: merge<RPr>(base.r, s.r), borders: s.borders ?? base.borders };
    out.p.tabsRaw = [...(base.p.tabsRaw ?? []), ...(s.p.tabsRaw ?? [])];
    delete out.p.styleId;
    this.cache.set(id, out);
    return out;
  }
}

/** Apply tab definitions in order ("clear" removes an inherited stop) → sorted usable stops. */
function finalTabs(list: Tab[]): Tab[] {
  const m = new Map<number, Tab>();
  for (const t of list) { const k = Math.round(t.pos * 10); if (t.val === 'clear') m.delete(k); else m.set(k, t); }
  return [...m.values()].filter((t) => t.val !== 'bar').map((t) => ({ ...t, val: t.val === 'start' ? 'left' : t.val === 'end' ? 'right' : t.val, leader: t.leader && t.leader !== 'none' ? t.leader : undefined })).sort((a, b) => a.pos - b.pos);
}

function tableBorders(el: Element | undefined): boolean | undefined {
  if (!el) return undefined;
  return kids(el).some((b) => { const v = attr(b, 'val'); return !!v && v !== 'none' && v !== 'nil'; });
}

// ───────────────────────── numbering ─────────────────────────
interface Lvl { start: number; fmt: string; text: string; p: PPr; r: RPr; }
class Numbering {
  abs = new Map<string, Lvl[]>();
  nums = new Map<string, { abs: string; overrides: Map<number, number> }>();
  counters = new Map<string, number[]>();
  started = new Set<string>();
  constructor(doc: Document | null) {
    if (!doc) return;
    const root = doc.documentElement;
    for (const a of kids(root, 'abstractNum')) {
      const lvls: Lvl[] = [];
      for (const l of kids(a, 'lvl')) {
        const i = num(attr(l, 'ilvl')) ?? 0;
        lvls[i] = { start: num(attr(kid(l, 'start'), 'val')) ?? 1, fmt: attr(kid(l, 'numFmt'), 'val') ?? 'decimal', text: attr(kid(l, 'lvlText'), 'val') ?? '', p: parsePPr(kid(l, 'pPr')), r: parseRPr(kid(l, 'rPr')) };
      }
      this.abs.set(attr(a, 'abstractNumId') ?? '', lvls);
    }
    for (const n of kids(root, 'num')) {
      const overrides = new Map<number, number>();
      for (const o of kids(n, 'lvlOverride')) { const s = num(attr(kid(o, 'startOverride'), 'val')); if (s !== undefined) overrides.set(num(attr(o, 'ilvl')) ?? 0, s); }
      this.nums.set(attr(n, 'numId') ?? '', { abs: attr(kid(n, 'abstractNumId'), 'val') ?? '', overrides });
    }
  }
  level(numId: string, ilvl: number): Lvl | undefined { const n = this.nums.get(numId); return n ? this.abs.get(n.abs)?.[ilvl] : undefined; }
  /** Advance the counter and return the label text. */
  next(numId: string, ilvl: number): string | null {
    const n = this.nums.get(numId); if (!n) return null;
    const lvls = this.abs.get(n.abs); if (!lvls?.[ilvl]) return null;
    let c = this.counters.get(n.abs);
    if (!c) { c = []; this.counters.set(n.abs, c); }
    if (!this.started.has(numId)) { this.started.add(numId); for (const [l, s] of n.overrides) c[l] = s - 1; }
    c[ilvl] = (c[ilvl] ?? (lvls[ilvl].start - 1)) + 1;
    for (let d = ilvl + 1; d < 9; d++) c[d] = undefined as any;
    const lvl = lvls[ilvl];
    if (lvl.fmt === 'bullet') return bulletChar(lvl.text, lvl.r.font);
    if (lvl.fmt === 'none') return '';
    return lvl.text.replace(/%([1-9])/g, (_, k) => { const L = +k - 1; const v = c![L] ?? lvls[L]?.start ?? 1; return fmtNum(v, lvls[L]?.fmt ?? 'decimal'); });
  }
}

function bulletChar(t: string, font?: string): string {
  const ch = t.trim();
  if (!ch) return '•';
  const cp = ch.codePointAt(0)!;
  if (/symbol|wingdings|webdings/i.test(font ?? '') || (cp >= 0xe000 && cp <= 0xf8ff)) {
    if (ch === '' || ch === '§' || cp === 0xf0a7 || cp === 0xf0fc) return '▪';
    return '•';
  }
  if (ch === 'o') return '◦';
  return ch;
}

function roman(n: number): string {
  const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s;
}
function letters(n: number): string { const ch = String.fromCharCode(97 + ((n - 1) % 26)); return ch.repeat(Math.floor((n - 1) / 26) + 1); }
function fmtNum(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter': return letters(n);
    case 'upperLetter': return letters(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'decimalZero': return n < 10 ? '0' + n : String(n);
    default: return String(n);
  }
}

// ───────────────────────── document model ─────────────────────────
type Inline =
  | { kind: 'text'; text: string; r: RPr }
  | { kind: 'tab'; r: RPr }
  | { kind: 'br'; r: RPr }
  | { kind: 'field'; field: 'page' | 'pages'; r: RPr }
  | { kind: 'image'; rel: string; w: number; h: number };
interface Para { kind: 'p'; p: PPr; markR: RPr; runs: Inline[]; label?: { text: string; r: RPr }; }
interface Cell { span: number; blocks: Blk[]; cont: boolean; fill?: string; }
interface Table { kind: 'table'; cols: number[]; rows: { cells: Cell[]; minH: number }[]; borders: boolean; ind: number; }
type Blk = Para | Table | { kind: 'pagebreak' };
interface Sect { w: number; h: number; top: number; right: number; bottom: number; left: number; header: number; footer: number; titlePg: boolean; refs: Record<string, string>; continuous: boolean; }

interface Ctx { styles: Styles; numbering: Numbering; }

function parseSect(el: Element | undefined, prev?: Sect): Sect {
  const sz = kid(el, 'pgSz'), m = kid(el, 'pgMar');
  const refs: Record<string, string> = {};
  for (const r of [...kids(el, 'headerReference'), ...kids(el, 'footerReference')]) refs[`${r.localName === 'headerReference' ? 'h' : 'f'}:${attr(r, 'type') ?? 'default'}`] = attr(r, 'id') ?? '';
  return {
    w: tw(attr(sz, 'w')) ?? prev?.w ?? 612, h: tw(attr(sz, 'h')) ?? prev?.h ?? 792,
    top: Math.abs(tw(attr(m, 'top')) ?? prev?.top ?? 72), bottom: Math.abs(tw(attr(m, 'bottom')) ?? prev?.bottom ?? 72),
    left: tw(attr(m, 'left')) ?? prev?.left ?? 72, right: tw(attr(m, 'right')) ?? prev?.right ?? 72,
    header: tw(attr(m, 'header')) ?? prev?.header ?? 36, footer: tw(attr(m, 'footer')) ?? prev?.footer ?? 36,
    titlePg: onOff(kid(el, 'titlePg')) ?? false,
    refs: { ...(prev?.refs ?? {}), ...refs },
    continuous: attr(kid(el, 'type'), 'val') === 'continuous',
  };
}

/** Parse block-level elements (body, cell, header, text box content). */
function parseBlockList(els: Element[], ctx: Ctx, out: Blk[] = []): Blk[] {
  for (const c of els) {
    switch (c.localName) {
      case 'p': parseParagraph(c, ctx, out); break;
      case 'tbl': out.push(parseTable(c, ctx)); break;
      case 'sdt': parseBlockList(kids(kid(c, 'sdtContent') ?? c), ctx, out); break;
      case 'customXml': case 'ins': case 'moveTo': parseBlockList(kids(c), ctx, out); break;
      case 'AlternateContent': parseBlockList(kids(kid(c, 'Choice') ?? kid(c, 'Fallback')), ctx, out); break;
    }
  }
  return out;
}
const parseBlocks = (container: Element, ctx: Ctx) => parseBlockList(kids(container), ctx);

function parseParagraph(el: Element, ctx: Ctx, out: Blk[]) {
  const pPrEl = kid(el, 'pPr');
  const direct = parsePPr(pPrEl);
  const styleId = direct.styleId ?? ctx.styles.defaultPara;
  const st = ctx.styles.resolve(styleId);
  let p = merge<PPr>(ctx.styles.defP, st.p, direct);
  p.styleId = styleId;
  p.tabs = finalTabs([...(st.p.tabsRaw ?? []), ...(direct.tabsRaw ?? [])]);
  const baseR = merge<RPr>(ctx.styles.defR, st.r);
  const markR = merge<RPr>(baseR, parseRPr(kid(pPrEl, 'rPr')));

  let label: Para['label'];
  if (p.numId && p.numId !== '0') {
    const ilvl = p.ilvl ?? 0;
    const lvl = ctx.numbering.level(p.numId, ilvl);
    if (lvl) {
      p = merge<PPr>(ctx.styles.defP, st.p, lvl.p, direct);
      p.styleId = styleId;
      p.tabs = finalTabs([...(st.p.tabsRaw ?? []), ...(lvl.p.tabsRaw ?? []), ...(direct.tabsRaw ?? [])]);
      const text = ctx.numbering.next(p.numId!, ilvl);
      if (text !== null) label = { text, r: merge<RPr>(markR, lvl.r) };
    }
  }

  const extra: Blk[] = []; // text boxes found inside this paragraph
  let runs: Inline[] = [];
  const pieces: Blk[] = [];
  let labelUsed = false;
  // text before a page break stays on the old page; an empty piece before a break is not a line of its own
  const flushPiece = (beforeBreak = false) => {
    if (!beforeBreak || runs.length) { pieces.push({ kind: 'p', p, markR, runs, label: labelUsed ? undefined : label }); labelUsed = true; }
    runs = [];
  };
  let field: { instr: string; result: boolean; kind?: 'page' | 'pages' } | null = null;

  const runProps = (r: Element) => {
    const d = parseRPr(kid(r, 'rPr'));
    const cs = ctx.styles.resolve(d.rStyle ?? ctx.styles.defaultChar).r;
    return merge<RPr>(baseR, cs, d);
  };
  const doRun = (r: Element) => {
    const rp = runProps(r);
    if (rp.vanish) return;
    for (const c of kids(r)) {
      switch (c.localName) {
        case 't': if (field?.result && field.kind) break; runs.push({ kind: 'text', text: rp.caps ? (c.textContent ?? '').toUpperCase() : (c.textContent ?? ''), r: rp }); break;
        case 'tab': case 'ptab': runs.push({ kind: 'tab', r: rp }); break;
        case 'br': case 'cr':
          if (attr(c, 'type') === 'page') { flushPiece(true); pieces.push({ kind: 'pagebreak' }); }
          else runs.push({ kind: 'br', r: rp });
          break;
        case 'noBreakHyphen': runs.push({ kind: 'text', text: '-', r: rp }); break;
        case 'sym': { const ch = parseInt(attr(c, 'char') ?? '', 16); if (ch && ch < 0xe000) runs.push({ kind: 'text', text: String.fromCodePoint(ch), r: rp }); else if (ch) runs.push({ kind: 'text', text: '•', r: rp }); break; }
        case 'fldChar': {
          const t = attr(c, 'fldCharType');
          if (t === 'begin') field = { instr: '', result: false };
          else if (t === 'separate' && field) { field.result = true; emitField(); }
          else if (t === 'end') { if (field && !field.result) emitField(); field = null; }
          break;
        }
        case 'instrText': if (field) field.instr += c.textContent ?? ''; break;
        case 'drawing': doDrawing(c); break;
        case 'pict': case 'object': doVml(c); break;
        case 'AlternateContent': { const ch = kid(c, 'Choice') ?? kid(c, 'Fallback'); for (const x of kids(ch)) { if (x.localName === 'drawing') doDrawing(x); else if (x.localName === 'pict') doVml(x); } break; }
      }
    }
    function emitField() {
      if (!field) return;
      const ins = field.instr.trim().split(/\s+/)[0]?.toUpperCase();
      if (ins === 'PAGE') field.kind = 'page'; else if (ins === 'NUMPAGES' || ins === 'SECTIONPAGES') field.kind = 'pages';
      if (field.kind) runs.push({ kind: 'field', field: field.kind, r: rp });
    }
  };
  const doDrawing = (d: Element) => {
    const holder = kids(d)[0]; // wp:inline | wp:anchor
    const blip = descendants(d, 'blip')[0];
    const ext = kid(holder, 'extent');
    const id = attr(blip, 'embed') ?? attr(blip, 'link');
    if (id && ext) runs.push({ kind: 'image', rel: id, w: (num(attr(ext, 'cx')) ?? 0) / 12700, h: (num(attr(ext, 'cy')) ?? 0) / 12700 });
    for (const tx of descendants(d, 'txbxContent')) extra.push(...parseBlocks(tx, ctx));
  };
  const doVml = (pict: Element) => {
    const img = descendants(pict, 'imagedata')[0];
    const shape = img?.parentElement;
    const id = attr(img, 'id');
    if (id && shape) {
      const st = attr(shape, 'style') ?? '';
      const len = (k: string) => { const m = st.match(new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([\\d.]+)(pt|in|px|cm|mm)?`)); if (!m) return 0; const v = +m[1]; return m[2] === 'in' ? v * 72 : m[2] === 'px' ? v * 0.75 : m[2] === 'cm' ? v * 28.35 : m[2] === 'mm' ? v * 2.835 : v; };
      runs.push({ kind: 'image', rel: id, w: len('width'), h: len('height') });
    }
    for (const tx of descendants(pict, 'txbxContent')) extra.push(...parseBlocks(tx, ctx));
  };
  const visit = (el: Element) => {
    for (const c of kids(el)) {
      switch (c.localName) {
        case 'r': doRun(c); break;
        case 'hyperlink': case 'ins': case 'smartTag': case 'customXml': case 'moveTo': case 'dir': case 'bdo': visit(c); break;
        case 'sdt': visit(kid(c, 'sdtContent') ?? c); break;
        case 'fldSimple': {
          const ins = (attr(c, 'instr') ?? '').trim().split(/\s+/)[0]?.toUpperCase();
          if (ins === 'PAGE' || ins === 'NUMPAGES') runs.push({ kind: 'field', field: ins === 'PAGE' ? 'page' : 'pages', r: baseR });
          else visit(c);
          break;
        }
        case 'oMath': case 'oMathPara': { const t = descendants(c, 't').map((x) => x.textContent ?? '').join(''); if (t) runs.push({ kind: 'text', text: t, r: baseR }); break; }
      }
    }
  };
  visit(el);
  flushPiece();
  out.push(...pieces, ...extra);
}

function parseTable(el: Element, ctx: Ctx): Table {
  const tblPr = kid(el, 'tblPr');
  const styleId = attr(kid(tblPr, 'tblStyle'), 'val') ?? ctx.styles.defaultTable;
  const borders = tableBorders(kid(tblPr, 'tblBorders')) ?? ctx.styles.resolve(styleId).borders ?? false;
  const cols = kids(kid(el, 'tblGrid'), 'gridCol').map((g) => tw(attr(g, 'w')) ?? 0);
  const rows: Table['rows'] = [];
  for (const tr of kids(el, 'tr')) {
    const cells: Cell[] = [];
    for (const tc of kids(tr, 'tc')) {
      const pr = kid(tc, 'tcPr');
      const vm = kid(pr, 'vMerge');
      const fill = attr(kid(pr, 'shd'), 'fill');
      cells.push({ span: num(attr(kid(pr, 'gridSpan'), 'val')) ?? 1, blocks: parseBlocks(tc, ctx), cont: !!vm && attr(vm, 'val') !== 'restart', fill: fill && fill !== 'auto' ? fill : undefined });
    }
    rows.push({ cells, minH: tw(attr(kid(kid(tr, 'trPr'), 'trHeight'), 'val')) ?? 0 });
  }
  if (!cols.length || cols.every((c) => !c)) {
    const n = Math.max(1, ...rows.map((r) => r.cells.reduce((s, c) => s + c.span, 0)));
    cols.length = 0; for (let i = 0; i < n; i++) cols.push(0);
  }
  return { kind: 'table', cols, rows, borders, ind: tw(attr(kid(tblPr, 'tblInd'), 'w')) ?? 0 };
}

// ───────────────────────── fonts & measuring ─────────────────────────
const ASC = 0.905, DESC = 0.212, NATURAL = 1.149; // Latin line metrics (≈ Arial/Calibri)

interface Env {
  te: TextEngine; images: Map<string, PDFImage | null>; defaultTab: number;
  stats: { skippedImages: number }; theme: { minor?: string; major?: string };
  cache: Map<string, { w: number; asc: number; desc: number }>;
}

// A laid-out box that can be drawn at a given top position.
interface Box { h: number; gap?: boolean; keep?: number; draw?: (page: PDFPage, x: number, top: number, ctx: DrawCtx) => void; split?: (avail: number) => [Box, Box] | null; }
interface DrawCtx { pageH: number; pageNo: number; pages: number; }

type Atom =
  | { t: 'word'; parts: { text: string; r: RPr; w: number; asc: number; desc: number }[]; w: number }
  | { t: 'space'; r: RPr; w: number }
  | { t: 'tab'; r: RPr }
  | { t: 'br' }
  | { t: 'img'; img: PDFImage; w: number; h: number };

/** Characters that may break anywhere (CJK) or are drawn one by one (emoji): split into single-character words. */
const BREAK_ANY = /[⺀-鿿가-힯豈-﫿　-〿＀-￯\u{1F000}-\u{1FAFF}\u{20000}-\u{2FFFF}☀-➿]/u;
const COMPLEX = /[֐-ࣿיִ-﷿ﹰ-﻿ऀ-෿฀-๿]/;

function clean(s: string): string {
  let out = '';
  for (const ch of s.replace(/[­​﻿]/g, '')) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xa0) out += ' ';
    else if (cp === 0x2011) out += '-';
    else if (cp >= 32) out += ch;
  }
  return out;
}
const fontSize = (r: RPr) => (r.sz ?? 11) * (r.vert ? 0.65 : 1);
/** Word uses the complex-script properties (szCs, bCs, iCs, cs font) for Arabic, Hebrew and Indic text. */
function forText(r: RPr, text: string): RPr {
  if (!COMPLEX.test(text)) return r;
  return { ...r, sz: r.szCs ?? r.sz, b: r.bCs ?? r.b, i: r.iCs ?? r.i, font: r.csFont ?? r.font };
}
function styleOf(env: Env, r: RPr): TextStyle {
  const name = r.font === 'theme:minor' ? env.theme.minor ?? 'Calibri' : r.font === 'theme:major' ? env.theme.major ?? 'Calibri Light' : r.font;
  return { family: familyFor(name), bold: !!r.b, italic: !!r.i };
}
function metrics(env: Env, text: string, r: RPr) {
  if (!text) return { w: 0, asc: 0, desc: 0 };
  const key = `${text}\u0000${r.font}|${r.b ? 1 : 0}${r.i ? 1 : 0}|${fontSize(r)}`;
  let m = env.cache.get(key);
  if (!m) { const sh = env.te.shape(text, styleOf(env, r), fontSize(r)); m = { w: sh.width, asc: sh.ascent, desc: sh.descent }; env.cache.set(key, m); }
  return m;
}
const measure = (env: Env, text: string, r: RPr) => metrics(env, text, r).w;

function atomsOf(para: Para, env: Env, fieldText: (f: 'page' | 'pages') => string): Atom[] {
  const atoms: Atom[] = [];
  let word: Extract<Atom, { t: 'word' }> | null = null;
  const endWord = () => { if (word) atoms.push(word); word = null; };
  const addPart = (text: string, r: RPr) => {
    const m = metrics(env, text, r);
    if (!word) word = { t: 'word', parts: [], w: 0 };
    word.parts.push({ text, r, w: m.w, asc: m.asc, desc: m.desc });
    word.w += m.w;
  };
  for (const run of para.runs) {
    if (run.kind === 'tab') { endWord(); atoms.push({ t: 'tab', r: run.r }); continue; }
    if (run.kind === 'br') { endWord(); atoms.push({ t: 'br' }); continue; }
    if (run.kind === 'image') {
      endWord();
      const img = env.images.get(run.rel);
      if (img && run.w > 0 && run.h > 0) atoms.push({ t: 'img', img, w: run.w, h: run.h });
      continue;
    }
    const text = run.kind === 'field' ? fieldText(run.field) : clean(run.text);
    for (const seg of text.split(/( +)/)) {
      if (!seg) continue;
      if (seg[0] === ' ') { endWord(); atoms.push({ t: 'space', r: run.r, w: measure(env, seg, run.r) }); continue; }
      const r = forText(run.r, seg);
      if (!BREAK_ANY.test(seg)) { addPart(seg, r); continue; }
      // CJK / emoji: every character is its own breakable word
      let buf = '';
      for (const ch of seg) {
        if (BREAK_ANY.test(ch)) { if (buf) { addPart(buf, r); buf = ''; } endWord(); addPart(ch, r); endWord(); }
        else buf += ch;
      }
      if (buf) addPart(buf, r);
    }
  }
  endWord();
  return atoms;
}

/** Every string the layout will shape, with its style (so fonts and fallbacks can be loaded up front). */
function collectText(blocks: Blk[], env: Env, out: { text: string; style: TextStyle }[]) {
  for (const b of blocks) {
    if (b.kind === 'p') {
      if (b.label) out.push({ text: clean(b.label.text), style: styleOf(env, b.label.r) });
      out.push({ text: '.-_·0123456789', style: styleOf(env, b.markR) });
      for (const run of b.runs) {
        if (run.kind === 'field') { out.push({ text: '0123456789', style: styleOf(env, run.r) }); continue; }
        if (run.kind !== 'text') continue;
        for (const seg of clean(run.text).split(/ +/)) {
          if (!seg) continue;
          const r = forText(run.r, seg);
          if (!BREAK_ANY.test(seg)) { out.push({ text: seg, style: styleOf(env, r) }); continue; }
          let buf = '';
          for (const ch of seg) { if (BREAK_ANY.test(ch)) { if (buf) out.push({ text: buf, style: styleOf(env, r) }); buf = ''; out.push({ text: ch, style: styleOf(env, r) }); } else buf += ch; }
          if (buf) out.push({ text: buf, style: styleOf(env, r) });
        }
      }
    } else if (b.kind === 'table') for (const row of b.rows) for (const c of row.cells) collectText(c.blocks, env, out);
  }
}

interface Item { x: number; w: number; text?: string; r?: RPr; img?: PDFImage; h?: number; leader?: string; tabR?: RPr; }
interface Line { items: Item[]; width: number; asc: number; desc: number; size: number; endsWithBr: boolean; spaces: number[]; }

/** Break atoms into lines. Positions are relative to the paragraph's start indent (`absLeft` from the margin). */
function breakLines(atoms: Atom[], env: Env, avail0: number, firstStart: number, absLeft: number, markSize: number, tabs: Tab[]): Line[] {
  const lines: Line[] = [];
  const newLine = (): Line => ({ items: [], width: 0, asc: 0, desc: 0, size: 0, endsWithBr: false, spaces: [] });
  let cur = newLine();
  let x = firstStart; // current pen position within the line
  const avail = avail0;
  let pendingSpace: { w: number; r: RPr } | null = null;
  let pendingTab: { item: Item; type: string; pos: number; start: number } | null = null;
  const bump = (r: RPr, asc?: number, desc?: number) => {
    const s = fontSize(r);
    cur.size = Math.max(cur.size, r.sz ?? 11);
    cur.asc = Math.max(cur.asc, (asc ?? s * ASC) + (r.vert === 'superscript' ? s * 0.5 : 0));
    cur.desc = Math.max(cur.desc, (desc ?? s * DESC) + (r.vert === 'subscript' ? s * 0.25 : 0));
  };
  // right/center/decimal tab: shift the text typed after it so it ends at (or centres on) the stop
  const finishTab = () => {
    if (!pendingTab) return;
    const seg = x - pendingTab.pos;
    const shift = Math.max(0, Math.min(pendingTab.type === 'center' ? seg / 2 : seg, pendingTab.item.w));
    for (let k = pendingTab.start; k < cur.items.length; k++) cur.items[k].x -= shift;
    pendingTab.item.w -= shift;
    x -= shift;
    pendingTab = null;
  };
  const push = (br: boolean) => {
    finishTab();
    cur.endsWithBr = br;
    if (!cur.items.length) { cur.asc = markSize * ASC; cur.desc = markSize * DESC; cur.size = markSize; }
    lines.push(cur); cur = newLine(); x = 0; pendingSpace = null;
  };
  const effX = (w: number) => {
    if (!pendingTab || pendingTab.type === 'left') return x;
    const seg = x + w - pendingTab.pos;
    return x - Math.max(0, Math.min(pendingTab.type === 'center' ? seg / 2 : seg, pendingTab.item.w));
  };
  const place = (w: number, add: () => void) => {
    const sp = pendingSpace && cur.items.length ? pendingSpace.w : 0;
    if (cur.items.length && effX(sp + w) + sp + w > avail + 0.01) push(false);
    else if (sp) { cur.spaces.push(cur.items.length); cur.items.push({ x, w: sp, text: ' ', r: pendingSpace!.r }); x += sp; }
    pendingSpace = null;
    add();
  };
  for (const a of atoms) {
    if (a.t === 'space') { pendingSpace = pendingSpace ? { w: pendingSpace.w + a.w, r: a.r } : { w: a.w, r: a.r }; continue; }
    if (a.t === 'br') { pendingSpace = null; push(true); continue; }
    if (a.t === 'tab') {
      if (pendingSpace && cur.items.length) x += pendingSpace.w;
      pendingSpace = null;
      finishTab();
      const abs = absLeft + x;
      const stop = tabs.find((t) => t.pos > abs + 0.5);
      if (stop && stop.pos - absLeft <= avail + 0.5) {
        const pos = stop.pos - absLeft;
        const item: Item = { x, w: pos - x, leader: stop.leader, tabR: a.r };
        cur.items.push(item); bump(a.r);
        x = pos;
        if (stop.val !== 'left' && stop.val !== 'num') pendingTab = { item, type: stop.val, pos, start: cur.items.length };
        continue;
      }
      const next = (Math.floor(abs / env.defaultTab + 1e-6) + 1) * env.defaultTab - absLeft;
      if (next > avail) push(false);
      else { cur.items.push({ x, w: next - x }); x = next; bump(a.r); }
      continue;
    }
    if (a.t === 'img') {
      place(a.w, () => { cur.items.push({ x, w: a.w, img: a.img, h: a.h }); x += a.w; cur.asc = Math.max(cur.asc, a.h); });
      continue;
    }
    // word (possibly several styled parts)
    if (a.w > avail && !cur.items.length) {
      // longer than a whole line: break by characters
      for (const part of a.parts) {
        let buf = '';
        for (const ch of part.text) {
          const w = measure(env, buf + ch, part.r);
          if (x + w > avail && (buf || cur.items.length)) {
            if (buf) { cur.items.push({ x, w: measure(env, buf, part.r), text: buf, r: part.r }); bump(part.r, part.asc, part.desc); }
            push(false); buf = ch;
          } else buf += ch;
        }
        if (buf) { const w = measure(env, buf, part.r); cur.items.push({ x, w, text: buf, r: part.r }); bump(part.r, part.asc, part.desc); x += w; }
      }
      continue;
    }
    place(a.w, () => { for (const p of a.parts) { cur.items.push({ x, w: p.w, text: p.text, r: p.r }); bump(p.r, p.asc, p.desc); x += p.w; } });
  }
  if (cur.items.length || !lines.length || lines[lines.length - 1].endsWithBr) push(false);
  for (const l of lines) {
    // drop trailing spaces for alignment
    while (l.items.length && l.items[l.items.length - 1].text === ' ') { l.items.pop(); l.spaces = l.spaces.filter((i) => i < l.items.length); }
    const last = l.items[l.items.length - 1];
    l.width = last ? last.x + last.w : 0;
  }
  return lines;
}

/** Reorder a line's items for bidi text. In an RTL paragraph positions are measured from the right edge. */
function bidiLine(l: Line, rtl: boolean, firstStart: number) {
  const hasR = l.items.some((it) => it.text && strongDir(it.text) === 'R');
  if (!hasR && !rtl) return;
  if (l.items.some((it) => it.leader !== undefined)) return; // keep tab-aligned lines as typed
  const cls = l.items.map((it): 'R' | 'L' | 'NUM' | 'N' => {
    if (!it.text || it.text === ' ') return 'N';
    const d = strongDir(it.text);
    return d === 'R' ? 'R' : d === 'L' ? 'L' : /\d/.test(it.text) ? 'NUM' : 'N';
  });
  let order = visualOrder(bidiLevels(cls, rtl));
  if (rtl) order = order.reverse(); // laid out from the start (right) edge, mirrored when drawn
  const spaceSet = new Set(l.spaces.map((i) => l.items[i]));
  const items = order.map((i) => l.items[i]);
  let x = l.items.length ? Math.min(firstStart, l.items[0].x) : 0;
  for (const it of items) { it.x = x; x += it.w; }
  l.items = items;
  l.spaces = items.map((it, i) => (spaceSet.has(it) ? i : -1)).filter((i) => i >= 0);
  l.width = x;
}

const hex = (c?: string) => {
  if (!c || !/^[0-9a-f]{6}$/i.test(c)) return rgb(0, 0, 0);
  return rgb(parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255);
};
const rgbArr = (c?: string): [number, number, number] => (c && /^[0-9a-f]{6}$/i.test(c) ? [parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255] : [0, 0, 0]);

function lineHeight(p: PPr, l: Line): { h: number; base: number } {
  const natural = Math.max(Math.max(l.asc + l.desc, l.size * (ASC + DESC)) * (NATURAL / (ASC + DESC)), 1);
  const imgExtra = Math.max(0, l.asc - l.size * ASC * 1.4);
  const rule = p.lineRule ?? 'auto', v = p.line;
  if (rule === 'exact' && v) return { h: v / 20, base: Math.min(l.asc, v / 20 * 0.8) };
  if (rule === 'atLeast' && v) { const h = Math.max(natural, v / 20); return { h, base: l.asc + (h - natural) }; }
  const mult = v ? v / 240 : 1;
  return { h: (natural - imgExtra) * mult + imgExtra, base: l.asc + Math.max(0, (natural - l.asc - l.desc) / 2) };
}

// ───────────────────────── layout → boxes ─────────────────────────
function layoutBlocks(blocks: Blk[], width: number, env: Env, fieldText: (f: 'page' | 'pages') => string = () => '1'): Box[] {
  const boxes: Box[] = [];
  let prev: { styleId?: string; contextual?: boolean; afterBox?: Box } | null = null;
  for (const b of blocks) {
    if (b.kind === 'pagebreak') { boxes.push({ h: 0, keep: -1 }); prev = null; continue; }
    if (b.kind === 'table') { boxes.push(...layoutTable(b, width, env, fieldText)); prev = null; continue; }
    const p = b.p;
    const rtl = p.bidi ?? (strongDir(b.runs.map((r) => (r.kind === 'text' ? r.text : '')).join('')) === 'R');
    // indents are logical (start/end): in an RTL paragraph "left" is the right-hand side
    const left = p.left ?? 0, right = p.right ?? 0;
    const first = p.hanging ? -p.hanging : p.firstLine ?? 0;
    const markSize = b.markR.sz ?? 11;
    let before = p.before ?? 0;
    if (prev?.contextual && p.contextual && prev.styleId === p.styleId) { before = 0; if (prev.afterBox) prev.afterBox.h = 0; }
    if (p.pageBreakBefore) boxes.push({ h: 0, keep: -1 });
    if (before) boxes.push({ h: before, gap: true });

    // label (bullet / number)
    let labelItem: Item | null = null;
    let firstStart = first; // pen start of the first line, relative to `left`
    const labelX = left + first;
    if (b.label) {
      const lr = forText(b.label.r, b.label.text);
      const text = clean(b.label.text);
      const lw = measure(env, text, lr);
      labelItem = { x: labelX, w: lw, text, r: lr };
      // tab after the label: to the hanging indent, or the next default stop
      const end = labelX + lw;
      const stop = (p.tabs ?? []).find((t) => t.pos > end + 0.5 && t.pos < left - 0.5);
      firstStart = stop ? stop.pos - left : end < left - 0.5 ? 0 : (Math.floor(end / env.defaultTab + 1e-6) + 1) * env.defaultTab - left;
    }

    const textW = Math.max(width - left - right, 10);
    const atoms = atomsOf(b, env, fieldText);
    const lines = breakLines(atoms, env, textW, firstStart, left, markSize, p.tabs ?? []);
    lines.forEach((l, i) => bidiLine(l, rtl, i === 0 ? firstStart : 0));
    if (labelItem) { const l0 = lines[0]; const m = metrics(env, labelItem.text!, labelItem.r!); l0.asc = Math.max(l0.asc, m.asc); l0.desc = Math.max(l0.desc, m.desc); }

    lines.forEach((l, idx) => {
      const { h, base } = lineHeight(p, l);
      const isLast = idx === lines.length - 1;
      const jc = p.jc ?? 'left';
      const free = textW - l.width;
      let shift = 0, spaceAdd = 0;
      if (jc === 'center') shift = free / 2;
      else if (jc === 'right') shift = free;
      else if (jc === 'both' && !isLast && !l.endsWithBr && l.spaces.length) spaceAdd = free / l.spaces.length;
      const label = idx === 0 ? labelItem : null;
      const keep = isLast && p.keepNext ? 28 : undefined;
      // start-space x → page x (mirrored for RTL paragraphs)
      const X = (x0: number, sx: number, w: number) => (rtl ? x0 + width - sx - w : x0 + sx);
      boxes.push({
        h, keep,
        draw: (page, x0, top, dc) => {
          const baseY = dc.pageH - top - base;
          if (label) drawText(page, env, label.text!, label.r!, X(x0, label.x, label.w), baseY, label.w, rtl);
          let extra = 0;
          l.items.forEach((it, k) => {
            const sx = left + shift + it.x + extra;
            if (spaceAdd && l.spaces.includes(k)) {
              if (it.r?.u) drawText(page, env, '', it.r, X(x0, sx, it.w + spaceAdd), baseY, it.w + spaceAdd, rtl);
              extra += spaceAdd; return;
            }
            const x = X(x0, sx, it.w);
            if (it.img) { page.drawImage(it.img, { x, y: baseY, width: it.w, height: it.h! }); return; }
            if (it.leader && it.tabR && it.w > 6) drawLeader(page, env, it.leader, it.tabR, x, baseY, it.w);
            if (it.text && it.r) drawText(page, env, it.text, it.r, x, baseY, it.w, rtl);
          });
        },
      });
    });
    const afterBox: Box = { h: p.after ?? 0, gap: true };
    boxes.push(afterBox);
    prev = { styleId: p.styleId, contextual: p.contextual, afterBox };
  }
  return boxes;
}

function drawText(page: PDFPage, env: Env, text: string, r: RPr, x: number, baseY: number, w: number, rtl = false) {
  const size = fontSize(r);
  const y = baseY + (r.vert === 'superscript' ? (r.sz ?? 11) * 0.33 : r.vert === 'subscript' ? -(r.sz ?? 11) * 0.12 : 0);
  if (r.highlight) page.drawRectangle({ x, y: y - size * DESC, width: w, height: size * (ASC + DESC), color: hex(r.highlight) });
  if (text.trim()) env.te.drawOnPage(page, env.te.shape(text, styleOf(env, r), size, rtl && strongDir(text) === 'N' ? true : undefined), x, y, { color: rgbArr(r.color) });
  const color = hex(r.color);
  const th = Math.max(size * 0.05, 0.5);
  if (r.u) page.drawLine({ start: { x, y: y - size * 0.11 }, end: { x: x + w, y: y - size * 0.11 }, thickness: th, color });
  if (r.strike) page.drawLine({ start: { x, y: y + size * 0.28 }, end: { x: x + w, y: y + size * 0.28 }, thickness: th, color });
}

/** Tab leader (dots, dashes, underline) across a tab's width. */
function drawLeader(page: PDFPage, env: Env, leader: string, r: RPr, x: number, baseY: number, w: number) {
  if (leader === 'underscore' || leader === 'heavy') { page.drawLine({ start: { x: x + 2, y: baseY - 1 }, end: { x: x + w - 2, y: baseY - 1 }, thickness: leader === 'heavy' ? 1.2 : 0.6, color: hex(r.color) }); return; }
  const ch = leader === 'hyphen' ? '-' : leader === 'middleDot' ? '·' : '.';
  const cw = measure(env, ch + ' ', r) || 3;
  const n = Math.floor((w - 4) / cw);
  if (n < 1) return;
  const s = (ch + ' ').repeat(n).trimEnd();
  const sw = measure(env, s, r);
  env.te.drawOnPage(page, env.te.shape(s, styleOf(env, r), fontSize(r)), x + w - sw - 2, baseY, { color: rgbArr(r.color) });
}

const PAD = 5.4; // Word's default cell margin (0.075 in)

function layoutTable(t: Table, width: number, env: Env, fieldText: (f: 'page' | 'pages') => string): Box[] {
  const avail = Math.max(width - t.ind, 20);
  let cols = t.cols.slice();
  const sum = cols.reduce((a, b) => a + b, 0);
  if (!sum) cols = cols.map(() => avail / cols.length);
  else if (sum > avail) cols = cols.map((c) => (c * avail) / sum);
  const boxes: Box[] = [];
  for (let ri = 0; ri < t.rows.length; ri++) {
    const row = t.rows[ri];
    let ci = 0;
    const cells = row.cells.map((c) => {
      const x = cols.slice(0, ci).reduce((a, b) => a + b, 0);
      const w = cols.slice(ci, ci + c.span).reduce((a, b) => a + b, 0) || 20;
      ci += c.span;
      const nextCont = t.rows[ri + 1]?.cells.some((n, k) => n.cont && colStart(t.rows[ri + 1].cells, k) === colStart(row.cells, row.cells.indexOf(c)));
      return { x, w, fill: c.fill, cont: c.cont, nextCont, boxes: trimGaps(layoutBlocks(c.blocks, w - 2 * PAD, env, fieldText)) };
    });
    boxes.push(rowBox(cells, row.minH, t.borders, t.ind));
  }
  boxes.push({ h: 0, gap: true });
  return boxes;
}
const colStart = (cells: Cell[], idx: number) => cells.slice(0, idx).reduce((s, c) => s + c.span, 0);
function trimGaps(b: Box[]): Box[] { const out = b.slice(); while (out.length && out[out.length - 1].gap) out.pop(); while (out.length && out[0].gap) out.shift(); return out; }

interface CellLayout { x: number; w: number; fill?: string; cont: boolean; nextCont?: boolean; boxes: Box[]; }
function rowBox(cells: CellLayout[], minH: number, borders: boolean, ind: number): Box {
  const contentH = (c: CellLayout) => c.boxes.reduce((s, b) => s + (b.keep === -1 ? 0 : b.h), 0);
  const h = Math.max(minH, ...cells.map((c) => contentH(c) + 2), 4);
  return {
    h,
    draw: (page, x0, top, dc) => {
      for (const c of cells) {
        const x = x0 + ind + c.x;
        if (c.fill && /^[0-9a-f]{6}$/i.test(c.fill)) page.drawRectangle({ x, y: dc.pageH - top - h, width: c.w, height: h, color: hex(c.fill) });
        let y = top + 1;
        for (const b of c.boxes) { b.draw?.(page, x + PAD, y, dc); y += b.keep === -1 ? 0 : b.h; }
        if (borders) {
          const yT = dc.pageH - top, yB = dc.pageH - top - h, col = rgb(0, 0, 0), th = 0.5;
          if (!c.cont) page.drawLine({ start: { x, y: yT }, end: { x: x + c.w, y: yT }, thickness: th, color: col });
          if (!c.nextCont) page.drawLine({ start: { x, y: yB }, end: { x: x + c.w, y: yB }, thickness: th, color: col });
          page.drawLine({ start: { x, y: yT }, end: { x, y: yB }, thickness: th, color: col });
          page.drawLine({ start: { x: x + c.w, y: yT }, end: { x: x + c.w, y: yB }, thickness: th, color: col });
        }
      }
    },
    split: (avail) => {
      if (avail < 12) return null;
      const a: CellLayout[] = [], rest: CellLayout[] = [];
      let any = false, left = false;
      for (const c of cells) {
        let used = 1; let k = 0;
        while (k < c.boxes.length && used + c.boxes[k].h <= avail - 1) { used += c.boxes[k].h; k++; }
        if (k > 0) any = true;
        if (k < c.boxes.length) left = true;
        a.push({ ...c, nextCont: false, boxes: c.boxes.slice(0, k) });
        rest.push({ ...c, cont: false, boxes: trimGaps(c.boxes.slice(k)) });
      }
      if (!any || !left) return null;
      const first = rowBox(a, 0, borders, ind);
      first.h = avail;
      return [first, rowBox(rest, 0, borders, ind)];
    },
  };
}

// ───────────────────────── images ─────────────────────────
export type ImageConverter = (bytes: Uint8Array, name: string) => Promise<Uint8Array | null>; // → PNG bytes

async function embedImages(doc: PDFDocument, zip: any, rels: Map<string, string>, base: string, used: Set<string>, env: Env, convert?: ImageConverter) {
  for (const id of used) {
    if (env.images.has(id)) continue;
    const target = rels.get(id);
    let img: PDFImage | null = null;
    if (target) {
      const path = resolvePath(base, target);
      const file = zip.file(path);
      if (file) {
        const bytes: Uint8Array = await file.async('uint8array');
        try {
          if (bytes[0] === 0x89 && bytes[1] === 0x50) img = await doc.embedPng(bytes);
          else if (bytes[0] === 0xff && bytes[1] === 0xd8) img = await doc.embedJpg(bytes);
          else if (convert) { const png = await convert(bytes, path); if (png) img = await doc.embedPng(png); }
        } catch { img = null; }
      }
    }
    if (!img) env.stats.skippedImages++;
    env.images.set(id, img);
  }
}
function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  return parts.join('/');
}
function collectImageRels(blocks: Blk[], into: Set<string>) {
  for (const b of blocks) {
    if (b.kind === 'p') for (const r of b.runs) { if (r.kind === 'image') into.add(r.rel); }
    else if (b.kind === 'table') for (const row of b.rows) for (const c of row.cells) collectImageRels(c.blocks, into);
  }
}
/** Scale images that are larger than the text area. */
function fitImages(blocks: Blk[], maxW: number, maxH: number) {
  for (const b of blocks) {
    if (b.kind === 'p') for (const r of b.runs) {
      if (r.kind !== 'image') continue;
      const k = Math.min(1, maxW / (r.w || 1), maxH / (r.h || 1));
      r.w *= k; r.h *= k;
    } else if (b.kind === 'table') for (const row of b.rows) for (const c of row.cells) fitImages(c.blocks, maxW, maxH);
  }
}

// ───────────────────────── main ─────────────────────────
export interface DocxResult { pdf: Uint8Array; pages: number; missingGlyphs: number; skippedImages: number; }

export async function docxToPdf(input: ArrayBuffer | Uint8Array, opts: { convertImage?: ImageConverter; parser?: DOMParser; title?: string; fetchFont?: (url: string) => Promise<Uint8Array | null> } = {}): Promise<DocxResult> {
  const { default: JSZip } = await import('jszip');
  let zip: any;
  try { zip = await JSZip.loadAsync(input); } catch { throw new Error('NOT_DOCX'); }
  const read = async (path: string) => { const f = zip.file(path); return f ? (await f.async('string')) as string : null; };
  const parser = opts.parser ?? new DOMParser();
  const xml = (s: string | null) => (s ? parser.parseFromString(s, 'application/xml') : null);

  // the main part is normally word/document.xml, but follow the package relationship to be sure
  const rootRels = xml(await read('_rels/.rels'));
  const mainTarget = rootRels ? kids(rootRels.documentElement, 'Relationship').find((r) => /officeDocument$/.test(attr(r, 'Type') ?? '')) : undefined;
  const mainPath = mainTarget ? resolvePath('', attr(mainTarget, 'Target') ?? 'word/document.xml') : 'word/document.xml';
  const docXml = xml(await read(mainPath));
  if (!docXml || !kid(docXml.documentElement, 'body')) throw new Error('NOT_DOCX');
  const dir = mainPath.split('/').slice(0, -1).join('/');
  const relsPath = `${dir}/_rels/${mainPath.split('/').pop()}.rels`;
  const relsDoc = xml(await read(relsPath));
  const rels = new Map<string, string>();
  const relTypes = new Map<string, string>();
  for (const r of kids(relsDoc?.documentElement, 'Relationship')) { rels.set(attr(r, 'Id') ?? '', attr(r, 'Target') ?? ''); relTypes.set(attr(r, 'Id') ?? '', attr(r, 'Type') ?? ''); }
  const partOf = (type: RegExp) => { for (const [id, t] of relTypes) if (type.test(t)) return resolvePath(mainPath, rels.get(id)!); return null; };

  const ctx: Ctx = {
    styles: new Styles(xml(await read(partOf(/\/styles$/) ?? `${dir}/styles.xml`))),
    numbering: new Numbering(xml(await read(partOf(/\/numbering$/) ?? `${dir}/numbering.xml`))),
  };
  const settings = xml(await read(partOf(/\/settings$/) ?? `${dir}/settings.xml`));
  const defaultTab = (tw(attr(kid(settings?.documentElement, 'defaultTabStop'), 'val')) ?? 36) || 36;
  // theme fonts (body = minor, headings = major)
  const themeXml = xml(await read(partOf(/\/theme$/) ?? `${dir}/theme/theme1.xml`));
  const themeFont = (which: string) => { const f = themeXml ? descendants(themeXml.documentElement, which)[0] : undefined; return attr(kid(f, 'latin'), 'typeface') || undefined; };
  const theme = { minor: themeFont('minorFont'), major: themeFont('majorFont') };

  // body → sections (a paragraph's sectPr closes the section that ends with it)
  const body = kid(docXml.documentElement, 'body')!;
  const sections: { sect: Sect; blocks: Blk[] }[] = [];
  let prevSect: Sect | undefined;
  let out: Blk[] = [];
  for (const c of kids(body)) {
    if (c.localName === 'sectPr') continue;
    parseBlockList([c], ctx, out);
    const sp = c.localName === 'p' ? kid(kid(c, 'pPr'), 'sectPr') : undefined;
    if (sp) { prevSect = parseSect(sp, prevSect); sections.push({ sect: prevSect, blocks: out }); out = []; }
  }
  sections.push({ sect: parseSect(kid(body, 'sectPr'), prevSect), blocks: out });

  // fonts: loaded per script and style on demand
  const doc = await PDFDocument.create();
  const te = await TextEngine.create(doc, opts.fetchFont);
  const env: Env = { te, images: new Map(), defaultTab, stats: { skippedImages: 0 }, theme, cache: new Map() };

  // headers / footers (parsed per relationship id)
  const hfCache = new Map<string, Blk[]>();
  const hfBlocks = async (id: string | undefined) => {
    if (!id) return null;
    if (hfCache.has(id)) return hfCache.get(id)!;
    const path = rels.get(id) ? resolvePath(mainPath, rels.get(id)!) : null;
    const x = path ? xml(await read(path)) : null;
    const blocks = x ? parseBlocks(x.documentElement, ctx) : [];
    // header images use the header part's own relationships: register them under a prefixed id
    if (path) {
      const hr = xml(await read(`${path.split('/').slice(0, -1).join('/')}/_rels/${path.split('/').pop()}.rels`));
      const map = new Map<string, string>();
      for (const r of kids(hr?.documentElement, 'Relationship')) map.set(attr(r, 'Id') ?? '', attr(r, 'Target') ?? '');
      const remap = (bs: Blk[]) => {
        for (const b of bs) {
          if (b.kind === 'p') for (const r of b.runs) { if (r.kind === 'image') { const t = map.get(r.rel); r.rel = `${id}:${r.rel}`; if (t) rels.set(r.rel, '/' + resolvePath(path, t)); } }
          else if (b.kind === 'table') for (const row of b.rows) for (const c of row.cells) remap(c.blocks);
        }
      };
      remap(blocks);
    }
    hfCache.set(id, blocks);
    return blocks;
  };

  // images
  const used = new Set<string>();
  for (const s of sections) {
    fitImages(s.blocks, s.sect.w - s.sect.left - s.sect.right, s.sect.h - s.sect.top - s.sect.bottom);
    collectImageRels(s.blocks, used);
    for (const key of Object.keys(s.sect.refs)) { const hb = await hfBlocks(s.sect.refs[key]); if (hb) { fitImages(hb, s.sect.w - s.sect.left - s.sect.right, s.sect.h / 3); collectImageRels(hb, used); } }
  }
  await embedImages(doc, zip, rels, mainPath, used, env, opts.convertImage);

  // every string that will be drawn → load its fonts (and canvas fallbacks) once
  const texts: { text: string; style: TextStyle }[] = [];
  for (const s of sections) {
    collectText(s.blocks, env, texts);
    for (const key of Object.keys(s.sect.refs)) { const hb = await hfBlocks(s.sect.refs[key]); if (hb) collectText(hb, env, texts); }
  }
  await te.prepare(texts);

  // paginate
  const pageInfo: { page: PDFPage; sect: Sect; firstOfSect: boolean }[] = [];
  let page: PDFPage | null = null;
  let y = 0, atTop = true, sect: Sect = sections[0].sect, firstOfSect = true;
  const newPage = () => {
    page = doc.addPage([sect.w, sect.h]);
    pageInfo.push({ page, sect, firstOfSect });
    firstOfSect = false;
    y = sect.top; atTop = true;
  };
  const dc = (): DrawCtx => ({ pageH: sect.h, pageNo: pageInfo.length, pages: 0 });
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si];
    const prev = sect;
    sect = s.sect;
    firstOfSect = true;
    if (!page || !(sect.continuous && si > 0)) newPage();
    else if (prev.w !== sect.w || prev.h !== sect.h) newPage();
    const contentW = sect.w - sect.left - sect.right;
    const bottom = sect.h - sect.bottom;
    const queue = layoutBlocks(s.blocks, contentW, env);
    for (let b of queue) {
      if (b.keep === -1) { if (!atTop) newPage(); continue; }
      if (b.gap) { if (!atTop) y += b.h; continue; }
      const need = b.keep ?? 0;
      if (y + b.h > bottom + 0.01 && !atTop) {
        const parts = b.split?.(bottom - y);
        if (parts) { parts[0].draw?.(page!, sect.left, y, dc()); b = parts[1]; }
        newPage();
      } else if (need && y + b.h + need > bottom && !atTop && b.h + need < bottom - sect.top) newPage();
      // a box taller than a whole page: split it if we can
      while (b.h > bottom - y + 0.01 && b.split) {
        const parts = b.split(bottom - y);
        if (!parts) break;
        parts[0].draw?.(page!, sect.left, y, dc()); newPage(); b = parts[1];
      }
      b.draw?.(page!, sect.left, y, dc());
      y += b.h; atTop = false;
    }
  }

  // headers & footers (need the total page count)
  const total = pageInfo.length;
  const evenOdd = !!kid(settings?.documentElement, 'evenAndOddHeaders');
  for (let i = 0; i < pageInfo.length; i++) {
    const { page: pg, sect: sc, firstOfSect: first } = pageInfo[i];
    const pick = (kind: 'h' | 'f') => (first && sc.titlePg ? sc.refs[`${kind}:first`] ?? '' : evenOdd && (i + 1) % 2 === 0 ? sc.refs[`${kind}:even`] ?? sc.refs[`${kind}:default`] : sc.refs[`${kind}:default`]);
    const ft = (f: 'page' | 'pages') => String(f === 'page' ? i + 1 : total);
    const cw = sc.w - sc.left - sc.right;
    const d: DrawCtx = { pageH: sc.h, pageNo: i + 1, pages: total };
    const hb = await hfBlocks(pick('h'));
    if (hb?.length) { let yy = sc.header; for (const b of trimGaps(layoutBlocks(hb, cw, env, ft))) { if (b.keep === -1) continue; b.draw?.(pg, sc.left, yy, d); yy += b.h; } }
    const fb = await hfBlocks(pick('f'));
    if (fb?.length) {
      const boxes = trimGaps(layoutBlocks(fb, cw, env, ft)).filter((b) => b.keep !== -1);
      let yy = sc.h - sc.footer - boxes.reduce((s, b) => s + b.h, 0);
      for (const b of boxes) { b.draw?.(pg, sc.left, yy, d); yy += b.h; }
    }
  }

  if (opts.title) doc.setTitle(opts.title);
  doc.setProducer('PDFSherpa');
  doc.setCreator('PDFSherpa Word to PDF');
  const pdf = await doc.save();
  return { pdf, pages: total, missingGlyphs: te.missing, skippedImages: env.stats.skippedImages };
}
