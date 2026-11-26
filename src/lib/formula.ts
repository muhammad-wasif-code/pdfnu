/**
 * A small Excel formula engine: used when a workbook stores formulas without their results
 * (files written by scripts, apps and some exporters), and for conditional-formatting rules.
 * Covers arithmetic, comparisons, text joining, ranges across sheets, defined names and ~90
 * common functions. Anything it doesn't know returns an "unsupported" error so callers can tell.
 */
import { formatNumber, serialToDate } from './numFmt';

export class FErr { constructor(public code: string, public unsupported = false) {} toString() { return this.code; } }
export type Scalar = number | string | boolean | null | FErr;
export type Val = Scalar | Scalar[][];
export interface FCtx {
  /** value of one cell (evaluates formulas on demand); sheet undefined = current sheet */
  cell(sheet: string | undefined, r: number, c: number): Scalar;
  /** used range of a sheet, to bound whole-column refs like A:A */
  bounds(sheet: string | undefined): { maxR: number; maxC: number };
  name?(n: string): string | undefined;
  /** current cell, for ROW() / COLUMN() */
  here?: { r: number; c: number };
}

const NA = () => new FErr('#N/A'), VALUE = () => new FErr('#VALUE!'), DIV0 = () => new FErr('#DIV/0!'), NUM = () => new FErr('#NUM!'), REF = () => new FErr('#REF!');

// ───────── tokens ─────────
type Tok =
  | { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'bool'; v: boolean } | { t: 'err'; v: string }
  | { t: 'ref'; sheet?: string; r0: number; c0: number; r1: number; c1: number; raw: string; abs: [boolean, boolean, boolean, boolean]; whole?: 'col' | 'row' }
  | { t: 'fn'; v: string } | { t: 'name'; v: string } | { t: 'op'; v: string } | { t: '('} | { t: ')' } | { t: ',' } | { t: '{' } | { t: '}' } | { t: ';' };

const colIdx = (s: string) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const colStr = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

const SHEET = `(?:'((?:[^']|'')+)'|([A-Za-z_\\u00C0-\\uFFFF][\\w.\\u00C0-\\uFFFF]*))!`;
const CELL = '(\\$?)([A-Za-z]{1,3})(\\$?)(\\d+)';
const RE_RANGE = new RegExp(`^(?:${SHEET})?${CELL}(?::${CELL})?(?![\\w(])`);
const RE_COLS = new RegExp(`^(?:${SHEET})?(\\$?)([A-Za-z]{1,3}):(\\$?)([A-Za-z]{1,3})(?![\\w(])`);
const RE_ROWS = new RegExp(`^(?:${SHEET})?(\\$?)(\\d+):(\\$?)(\\d+)(?![\\w(])`);

export interface Span { tok: Tok; start: number; end: number; }

export function tokenize(src: string): Span[] {
  const out: Span[] = [];
  let i = src.startsWith('=') ? 1 : 0;
  const push = (tok: Tok, start: number, end: number) => out.push({ tok, start, end });
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    if (ch === '"') {
      let j = i + 1, s = '';
      while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
      push({ t: 'str', v: s }, i, j + 1); i = j + 1; continue;
    }
    if (ch === '#') { const m = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA)/i.exec(rest); if (m) { push({ t: 'err', v: m[0].toUpperCase() }, i, i + m[0].length); i += m[0].length; continue; } }
    let m: RegExpExecArray | null;
    if ((m = RE_RANGE.exec(rest))) {
      const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2];
      const c0 = colIdx(m[4]), r0 = +m[6] - 1;
      const c1 = m[8] ? colIdx(m[8]) : c0, r1 = m[10] ? +m[10] - 1 : r0;
      push({ t: 'ref', sheet, r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1), raw: m[0], abs: [!!m[3], !!m[5], !!m[7], !!m[9]] }, i, i + m[0].length);
      i += m[0].length; continue;
    }
    if ((m = RE_COLS.exec(rest)) && !/^\d/.test(m[4])) {
      const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2];
      const a = colIdx(m[4]), b = colIdx(m[6]);
      push({ t: 'ref', sheet, r0: 0, r1: 1048575, c0: Math.min(a, b), c1: Math.max(a, b), raw: m[0], abs: [!!m[3], false, !!m[5], false], whole: 'col' }, i, i + m[0].length);
      i += m[0].length; continue;
    }
    if ((m = RE_ROWS.exec(rest))) {
      const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2];
      const a = +m[4] - 1, b = +m[6] - 1;
      push({ t: 'ref', sheet, r0: Math.min(a, b), r1: Math.max(a, b), c0: 0, c1: 16383, raw: m[0], abs: [false, !!m[3], false, !!m[5]], whole: 'row' }, i, i + m[0].length);
      i += m[0].length; continue;
    }
    if ((m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(rest))) { push({ t: 'num', v: parseFloat(m[0]) }, i, i + m[0].length); i += m[0].length; continue; }
    if ((m = /^(TRUE|FALSE)(?![\w(.])/i.exec(rest))) { push({ t: 'bool', v: /^t/i.test(m[0]) }, i, i + m[0].length); i += m[0].length; continue; }
    if ((m = /^(_xlfn\.|_xlws\.)?([A-Za-z_][\w.]*)\s*\(/.exec(rest))) { push({ t: 'fn', v: m[2].toUpperCase() }, i, i + m[0].length - 1); i += m[0].length - 1; continue; }
    if ((m = /^[A-Za-z_\\][\w.]*/.exec(rest))) { push({ t: 'name', v: m[0] }, i, i + m[0].length); i += m[0].length; continue; }
    if ((m = /^(<=|>=|<>|[-+*/^&=<>%])/.exec(rest))) { push({ t: 'op', v: m[0] }, i, i + m[0].length); i += m[0].length; continue; }
    if ('(),{};'.includes(ch)) { push({ t: ch } as Tok, i, i + 1); i++; continue; }
    if (ch === '@') { i++; continue; } // implicit intersection marker
    throw new FErr('#NAME?', true);
  }
  return out;
}

/** Move relative references by (dr, dc), as Excel does when a formula is copied (shared formulas, CF rules). */
export function shiftFormula(src: string, dr: number, dc: number): string {
  if (!dr && !dc) return src;
  let spans: Span[];
  try { spans = tokenize(src); } catch { return src; }
  let out = '', last = 0;
  for (const s of spans) {
    if (s.tok.t !== 'ref') continue;
    const t = s.tok;
    const pre = t.raw.includes('!') ? t.raw.slice(0, t.raw.lastIndexOf('!') + 1) : '';
    const cell = (r: number, c: number, ar: boolean, ac: boolean) => `${ac ? '$' : ''}${colStr(ac ? c : Math.max(0, c + dc))}${ar ? '$' : ''}${(ar ? r : Math.max(0, r + dr)) + 1}`;
    let txt: string;
    if (t.whole === 'col') txt = `${pre}${t.abs[0] ? '$' : ''}${colStr(t.abs[0] ? t.c0 : t.c0 + dc)}:${t.abs[2] ? '$' : ''}${colStr(t.abs[2] ? t.c1 : t.c1 + dc)}`;
    else if (t.whole === 'row') txt = `${pre}${t.abs[1] ? '$' : ''}${(t.abs[1] ? t.r0 : t.r0 + dr) + 1}:${t.abs[3] ? '$' : ''}${(t.abs[3] ? t.r1 : t.r1 + dr) + 1}`;
    else {
      // keep the corner order as written
      const m = new RegExp(`${CELL}(?::${CELL})?$`).exec(t.raw.slice(pre.length))!;
      const a = cell(+m[4] - 1, colIdx(m[2]), !!m[3], !!m[1]);
      txt = pre + a + (m[6] ? ':' + cell(+m[8] - 1, colIdx(m[6]), !!m[7], !!m[5]) : '');
    }
    out += src.slice(last, s.start) + txt;
    last = s.end;
  }
  return out + src.slice(last);
}

// ───────── parser → AST ─────────
type Node =
  | { k: 'lit'; v: Scalar } | { k: 'ref'; tok: Extract<Tok, { t: 'ref' }> } | { k: 'name'; v: string }
  | { k: 'un'; op: string; a: Node } | { k: 'bin'; op: string; a: Node; b: Node } | { k: 'pct'; a: Node }
  | { k: 'call'; fn: string; args: (Node | null)[] } | { k: 'arr'; rows: Scalar[][] };

function parse(spans: Span[]): Node {
  let p = 0;
  const peek = () => spans[p]?.tok;
  const next = () => spans[p++]?.tok;
  const expect = (t: string) => { const k = next(); if (!k || k.t !== t) throw new FErr('#NAME?', true); };
  const PREC: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
  const primary = (): Node => {
    const k = next();
    if (!k) throw new FErr('#NAME?', true);
    switch (k.t) {
      case 'num': return { k: 'lit', v: k.v };
      case 'str': return { k: 'lit', v: k.v };
      case 'bool': return { k: 'lit', v: k.v };
      case 'err': return { k: 'lit', v: new FErr(k.v) };
      case 'ref': return { k: 'ref', tok: k };
      case 'name': return { k: 'name', v: k.v };
      case 'op':
        if (k.v === '-' || k.v === '+') { const a = unary(); return k.v === '-' ? { k: 'un', op: '-', a } : a; }
        throw new FErr('#NAME?', true);
      case '(': { const e = expr(0); expect(')'); return e; }
      case '{': {
        const rows: Scalar[][] = [[]];
        while (peek() && peek()!.t !== '}') {
          const t = next()!;
          if (t.t === ',') continue;
          if (t.t === ';') { rows.push([]); continue; }
          let neg = false, v: Scalar = null;
          let tt: Tok = t;
          if (tt.t === 'op' && tt.v === '-') { neg = true; tt = next()!; }
          if (tt.t === 'num') v = neg ? -tt.v : tt.v; else if (tt.t === 'str') v = tt.v; else if (tt.t === 'bool') v = tt.v; else if (tt.t === 'err') v = new FErr(tt.v);
          rows[rows.length - 1].push(v);
        }
        expect('}');
        return { k: 'arr', rows };
      }
      case 'fn': {
        expect('(');
        const args: (Node | null)[] = [];
        if (peek()?.t === ')') { next(); return { k: 'call', fn: k.v, args }; }
        while (true) {
          if (peek()?.t === ',' || peek()?.t === ')') args.push(null); else args.push(expr(0));
          const s = next();
          if (s?.t === ')') break;
          if (s?.t !== ',') throw new FErr('#NAME?', true);
        }
        return { k: 'call', fn: k.v, args };
      }
    }
    throw new FErr('#NAME?', true);
  };
  const postfix = (): Node => { let n = primary(); while (peek()?.t === 'op' && (peek() as any).v === '%') { next(); n = { k: 'pct', a: n }; } return n; };
  const unary = (): Node => {
    const k = peek();
    if (k?.t === 'op' && (k.v === '-' || k.v === '+')) { next(); const a = unary(); return k.v === '-' ? { k: 'un', op: '-', a } : a; }
    return postfix();
  };
  const expr = (min: number): Node => {
    let left = unary();
    while (true) {
      const k = peek();
      if (!k || k.t !== 'op' || PREC[k.v] === undefined || PREC[k.v] < min) break;
      next();
      const prec = PREC[k.v];
      const right = expr(k.v === '^' ? prec : prec + 1);
      left = { k: 'bin', op: k.v, a: left, b: right };
    }
    return left;
  };
  const n = expr(0);
  if (p < spans.length) throw new FErr('#NAME?', true);
  return n;
}

const astCache = new Map<string, Node | FErr>();
function ast(src: string): Node | FErr {
  let a = astCache.get(src);
  if (a === undefined) {
    try { a = parse(tokenize(src)); } catch (e) { a = e instanceof FErr ? e : new FErr('#NAME?', true); }
    if (astCache.size > 20000) astCache.clear();
    astCache.set(src, a);
  }
  return a;
}

// ───────── coercion ─────────
const isErr = (v: unknown): v is FErr => v instanceof FErr;
const scalar = (v: Val): Scalar => (Array.isArray(v) ? v[0]?.[0] ?? null : v);
function toNum(v: Scalar): number | FErr {
  if (isErr(v)) return v;
  if (v === null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const t = v.trim().replace(/,/g, '');
  const pct = t.endsWith('%');
  const n = Number(pct ? t.slice(0, -1) : t);
  if (t !== '' && !isNaN(n)) return pct ? n / 100 : n;
  return VALUE();
}
function toStr(v: Scalar): string | FErr {
  if (isErr(v)) return v;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return formatNumber(v, 'General').text;
  return v;
}
function toBool(v: Scalar): boolean | FErr {
  if (isErr(v)) return v;
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return VALUE();
}
const flat = (v: Val): Scalar[] => (Array.isArray(v) ? v.flat() : [v]);

function compare(a: Scalar, b: Scalar): number {
  // Excel order: numbers < text < booleans; blanks act as 0 / ""
  const rank = (x: Scalar) => (typeof x === 'number' || x === null ? 0 : typeof x === 'string' ? 1 : 2);
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'string') { const x = a.toLowerCase(), y = (b as string).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
}

/** COUNTIF-style criteria: ">=10", "<>x", "a*", 5 … */
function criteria(c: Scalar): (v: Scalar) => boolean {
  if (typeof c === 'number' || typeof c === 'boolean') return (v) => (typeof v === 'string' && typeof c === 'number' ? Number(v) === c && v.trim() !== '' : v === c);
  if (c === null) return (v) => v === null || v === '';
  if (isErr(c)) return (v) => isErr(v) && v.code === c.code;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(c)!;
  const op = m[1] ?? '=', rhs = m[2];
  const n = rhs.trim() !== '' && !isNaN(Number(rhs)) ? Number(rhs) : null;
  if (n !== null) return (v) => {
    const x = typeof v === 'number' ? v : null;
    if (x === null) return op === '<>';
    return op === '=' ? x === n : op === '<>' ? x !== n : op === '<' ? x < n : op === '>' ? x > n : op === '<=' ? x <= n : x >= n;
  };
  if ((op === '=' || op === '<>') && /[*?]/.test(rhs)) {
    const re = new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'is');
    return (v) => { const s = typeof v === 'string' ? v : v === null ? '' : String(v); return op === '=' ? re.test(s) : !re.test(s); };
  }
  if (rhs === '') return op === '=' ? (v) => v === null || v === '' : (v) => !(v === null || v === '');
  const r = rhs.toLowerCase();
  return (v) => {
    const s = typeof v === 'string' ? v.toLowerCase() : null;
    if (op === '=') return s === r;
    if (op === '<>') return s !== r;
    if (s === null) return false;
    return op === '<' ? s < r : op === '>' ? s > r : op === '<=' ? s <= r : s >= r;
  };
}

const roundTo = (x: number, d: number, mode: 'round' | 'up' | 'down') => {
  const f = Math.pow(10, d);
  const y = Math.abs(x) * f;
  const r = mode === 'round' ? Math.round(y + 1e-9) : mode === 'up' ? Math.ceil(y - 1e-9) : Math.floor(y + 1e-9);
  return (Math.sign(x) * r) / f;
};
function dateSerial(y: number, m: number, d: number): number {
  const ms = Date.UTC(y, m - 1, d);
  let s = ms / 86400000 + 25569;
  if (s < 61) s -= 1; // Excel's 1900 leap-year bug
  return s;
}
function nowSerial() { const n = new Date(); return (n.getTime() - n.getTimezoneOffset() * 60000) / 86400000 + 25569; }

// ───────── evaluation ─────────
export function evaluate(src: string, ctx: FCtx): Val {
  const a = ast(src);
  if (isErr(a)) return a;
  try { return ev(a, ctx); } catch (e) { return e instanceof FErr ? e : new FErr('#VALUE!'); }
}

function rangeVals(tok: Extract<Tok, { t: 'ref' }>, ctx: FCtx): Scalar[][] {
  let { r0, r1, c0, c1 } = tok;
  if (tok.whole) { const b = ctx.bounds(tok.sheet); r1 = Math.min(r1, b.maxR); c1 = Math.min(c1, b.maxC); }
  if ((r1 - r0 + 1) * (c1 - c0 + 1) > 2_000_000) throw new FErr('#NUM!', true);
  const out: Scalar[][] = [];
  for (let r = r0; r <= r1; r++) { const row: Scalar[] = []; for (let c = c0; c <= c1; c++) row.push(ctx.cell(tok.sheet, r, c)); out.push(row); }
  return out;
}

function ev(n: Node, ctx: FCtx): Val {
  switch (n.k) {
    case 'lit': return n.v;
    case 'arr': return n.rows;
    case 'ref': return n.tok.r0 === n.tok.r1 && n.tok.c0 === n.tok.c1 && !n.tok.whole ? ctx.cell(n.tok.sheet, n.tok.r0, n.tok.c0) : rangeVals(n.tok, ctx);
    case 'name': {
      const def = ctx.name?.(n.v);
      if (def === undefined) throw new FErr('#NAME?', true);
      return evaluate(def, ctx);
    }
    case 'un': return lift1(ev(n.a, ctx), (x) => { const v = toNum(x); return isErr(v) ? v : -v; });
    case 'pct': return lift1(ev(n.a, ctx), (x) => { const v = toNum(x); return isErr(v) ? v : v / 100; });
    case 'bin': return lift2(ev(n.a, ctx), ev(n.b, ctx), (x, y) => binop(n.op, x, y));
    case 'call': return call(n.fn, n.args, ctx);
  }
}

function lift1(v: Val, f: (x: Scalar) => Scalar): Val { return Array.isArray(v) ? v.map((r) => r.map(f)) : f(v); }
function lift2(a: Val, b: Val, f: (x: Scalar, y: Scalar) => Scalar): Val {
  if (!Array.isArray(a) && !Array.isArray(b)) return f(a, b);
  const A = Array.isArray(a) ? a : [[a]], B = Array.isArray(b) ? b : [[b]];
  const rows = Math.max(A.length, B.length), cols = Math.max(A[0]?.length ?? 1, B[0]?.length ?? 1);
  const pick = (M: Scalar[][], r: number, c: number) => M[M.length === 1 ? 0 : r]?.[M[0].length === 1 ? 0 : c] ?? NA();
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => f(pick(A, r, c), pick(B, r, c))));
}

function binop(op: string, x: Scalar, y: Scalar): Scalar {
  if (isErr(x)) return x;
  if (isErr(y)) return y;
  if (op === '&') { const a = toStr(x), b = toStr(y); return isErr(a) ? a : isErr(b) ? b : a + b; }
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    const c = compare(x, y);
    return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
  }
  const a = toNum(x), b = toNum(y);
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  switch (op) {
    case '+': return a + b; case '-': return a - b; case '*': return a * b;
    case '/': return b === 0 ? DIV0() : a / b;
    case '^': { const r = Math.pow(a, b); return isFinite(r) ? r : NUM(); }
  }
  return VALUE();
}

type Fn = (args: (Node | null)[], ctx: FCtx) => Val;
const nums = (vals: Val[], countText = false): number[] | FErr => {
  const out: number[] = [];
  for (const v of vals) {
    if (Array.isArray(v)) { for (const x of v.flat()) { if (isErr(x)) return x; if (typeof x === 'number') out.push(x); } }
    else { if (v === null) continue; const n = toNum(v); if (isErr(n)) { if (countText) continue; return n; } out.push(n); }
  }
  return out;
};
const argv = (args: (Node | null)[], ctx: FCtx) => args.map((a) => (a ? ev(a, ctx) : null));
const s1 = (args: (Node | null)[], i: number, ctx: FCtx, d: Scalar = null): Scalar => (args[i] ? scalar(ev(args[i]!, ctx)) : d);
const n1 = (args: (Node | null)[], i: number, ctx: FCtx, d?: number): number => {
  if (!args[i]) { if (d === undefined) throw VALUE(); return d; }
  const v = toNum(scalar(ev(args[i]!, ctx)));
  if (isErr(v)) throw v;
  return v;
};
const str1 = (args: (Node | null)[], i: number, ctx: FCtx, d = ''): string => { if (!args[i]) return d; const v = toStr(scalar(ev(args[i]!, ctx))); if (isErr(v)) throw v; return v; };
const asRange = (v: Val): Scalar[][] => (Array.isArray(v) ? v : [[v]]);
const agg = (f: (xs: number[]) => Scalar): Fn => (args, ctx) => { const xs = nums(argv(args, ctx)); return isErr(xs) ? xs : f(xs); };

function ifs(args: (Node | null)[], ctx: FCtx, start: number): boolean[] {
  // pairs of (range, criteria) from `start`
  let mask: boolean[] | null = null;
  for (let i = start; i + 1 < args.length; i += 2) {
    const range = asRange(ev(args[i]!, ctx)).flat();
    const test = criteria(s1(args, i + 1, ctx));
    const m = range.map(test);
    mask = mask ? mask.map((x, k) => x && !!m[k]) : m;
  }
  return mask ?? [];
}

function lookupIndex(needle: Scalar, list: Scalar[], exact: boolean): number {
  if (exact) {
    const test = typeof needle === 'string' && /[*?]/.test(needle) ? criteria(needle) : (v: Scalar) => compare(v, needle) === 0 && (typeof v === typeof needle || (v === null && needle === ''));
    return list.findIndex((v) => test(v));
  }
  let best = -1;
  for (let i = 0; i < list.length; i++) { if (list[i] === null) continue; if (compare(list[i], needle) <= 0) best = i; else break; }
  return best;
}

const FNS: Record<string, Fn> = {
  SUM: agg((x) => x.reduce((a, b) => a + b, 0)),
  AVERAGE: agg((x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : DIV0())),
  MIN: agg((x) => (x.length ? Math.min(...x) : 0)),
  MAX: agg((x) => (x.length ? Math.max(...x) : 0)),
  PRODUCT: agg((x) => x.reduce((a, b) => a * b, 1)),
  MEDIAN: agg((x) => { if (!x.length) return NUM(); const s = x.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }),
  STDEV: agg((x) => { if (x.length < 2) return DIV0(); const m = x.reduce((a, b) => a + b, 0) / x.length; return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1)); }),
  'STDEV.S': (a, c) => FNS.STDEV(a, c),
  COUNT: (args, ctx) => argv(args, ctx).reduce<number>((n, v) => n + flat(v).filter((x) => typeof x === 'number').length, 0),
  COUNTA: (args, ctx) => argv(args, ctx).reduce<number>((n, v) => n + flat(v).filter((x) => x !== null && x !== '').length, 0),
  COUNTBLANK: (args, ctx) => flat(ev(args[0]!, ctx)).filter((x) => x === null || x === '').length,
  COUNTIF: (args, ctx) => { const t = criteria(s1(args, 1, ctx)); return flat(ev(args[0]!, ctx)).filter(t).length; },
  COUNTIFS: (args, ctx) => ifs(args, ctx, 0).filter(Boolean).length,
  SUMIF: (args, ctx) => {
    const range = asRange(ev(args[0]!, ctx)).flat(), t = criteria(s1(args, 1, ctx));
    const sumR = args[2] ? asRange(ev(args[2]!, ctx)).flat() : range;
    return range.reduce<number>((s, v, i) => s + (t(v) && typeof sumR[i] === 'number' ? (sumR[i] as number) : 0), 0);
  },
  SUMIFS: (args, ctx) => { const sumR = asRange(ev(args[0]!, ctx)).flat(); const m = ifs(args, ctx, 1); return sumR.reduce<number>((s, v, i) => s + (m[i] && typeof v === 'number' ? v : 0), 0); },
  AVERAGEIF: (args, ctx) => {
    const range = asRange(ev(args[0]!, ctx)).flat(), t = criteria(s1(args, 1, ctx));
    const r = args[2] ? asRange(ev(args[2]!, ctx)).flat() : range;
    const xs = range.map((v, i) => (t(v) && typeof r[i] === 'number' ? (r[i] as number) : null)).filter((x): x is number => x !== null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : DIV0();
  },
  AVERAGEIFS: (args, ctx) => { const r = asRange(ev(args[0]!, ctx)).flat(); const m = ifs(args, ctx, 1); const xs = r.filter((v, i) => m[i] && typeof v === 'number') as number[]; return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : DIV0(); },
  MAXIFS: (args, ctx) => { const r = asRange(ev(args[0]!, ctx)).flat(); const m = ifs(args, ctx, 1); const xs = r.filter((v, i) => m[i] && typeof v === 'number') as number[]; return xs.length ? Math.max(...xs) : 0; },
  MINIFS: (args, ctx) => { const r = asRange(ev(args[0]!, ctx)).flat(); const m = ifs(args, ctx, 1); const xs = r.filter((v, i) => m[i] && typeof v === 'number') as number[]; return xs.length ? Math.min(...xs) : 0; },
  SUMPRODUCT: (args, ctx) => {
    const arrs = argv(args, ctx).map((v) => asRange(v).flat());
    const len = arrs[0]?.length ?? 0;
    if (arrs.some((a) => a.length !== len)) return VALUE();
    let s = 0;
    for (let i = 0; i < len; i++) { let p = 1; for (const a of arrs) { const x = a[i]; if (isErr(x)) return x; p *= typeof x === 'number' ? x : typeof x === 'boolean' ? +x : 0; } s += p; }
    return s;
  },
  IF: (args, ctx) => { const c = toBool(s1(args, 0, ctx)); if (isErr(c)) return c; return c ? (args[1] ? ev(args[1]!, ctx) : true) : args[2] ? ev(args[2]!, ctx) : args.length > 2 ? 0 : false; },
  IFS: (args, ctx) => { for (let i = 0; i + 1 < args.length; i += 2) { const c = toBool(s1(args, i, ctx)); if (isErr(c)) return c; if (c) return ev(args[i + 1]!, ctx); } return NA(); },
  IFERROR: (args, ctx) => { const v = args[0] ? ev(args[0]!, ctx) : null; const s = scalar(v); return isErr(s) && !s.unsupported ? (args[1] ? ev(args[1]!, ctx) : '') : v; },
  IFNA: (args, ctx) => { const v = args[0] ? ev(args[0]!, ctx) : null; const s = scalar(v); return isErr(s) && s.code === '#N/A' ? (args[1] ? ev(args[1]!, ctx) : '') : v; },
  AND: (args, ctx) => { for (const v of argv(args, ctx)) for (const x of flat(v)) { if (x === null || typeof x === 'string') continue; const b = toBool(x); if (isErr(b)) return b; if (!b) return false; } return true; },
  OR: (args, ctx) => { let any = false; for (const v of argv(args, ctx)) for (const x of flat(v)) { if (x === null || typeof x === 'string') continue; const b = toBool(x); if (isErr(b)) return b; if (b) any = true; } return any; },
  XOR: (args, ctx) => { let n = 0; for (const v of argv(args, ctx)) for (const x of flat(v)) { const b = toBool(x); if (b === true) n++; } return n % 2 === 1; },
  NOT: (args, ctx) => { const b = toBool(s1(args, 0, ctx)); return isErr(b) ? b : !b; },
  TRUE: () => true, FALSE: () => false,
  ROUND: (a, c) => roundTo(n1(a, 0, c), n1(a, 1, c, 0), 'round'),
  ROUNDUP: (a, c) => roundTo(n1(a, 0, c), n1(a, 1, c, 0), 'up'),
  ROUNDDOWN: (a, c) => roundTo(n1(a, 0, c), n1(a, 1, c, 0), 'down'),
  TRUNC: (a, c) => roundTo(n1(a, 0, c), n1(a, 1, c, 0), 'down'),
  INT: (a, c) => Math.floor(n1(a, 0, c)),
  ABS: (a, c) => Math.abs(n1(a, 0, c)),
  SIGN: (a, c) => Math.sign(n1(a, 0, c)),
  SQRT: (a, c) => { const x = n1(a, 0, c); return x < 0 ? NUM() : Math.sqrt(x); },
  POWER: (a, c) => Math.pow(n1(a, 0, c), n1(a, 1, c)),
  EXP: (a, c) => Math.exp(n1(a, 0, c)),
  LN: (a, c) => { const x = n1(a, 0, c); return x <= 0 ? NUM() : Math.log(x); },
  LOG10: (a, c) => { const x = n1(a, 0, c); return x <= 0 ? NUM() : Math.log10(x); },
  LOG: (a, c) => { const x = n1(a, 0, c), b = n1(a, 1, c, 10); return x <= 0 ? NUM() : Math.log(x) / Math.log(b); },
  MOD: (a, c) => { const x = n1(a, 0, c), d = n1(a, 1, c); return d === 0 ? DIV0() : x - d * Math.floor(x / d); },
  PI: () => Math.PI,
  CEILING: (a, c) => { const x = n1(a, 0, c), s = n1(a, 1, c, 1); return s === 0 ? 0 : Math.ceil(x / s - 1e-12) * s; },
  'CEILING.MATH': (a, c) => FNS.CEILING(a, c),
  FLOOR: (a, c) => { const x = n1(a, 0, c), s = n1(a, 1, c, 1); return s === 0 ? DIV0() : Math.floor(x / s + 1e-12) * s; },
  'FLOOR.MATH': (a, c) => FNS.FLOOR(a, c),
  MROUND: (a, c) => { const x = n1(a, 0, c), s = n1(a, 1, c); return s === 0 ? 0 : Math.round(x / s) * s; },
  RAND: () => Math.random(),
  RANDBETWEEN: (a, c) => { const lo = Math.ceil(n1(a, 0, c)), hi = Math.floor(n1(a, 1, c)); return lo + Math.floor(Math.random() * (hi - lo + 1)); },
  LARGE: (a, c) => { const xs = nums([ev(a[0]!, c)]); if (isErr(xs)) return xs; const k = n1(a, 1, c); const s = xs.sort((x, y) => y - x); return k >= 1 && k <= s.length ? s[Math.floor(k) - 1] : NUM(); },
  SMALL: (a, c) => { const xs = nums([ev(a[0]!, c)]); if (isErr(xs)) return xs; const k = n1(a, 1, c); const s = xs.sort((x, y) => x - y); return k >= 1 && k <= s.length ? s[Math.floor(k) - 1] : NUM(); },
  RANK: (a, c) => { const x = n1(a, 0, c); const xs = nums([ev(a[1]!, c)]); if (isErr(xs)) return xs; const asc = n1(a, 2, c, 0) !== 0; if (!xs.includes(x)) return NA(); return 1 + xs.filter((y) => (asc ? y < x : y > x)).length; },
  'RANK.EQ': (a, c) => FNS.RANK(a, c),
  CONCATENATE: (args, ctx) => { let s = ''; for (const v of argv(args, ctx)) { const t = toStr(scalar(v)); if (isErr(t)) return t; s += t; } return s; },
  CONCAT: (args, ctx) => { let s = ''; for (const v of argv(args, ctx)) for (const x of flat(v)) { const t = toStr(x); if (isErr(t)) return t; s += t; } return s; },
  TEXTJOIN: (args, ctx) => {
    const sep = str1(args, 0, ctx); const skip = toBool(s1(args, 1, ctx, true)); const parts: string[] = [];
    for (const v of argv(args.slice(2), ctx)) for (const x of flat(v)) { const t = toStr(x); if (isErr(t)) return t; if (skip === true && t === '') continue; parts.push(t); }
    return parts.join(sep);
  },
  LEN: (a, c) => [...str1(a, 0, c)].length,
  LEFT: (a, c) => [...str1(a, 0, c)].slice(0, n1(a, 1, c, 1)).join(''),
  RIGHT: (a, c) => { const s = [...str1(a, 0, c)]; const n = n1(a, 1, c, 1); return n <= 0 ? '' : s.slice(-n).join(''); },
  MID: (a, c) => [...str1(a, 0, c)].slice(n1(a, 1, c) - 1, n1(a, 1, c) - 1 + n1(a, 2, c)).join(''),
  UPPER: (a, c) => str1(a, 0, c).toUpperCase(),
  LOWER: (a, c) => str1(a, 0, c).toLowerCase(),
  PROPER: (a, c) => str1(a, 0, c).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, p, ch) => p + ch.toUpperCase()),
  TRIM: (a, c) => str1(a, 0, c).replace(/ +/g, ' ').trim(),
  REPT: (a, c) => str1(a, 0, c).repeat(Math.max(0, Math.min(32767, n1(a, 1, c)))),
  SUBSTITUTE: (a, c) => {
    const s = str1(a, 0, c), from = str1(a, 1, c), to = str1(a, 2, c);
    if (!from) return s;
    if (!a[3]) return s.split(from).join(to);
    const k = n1(a, 3, c); let i = -1;
    for (let n = 0; n < k; n++) { i = s.indexOf(from, i + 1); if (i < 0) return s; }
    return s.slice(0, i) + to + s.slice(i + from.length);
  },
  REPLACE: (a, c) => { const s = str1(a, 0, c); const st = n1(a, 1, c) - 1, n = n1(a, 2, c); return s.slice(0, st) + str1(a, 3, c) + s.slice(st + n); },
  FIND: (a, c) => { const i = str1(a, 1, c).indexOf(str1(a, 0, c), n1(a, 2, c, 1) - 1); return i < 0 ? VALUE() : i + 1; },
  SEARCH: (a, c) => { const i = str1(a, 1, c).toLowerCase().indexOf(str1(a, 0, c).toLowerCase(), n1(a, 2, c, 1) - 1); return i < 0 ? VALUE() : i + 1; },
  EXACT: (a, c) => str1(a, 0, c) === str1(a, 1, c),
  CHAR: (a, c) => String.fromCharCode(n1(a, 0, c)),
  CODE: (a, c) => { const s = str1(a, 0, c); return s ? s.charCodeAt(0) : VALUE(); },
  VALUE: (a, c) => toNum(s1(a, 0, c)),
  T: (a, c) => { const v = s1(a, 0, c); return typeof v === 'string' ? v : ''; },
  N: (a, c) => { const v = s1(a, 0, c); return typeof v === 'number' ? v : typeof v === 'boolean' ? +v : 0; },
  TEXT: (a, c) => { const v = s1(a, 0, c); const n = toNum(v); const fmt = str1(a, 1, c); if (isErr(n)) return typeof v === 'string' ? v : n; return formatNumber(n, fmt).text; },
  FIXED: (a, c) => { const d = n1(a, 1, c, 2); const no = toBool(s1(a, 2, c, false)); return formatNumber(roundTo(n1(a, 0, c), d, 'round'), (no === true ? '0' : '#,##0') + (d > 0 ? '.' + '0'.repeat(d) : '')).text; },
  DOLLAR: (a, c) => { const d = n1(a, 1, c, 2); return formatNumber(n1(a, 0, c), `"$"#,##0${d > 0 ? '.' + '0'.repeat(d) : ''};("$"#,##0${d > 0 ? '.' + '0'.repeat(d) : ''})`).text; },
  ISBLANK: (a, c) => s1(a, 0, c) === null,
  ISNUMBER: (a, c) => typeof s1(a, 0, c) === 'number',
  ISTEXT: (a, c) => typeof s1(a, 0, c) === 'string',
  ISNONTEXT: (a, c) => typeof s1(a, 0, c) !== 'string',
  ISLOGICAL: (a, c) => typeof s1(a, 0, c) === 'boolean',
  ISERROR: (a, c) => isErr(s1(a, 0, c)),
  ISERR: (a, c) => { const v = s1(a, 0, c); return isErr(v) && v.code !== '#N/A'; },
  ISNA: (a, c) => { const v = s1(a, 0, c); return isErr(v) && v.code === '#N/A'; },
  ISEVEN: (a, c) => Math.floor(Math.abs(n1(a, 0, c))) % 2 === 0,
  ISODD: (a, c) => Math.floor(Math.abs(n1(a, 0, c))) % 2 === 1,
  NA: () => NA(),
  TODAY: () => Math.floor(nowSerial()),
  NOW: () => nowSerial(),
  DATE: (a, c) => dateSerial(n1(a, 0, c) < 1900 ? n1(a, 0, c) + 1900 : n1(a, 0, c), n1(a, 1, c), n1(a, 2, c)),
  TIME: (a, c) => (n1(a, 0, c) * 3600 + n1(a, 1, c) * 60 + n1(a, 2, c)) / 86400 % 1,
  YEAR: (a, c) => serialToDate(n1(a, 0, c)).y,
  MONTH: (a, c) => serialToDate(n1(a, 0, c)).m,
  DAY: (a, c) => serialToDate(n1(a, 0, c)).d,
  HOUR: (a, c) => serialToDate(n1(a, 0, c)).H,
  MINUTE: (a, c) => serialToDate(n1(a, 0, c)).M,
  SECOND: (a, c) => serialToDate(n1(a, 0, c)).S,
  WEEKDAY: (a, c) => { const wd = serialToDate(n1(a, 0, c)).wd; const t = n1(a, 1, c, 1); return t === 2 ? ((wd + 6) % 7) + 1 : t === 3 ? (wd + 6) % 7 : wd + 1; },
  EDATE: (a, c) => { const p = serialToDate(n1(a, 0, c)); const m = p.m + n1(a, 1, c); const y = p.y + Math.floor((m - 1) / 12), mm = ((m - 1) % 12 + 12) % 12 + 1; const last = new Date(Date.UTC(y, mm, 0)).getUTCDate(); return dateSerial(y, mm, Math.min(p.d, last)); },
  EOMONTH: (a, c) => { const p = serialToDate(n1(a, 0, c)); const m = p.m + n1(a, 1, c); const y = p.y + Math.floor((m - 1) / 12), mm = ((m - 1) % 12 + 12) % 12 + 1; return dateSerial(y, mm + 1, 0); },
  DAYS: (a, c) => n1(a, 0, c) - n1(a, 1, c),
  DATEDIF: (a, c) => {
    const s = n1(a, 0, c), e = n1(a, 1, c), u = str1(a, 2, c).toUpperCase();
    if (e < s) return NUM();
    const p = serialToDate(s), q = serialToDate(e);
    let months = (q.y - p.y) * 12 + (q.m - p.m); if (q.d < p.d) months--;
    if (u === 'D') return Math.floor(e) - Math.floor(s);
    if (u === 'M') return months;
    if (u === 'Y') return Math.floor(months / 12);
    if (u === 'YM') return months % 12;
    return new FErr('#NUM!');
  },
  ROW: (a, c) => (a[0] && a[0].k === 'ref' ? a[0].tok.r0 + 1 : (c.here?.r ?? 0) + 1),
  COLUMN: (a, c) => (a[0] && a[0].k === 'ref' ? a[0].tok.c0 + 1 : (c.here?.c ?? 0) + 1),
  ROWS: (a, c) => asRange(ev(a[0]!, c)).length,
  COLUMNS: (a, c) => asRange(ev(a[0]!, c))[0]?.length ?? 0,
  CHOOSE: (a, c) => { const i = Math.floor(n1(a, 0, c)); return i >= 1 && i < a.length && a[i] ? ev(a[i]!, c) : VALUE(); },
  INDEX: (a, c) => {
    const m = asRange(ev(a[0]!, c));
    let r = n1(a, 1, c, 1), col = n1(a, 2, c, 1);
    if (m.length === 1 && !a[2]) { col = r; r = 1; }
    const v = m[r - 1]?.[col - 1];
    return v === undefined ? REF() : v;
  },
  MATCH: (a, c) => {
    const needle = s1(a, 0, c); const list = asRange(ev(a[1]!, c)).flat(); const t = n1(a, 2, c, 1);
    let i: number;
    if (t === 0) i = lookupIndex(needle, list, true);
    else if (t === 1) i = lookupIndex(needle, list, false);
    else { i = -1; for (let k = 0; k < list.length; k++) { if (compare(list[k], needle) >= 0) i = k; else break; } }
    return i < 0 ? NA() : i + 1;
  },
  VLOOKUP: (a, c) => {
    const needle = s1(a, 0, c); const m = asRange(ev(a[1]!, c)); const col = n1(a, 2, c); const approx = a[3] ? toBool(s1(a, 3, c)) : true;
    if (isErr(approx)) return approx;
    const i = lookupIndex(needle, m.map((r) => r[0]), !approx);
    if (i < 0) return NA();
    const v = m[i][col - 1];
    return v === undefined ? REF() : v;
  },
  HLOOKUP: (a, c) => {
    const needle = s1(a, 0, c); const m = asRange(ev(a[1]!, c)); const row = n1(a, 2, c); const approx = a[3] ? toBool(s1(a, 3, c)) : true;
    if (isErr(approx)) return approx;
    const i = lookupIndex(needle, m[0] ?? [], !approx);
    if (i < 0) return NA();
    const v = m[row - 1]?.[i];
    return v === undefined ? REF() : v;
  },
  XLOOKUP: (a, c) => {
    const needle = s1(a, 0, c); const look = asRange(ev(a[1]!, c)).flat(); const ret = asRange(ev(a[2]!, c));
    const i = lookupIndex(needle, look, true);
    if (i < 0) return a[3] ? ev(a[3]!, c) : NA();
    return ret.length === 1 ? ret[0][i] ?? NA() : ret[i]?.[0] ?? NA();
  },
  LOOKUP: (a, c) => {
    const needle = s1(a, 0, c); const look = asRange(ev(a[1]!, c)).flat(); const ret = a[2] ? asRange(ev(a[2]!, c)).flat() : look;
    const i = lookupIndex(needle, look, false);
    return i < 0 ? NA() : ret[i] ?? NA();
  },
  PMT: (a, c) => { const r = n1(a, 0, c), n = n1(a, 1, c), pv = n1(a, 2, c), fv = n1(a, 3, c, 0), t = n1(a, 4, c, 0); if (r === 0) return -(pv + fv) / n; const f = Math.pow(1 + r, n); return (-(pv * f + fv) * r) / ((1 + r * t) * (f - 1)); },
  FV: (a, c) => { const r = n1(a, 0, c), n = n1(a, 1, c), pmt = n1(a, 2, c), pv = n1(a, 3, c, 0), t = n1(a, 4, c, 0); if (r === 0) return -(pv + pmt * n); const f = Math.pow(1 + r, n); return -(pv * f + (pmt * (1 + r * t) * (f - 1)) / r); },
  PV: (a, c) => { const r = n1(a, 0, c), n = n1(a, 1, c), pmt = n1(a, 2, c), fv = n1(a, 3, c, 0), t = n1(a, 4, c, 0); if (r === 0) return -(fv + pmt * n); const f = Math.pow(1 + r, n); return -(fv + (pmt * (1 + r * t) * (f - 1)) / r) / f; },
  NPV: (a, c) => { const r = n1(a, 0, c); const xs = nums(argv(a.slice(1), c)); if (isErr(xs)) return xs; return xs.reduce((s, x, i) => s + x / Math.pow(1 + r, i + 1), 0); },
  HYPERLINK: (a, c) => (a[1] ? ev(a[1]!, c) : s1(a, 0, c)),
  SUBTOTAL: (a, c) => {
    const code = n1(a, 0, c) % 100; const rest = a.slice(1);
    const map: Record<number, string> = { 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV', 9: 'SUM' };
    return map[code] ? FNS[map[code]](rest, c) : new FErr('#VALUE!', true);
  },
  AGGREGATE: (a, c) => FNS.SUBTOTAL([a[0], ...a.slice(2)], c),
};

function call(fn: string, args: (Node | null)[], ctx: FCtx): Val {
  const f = FNS[fn];
  if (!f) return new FErr('#NAME?', true);
  try { return f(args, ctx); } catch (e) { if (e instanceof FErr) return e; return VALUE(); }
}

export const supportedFunctions = () => Object.keys(FNS);
