/** Conditional formatting: evaluate a sheet's rules into per-cell effects (fills, font colours, data bars, icons). */
import { kid, kids, find, type XNode } from './xml';
import { sheetColor, mix, type Theme } from './xlsxColor';
import { evaluate, shiftFormula, FErr, type FCtx, type Scalar } from './formula';

export interface Dxf { fill?: string; color?: string; b?: boolean; i?: boolean; u?: boolean; strike?: boolean; }
export interface CfEffect extends Dxf {
  bar?: { frac: number; color: string; neg: boolean; zero?: number; showValue: boolean };
  icon?: { set: string; idx: number; count: number; showValue: boolean };
}
interface Cfvo { type: string; val?: string; }
interface Rule {
  type: string; priority: number; dxf?: Dxf; operator?: string; formulas: string[]; text?: string; stop: boolean;
  rank?: number; percent?: boolean; bottom?: boolean; above?: boolean; equal?: boolean; stdDev?: number; timePeriod?: string;
  scale?: { cfvo: Cfvo[]; colors: string[] }; bar?: { cfvo: Cfvo[]; color: string; showValue: boolean; minLen: number; maxLen: number };
  icons?: { set: string; cfvo: (Cfvo & { gte: boolean })[]; reverse: boolean; showValue: boolean };
}
export interface CfBlock { ranges: { r0: number; c0: number; r1: number; c1: number }[]; rules: Rule[]; }

export function parseDxfs(styles: XNode | null, theme: Theme): Dxf[] {
  return kids(kid(styles ?? undefined, 'dxfs'), 'dxf').map((d) => {
    const f = kid(d, 'font'), p = kid(kid(d, 'fill'), 'patternFill');
    const on = (n: string) => { const e = kid(f, n); return e ? e.a.val !== '0' && e.a.val !== 'false' : undefined; };
    let fill: string | undefined;
    if (p && p.a.patternType !== 'none') fill = sheetColor(kid(p, 'bgColor'), theme) ?? sheetColor(kid(p, 'fgColor'), theme);
    const u = kid(f, 'u');
    return { fill, color: sheetColor(kid(f, 'color'), theme), b: on('b'), i: on('i'), u: u ? u.a.val !== 'none' : undefined, strike: on('strike') };
  });
}

const ref = (s: string) => {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(s);
  if (!m) return null;
  let c = 0; for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  return { r: +m[2] - 1, c: c - 1 };
};
export function parseRanges(sqref: string) {
  return sqref.trim().split(/\s+/).map((part) => {
    const [a, b] = part.split(':');
    const p = ref(a), q = ref(b ?? a);
    return p && q ? { r0: Math.min(p.r, q.r), c0: Math.min(p.c, q.c), r1: Math.max(p.r, q.r), c1: Math.max(p.c, q.c) } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
}

export function parseCf(sheet: XNode, dxfs: Dxf[], theme: Theme): CfBlock[] {
  const out: CfBlock[] = [];
  for (const cf of kids(sheet, 'conditionalFormatting')) {
    const ranges = parseRanges(cf.a.sqref ?? find(cf, 'sqref')[0]?.t ?? '');
    const rules: Rule[] = [];
    for (const r of kids(cf, 'cfRule')) {
      const cfvo = (el: XNode | undefined) => kids(el, 'cfvo').map((v) => ({ type: v.a.type, val: v.a.val ?? kid(v, 'f')?.t, gte: v.a.gte !== '0' }));
      const rule: Rule = {
        type: r.a.type, priority: +(r.a.priority ?? 1000), dxf: r.a.dxfId !== undefined ? dxfs[+r.a.dxfId] : undefined, operator: r.a.operator,
        formulas: kids(r, 'formula').map((f) => f.t), text: r.a.text, stop: r.a.stopIfTrue === '1',
        rank: r.a.rank !== undefined ? +r.a.rank : undefined, percent: r.a.percent === '1', bottom: r.a.bottom === '1',
        above: r.a.aboveAverage !== '0', equal: r.a.equalAverage === '1', stdDev: r.a.stdDev !== undefined ? +r.a.stdDev : undefined, timePeriod: r.a.timePeriod,
      };
      const cs = kid(r, 'colorScale');
      if (cs) rule.scale = { cfvo: cfvo(cs), colors: kids(cs, 'color').map((c) => sheetColor(c, theme, 'FFFFFF')!) };
      const db = kid(r, 'dataBar');
      if (db) rule.bar = { cfvo: cfvo(db), color: sheetColor(kid(db, 'color'), theme, '638EC6')!, showValue: db.a.showValue !== '0', minLen: +(db.a.minLength ?? 10) / 100, maxLen: +(db.a.maxLength ?? 90) / 100 };
      const is = kid(r, 'iconSet');
      if (is) rule.icons = { set: is.a.iconSet ?? '3TrafficLights1', cfvo: cfvo(is), reverse: is.a.reverse === '1', showValue: is.a.showValue !== '0' };
      rules.push(rule);
    }
    if (ranges.length && rules.length) out.push({ ranges, rules });
  }
  return out;
}

const isNum = (v: Scalar): v is number => typeof v === 'number';
const truthy = (v: unknown): boolean => (Array.isArray(v) ? truthy(v[0]?.[0]) : typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : typeof v === 'string' ? /^true$/i.test(v) : false);

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const k = (sorted.length - 1) * p, lo = Math.floor(k), hi = Math.ceil(k);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}

/**
 * Apply the rules. `get` returns a cell's value; `set` merges an effect into a cell (creating it if needed).
 * `bounds` limits whole-column ranges to the used area.
 */
export function applyCf(blocks: CfBlock[], ctx: FCtx, bounds: { maxR: number; maxC: number }, get: (r: number, c: number) => Scalar, set: (r: number, c: number, e: CfEffect) => void, today = new Date()) {
  const all = blocks.flatMap((b) => b.rules.map((rule) => ({ b, rule }))).sort((x, y) => x.rule.priority - y.rule.priority);
  const done = new Map<number, Set<string>>();
  const stopped = new Set<number>();
  const key = (r: number, c: number) => r * 16384 + c;
  const claim = (r: number, c: number, e: CfEffect) => {
    const k = key(r, c);
    let d = done.get(k);
    if (!d) { d = new Set(); done.set(k, d); }
    const out: CfEffect = {};
    for (const [p, v] of Object.entries(e)) if (v !== undefined && !d.has(p)) { (out as any)[p] = v; d.add(p); }
    if (Object.keys(out).length) set(r, c, out);
  };
  for (const { b, rule } of all) {
    const cells: { r: number; c: number; v: Scalar }[] = [];
    for (const g of b.ranges) for (let r = g.r0; r <= Math.min(g.r1, bounds.maxR); r++) for (let c = g.c0; c <= Math.min(g.c1, bounds.maxC); c++) cells.push({ r, c, v: get(r, c) });
    if (!cells.length) continue;
    const top = b.ranges[0];
    const numsSorted = cells.map((x) => x.v).filter(isNum).sort((a, z) => a - z);
    const evalAt = (f: string, r: number, c: number) => evaluate(shiftFormula(f, r - top.r0, c - top.c0), { ...ctx, here: { r, c } });
    const cfvoValue = (v: Cfvo, def: number) => {
      const n = numsSorted;
      if (!n.length) return def;
      const lo = n[0], hi = n[n.length - 1];
      switch (v.type) {
        case 'min': case 'autoMin': return lo;
        case 'max': case 'autoMax': return hi;
        case 'num': { const x = Number(v.val); if (!isNaN(x)) return x; const e = evaluate(v.val ?? '0', ctx); return typeof e === 'number' ? e : def; }
        case 'percent': return lo + ((hi - lo) * Number(v.val ?? 0)) / 100;
        case 'percentile': return percentile(n, Number(v.val ?? 0) / 100);
        case 'formula': { const e = evaluate(v.val ?? '0', ctx); return typeof e === 'number' ? e : def; }
      }
      return def;
    };
    let match: ((x: { r: number; c: number; v: Scalar }) => boolean) | null = null;
    switch (rule.type) {
      case 'cellIs': {
        const op = rule.operator ?? 'equal';
        match = ({ r, c, v }) => {
          if (v === null) v = 0;
          const a = evalAt(rule.formulas[0] ?? '0', r, c), bb = rule.formulas[1] !== undefined ? evalAt(rule.formulas[1], r, c) : null;
          const A = Array.isArray(a) ? a[0][0] : a, B = Array.isArray(bb) ? bb[0][0] : bb;
          const cmp = (x: Scalar, y: Scalar) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').toLowerCase().localeCompare(String(y ?? '').toLowerCase()));
          if (A instanceof FErr) return false;
          switch (op) {
            case 'equal': return cmp(v, A) === 0; case 'notEqual': return cmp(v, A) !== 0;
            case 'greaterThan': return cmp(v, A) > 0; case 'lessThan': return cmp(v, A) < 0;
            case 'greaterThanOrEqual': return cmp(v, A) >= 0; case 'lessThanOrEqual': return cmp(v, A) <= 0;
            case 'between': { const lo = cmp(A, B) <= 0 ? A : B, hi = lo === A ? B : A; return cmp(v, lo) >= 0 && cmp(v, hi) <= 0; }
            case 'notBetween': { const lo = cmp(A, B) <= 0 ? A : B, hi = lo === A ? B : A; return cmp(v, lo) < 0 || cmp(v, hi) > 0; }
          }
          return false;
        };
        break;
      }
      case 'expression': match = ({ r, c }) => truthy(evalAt(rule.formulas[0] ?? 'FALSE', r, c)); break;
      case 'containsText': match = ({ v }) => v !== null && String(v).toLowerCase().includes((rule.text ?? '').toLowerCase()); break;
      case 'notContainsText': match = ({ v }) => !String(v ?? '').toLowerCase().includes((rule.text ?? '').toLowerCase()); break;
      case 'beginsWith': match = ({ v }) => String(v ?? '').toLowerCase().startsWith((rule.text ?? '').toLowerCase()); break;
      case 'endsWith': match = ({ v }) => String(v ?? '').toLowerCase().endsWith((rule.text ?? '').toLowerCase()); break;
      case 'containsBlanks': match = ({ v }) => v === null || String(v).trim() === ''; break;
      case 'notContainsBlanks': match = ({ v }) => !(v === null || String(v).trim() === ''); break;
      case 'containsErrors': match = ({ v }) => v instanceof FErr; break;
      case 'notContainsErrors': match = ({ v }) => !(v instanceof FErr); break;
      case 'top10': {
        const n = numsSorted.length;
        let k = rule.rank ?? 10;
        if (rule.percent) k = Math.max(1, Math.floor((n * k) / 100));
        const th = rule.bottom ? numsSorted[Math.min(n, k) - 1] : numsSorted[Math.max(0, n - k)];
        match = ({ v }) => isNum(v) && (rule.bottom ? v <= th : v >= th);
        break;
      }
      case 'aboveAverage': {
        const avg = numsSorted.reduce((a, z) => a + z, 0) / Math.max(1, numsSorted.length);
        const sd = Math.sqrt(numsSorted.reduce((a, z) => a + (z - avg) ** 2, 0) / Math.max(1, numsSorted.length - 1));
        const lim = rule.stdDev ? avg + (rule.above ? 1 : -1) * rule.stdDev * sd : avg;
        match = ({ v }) => isNum(v) && (rule.above ? (rule.equal ? v >= lim : v > lim) : (rule.equal ? v <= lim : v < lim));
        break;
      }
      case 'duplicateValues': case 'uniqueValues': {
        const count = new Map<string, number>();
        for (const x of cells) if (x.v !== null && x.v !== '') { const k = String(x.v).toLowerCase(); count.set(k, (count.get(k) ?? 0) + 1); }
        match = ({ v }) => v !== null && v !== '' && ((count.get(String(v).toLowerCase()) ?? 0) > 1) === (rule.type === 'duplicateValues');
        break;
      }
      case 'timePeriod': {
        const serial = (d: Date) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) + 25569);
        const t = serial(today);
        const wd = today.getDay();
        const per = rule.timePeriod;
        const m = today.getMonth(), y = today.getFullYear();
        const monthStart = (yy: number, mm: number) => serial(new Date(yy, mm, 1));
        match = ({ v }) => {
          if (!isNum(v)) return false;
          const d = Math.floor(v);
          switch (per) {
            case 'today': return d === t; case 'yesterday': return d === t - 1; case 'tomorrow': return d === t + 1;
            case 'last7Days': return d > t - 7 && d <= t;
            case 'thisWeek': return d >= t - wd && d < t - wd + 7; case 'lastWeek': return d >= t - wd - 7 && d < t - wd; case 'nextWeek': return d >= t - wd + 7 && d < t - wd + 14;
            case 'thisMonth': return d >= monthStart(y, m) && d < monthStart(y, m + 1); case 'lastMonth': return d >= monthStart(y, m - 1) && d < monthStart(y, m); case 'nextMonth': return d >= monthStart(y, m + 1) && d < monthStart(y, m + 2);
          }
          return false;
        };
        break;
      }
      case 'colorScale': {
        const sc = rule.scale!;
        const pts = sc.cfvo.map((v, i) => cfvoValue(v, i === 0 ? numsSorted[0] ?? 0 : numsSorted[numsSorted.length - 1] ?? 1));
        for (const x of cells) {
          if (!isNum(x.v) || stopped.has(key(x.r, x.c))) continue;
          let color = sc.colors[0];
          if (x.v <= pts[0]) color = sc.colors[0];
          else if (x.v >= pts[pts.length - 1]) color = sc.colors[sc.colors.length - 1];
          else for (let i = 0; i + 1 < pts.length; i++) if (x.v <= pts[i + 1]) { color = mix(sc.colors[i], sc.colors[i + 1], pts[i + 1] === pts[i] ? 0 : (x.v - pts[i]) / (pts[i + 1] - pts[i])); break; }
          claim(x.r, x.c, { fill: color });
        }
        continue;
      }
      case 'dataBar': {
        const db = rule.bar!;
        const lo = cfvoValue(db.cfvo[0] ?? { type: 'min' }, numsSorted[0] ?? 0), hi = cfvoValue(db.cfvo[1] ?? { type: 'max' }, numsSorted[numsSorted.length - 1] ?? 1);
        for (const x of cells) {
          if (!isNum(x.v) || stopped.has(key(x.r, x.c))) continue;
          const t = hi === lo ? 1 : Math.max(0, Math.min(1, (x.v - lo) / (hi - lo)));
          claim(x.r, x.c, { bar: { frac: db.minLen + t * (db.maxLen - db.minLen), color: db.color, neg: x.v < 0, showValue: db.showValue } });
        }
        continue;
      }
      case 'iconSet': {
        const ic = rule.icons!;
        const count = +(ic.set.match(/^\d/)?.[0] ?? 3);
        const th = ic.cfvo.map((v) => ({ v: cfvoValue(v, 0), gte: v.gte }));
        for (const x of cells) {
          if (!isNum(x.v) || stopped.has(key(x.r, x.c))) continue;
          let idx = 0;
          for (let i = 1; i < th.length; i++) if (th[i].gte ? x.v >= th[i].v : x.v > th[i].v) idx = i;
          if (ic.reverse) idx = count - 1 - idx;
          claim(x.r, x.c, { icon: { set: ic.set, idx, count, showValue: ic.showValue } });
        }
        continue;
      }
      default: continue;
    }
    if (!match || !rule.dxf) { if (!match) continue; }
    for (const x of cells) {
      const k = key(x.r, x.c);
      if (stopped.has(k)) continue;
      let ok = false;
      try { ok = match(x); } catch { ok = false; }
      if (!ok) continue;
      if (rule.dxf) claim(x.r, x.c, rule.dxf);
      if (rule.stop) stopped.add(k);
    }
  }
}

// icon drawing data: colour + glyph kind for each set and index (0 = lowest)
const G = '63BE7B', Y = 'FFC000', R = 'F8696B', GR = '808080', K = '000000';
export function iconFor(set: string, idx: number, count: number): { kind: string; color: string } {
  const pick = <T,>(arr: T[]) => arr[Math.max(0, Math.min(arr.length - 1, idx))];
  if (/Arrows/.test(set)) {
    const gray = /Gray/.test(set);
    const kinds = count === 3 ? ['down', 'side', 'up'] : count === 4 ? ['down', 'downright', 'upright', 'up'] : ['down', 'downright', 'side', 'upright', 'up'];
    const colors = gray ? kinds.map(() => GR) : count === 3 ? [R, Y, G] : count === 4 ? [R, Y, Y, G] : [R, Y, Y, Y, G];
    return { kind: pick(kinds), color: pick(colors) };
  }
  if (/Triangles/.test(set)) return { kind: pick(['down', 'dash', 'up']), color: pick([R, Y, G]) };
  if (/Stars/.test(set)) return { kind: pick(['star0', 'star1', 'star2']), color: Y };
  if (/Rating|Boxes|Quarters/.test(set)) return { kind: `rating${idx}/${count - 1}`, color: /Quarters/.test(set) ? K : '4472C4' };
  if (/Flags/.test(set)) return { kind: 'flag', color: pick([R, Y, G]) };
  if (/Symbols/.test(set)) return { kind: pick(['cross', 'excl', 'check']), color: pick([R, Y, G]) };
  if (/RedToBlack/.test(set)) return { kind: 'dot', color: pick([K, GR, 'F4B183', R]) };
  if (/Signs/.test(set)) return { kind: pick(['diamond', 'triangle', 'dot']), color: pick([R, Y, G]) };
  // traffic lights
  return { kind: 'dot', color: count === 4 ? pick([K, R, Y, G]) : pick([R, Y, G]) };
}
