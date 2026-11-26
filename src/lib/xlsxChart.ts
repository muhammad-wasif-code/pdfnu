/**
 * Excel charts (DrawingML chart parts): parse the chart XML and draw it as vector graphics.
 * Bar/column (clustered, stacked, 100%), line, area, pie, doughnut, scatter, bubble, radar,
 * combination charts with a secondary axis, titles, legends, gridlines, axis titles and data labels.
 * Values come from the cached data in the chart part, or from the cells when the cache is missing.
 */
import { kid, kids, find, type XNode } from './xml';
import { dmlColor, fillOf, lineOf, tint, type Theme } from './xlsxColor';
import { formatNumber } from './numFmt';
import {
  rectangle, fill, stroke, moveTo, lineTo, appendBezierCurve, closePath, setFillingRgbColor, setStrokingRgbColor, setLineWidth,
  setDashPattern, pushGraphicsState, popGraphicsState, clip, endPath, fillAndStroke, type PDFOperator,
} from 'pdf-lib';
import type { TextEngine, TextStyle, Keyer } from './textEngine';

export interface DLbl { val: boolean; cat: boolean; ser: boolean; pct: boolean; pos?: string; fmt?: string; }
export interface Series {
  name: string; nameRef?: string;
  cats: string[]; catRef?: string; catFmt?: string;
  vals: (number | null)[]; valRef?: string; fmt?: string;
  xs?: (number | null)[]; xRef?: string; sizes?: (number | null)[]; sizeRef?: string;
  color?: string; noFill?: boolean; line?: { color: string; w: number; dash?: string } | null;
  marker?: string | null; markerSize: number; markerFill?: string;
  points: Record<number, string>; labels?: DLbl; smooth: boolean; explosion: number;
}
export interface Group {
  type: 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'radar' | 'bubble';
  dir: 'col' | 'bar'; grouping: string; varyColors: boolean; series: Series[]; axIds: string[];
  gap: number; overlap: number; hole: number; firstAngle: number; labels?: DLbl; markers: boolean; scatterStyle?: string; radarStyle?: string; stock?: boolean;
}
export interface Axis {
  id: string; kind: 'cat' | 'val' | 'date' | 'ser'; pos: string; deleted: boolean; min?: number; max?: number; major?: number;
  fmt?: string; linked: boolean; grid: boolean; title?: string; reverse: boolean; log?: number; labels: boolean; crossAx?: string; crosses?: string;
}
export interface ChartSpec {
  title?: string; autoTitle: boolean; groups: Group[]; axes: Axis[]; legend: { pos: string; overlay: boolean } | null;
  bg: string | null; border: string | null; plotBg: string | null; titleSize: number; textSize: number; textColor: string;
}

const num = (v: string | undefined, d = 0) => (v === undefined || v === '' || isNaN(+v) ? d : +v);
const val = (el: XNode | undefined, d?: string) => el?.a.val ?? d;
const on = (el: XNode | undefined, d = false) => (el ? el.a.val !== '0' && el.a.val !== 'false' : d);

function richText(tx: XNode | undefined): string | undefined {
  if (!tx) return undefined;
  const rich = kid(tx, 'rich');
  if (rich) return kids(rich, 'p').map((p) => find(p, 't').map((t) => t.t).join('')).join('\n');
  const sr = kid(tx, 'strRef');
  if (sr) return find(kid(sr, 'strCache'), 'v').map((v) => v.t).join(' ');
  return kid(tx, 'v')?.t;
}
function cache(el: XNode | undefined): { pts: string[]; fmt?: string; ref?: string } {
  if (!el) return { pts: [] };
  const ref = el.c.find((c) => /Ref$/.test(c.n));
  const lit = el.c.find((c) => /Lit$/.test(c.n));
  const src = ref ?? lit;
  const f = ref ? kid(ref, 'f')?.t : undefined;
  let c = src ? src.c.find((x) => /Cache$/.test(x.n)) ?? (lit ? lit : undefined) : undefined;
  // multi-level categories: use the innermost level
  if (src?.n === 'multiLvlStrRef') { const lv = find(c, 'lvl')[0]; if (lv) c = lv; }
  if (!c) return { pts: [], ref: f };
  const count = num(val(kid(c, 'ptCount')), 0);
  const pts: string[] = new Array(count).fill('');
  for (const p of kids(c, 'pt')) { const i = num(p.a.idx); pts[i] = kid(p, 'v')?.t ?? ''; }
  return { pts, fmt: kid(c, 'formatCode')?.t, ref: f };
}
function dlbls(el: XNode | undefined): DLbl | undefined {
  if (!el || on(kid(el, 'delete'))) return undefined;
  const d: DLbl = { val: on(kid(el, 'showVal')), cat: on(kid(el, 'showCatName')), ser: on(kid(el, 'showSerName')), pct: on(kid(el, 'showPercent')), pos: val(kid(el, 'dLblPos')), fmt: kid(el, 'numFmt')?.a.formatCode };
  return d.val || d.cat || d.ser || d.pct ? d : undefined;
}

const GROUPS: Record<string, Group['type']> = {
  barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line', stockChart: 'line', areaChart: 'area', area3DChart: 'area',
  pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie', doughnutChart: 'doughnut', scatterChart: 'scatter', radarChart: 'radar', bubbleChart: 'bubble', surfaceChart: 'line', surface3DChart: 'line',
};

export function parseChart(cs: XNode, theme: Theme): ChartSpec | null {
  const chart = kid(cs, 'chart');
  const plot = kid(chart, 'plotArea');
  if (!chart || !plot) return null;
  const groups: Group[] = [];
  let serIdx = 0;
  for (const g of plot.c) {
    const type = GROUPS[g.n];
    if (!type) continue;
    const series: Series[] = [];
    for (const s of kids(g, 'ser')) {
      const idx = num(val(kid(s, 'idx')), serIdx);
      serIdx++;
      const spPr = kid(s, 'spPr');
      const tx = kid(s, 'tx');
      const cat = cache(kid(s, 'cat') ?? kid(s, 'xVal'));
      const v = cache(kid(s, 'val') ?? kid(s, 'yVal'));
      const mk = kid(s, 'marker');
      const points: Record<number, string> = {};
      for (const p of kids(s, 'dPt')) { const c = fillOf(kid(p, 'spPr'), theme); if (c) points[num(val(kid(p, 'idx')))] = c; }
      const f = fillOf(spPr, theme);
      const ser: Series = {
        name: richText(tx) ?? `Series${idx + 1}`, nameRef: tx ? kid(kid(tx, 'strRef'), 'f')?.t : undefined,
        cats: cat.pts, catRef: cat.ref, catFmt: cat.fmt,
        vals: v.pts.map((x) => (x === '' || isNaN(+x) ? null : +x)), valRef: v.ref, fmt: v.fmt,
        color: f ?? undefined, noFill: f === null, line: lineOf(spPr, theme),
        marker: mk ? val(kid(mk, 'symbol'), 'auto') : undefined, markerSize: num(val(kid(mk, 'size')), 5), markerFill: fillOf(kid(mk, 'spPr'), theme) ?? undefined,
        points, labels: dlbls(kid(s, 'dLbls')), smooth: on(kid(s, 'smooth')), explosion: num(val(kid(s, 'explosion')), 0),
      };
      if (type === 'scatter' || type === 'bubble') {
        ser.xs = cat.pts.map((x) => (x === '' || isNaN(+x) ? null : +x));
        ser.xRef = cat.ref;
        if (ser.xs.every((x) => x === null) && cat.pts.length) ser.xs = cat.pts.map((_, i) => i + 1);
        const bs = cache(kid(s, 'bubbleSize'));
        ser.sizes = bs.pts.map((x) => (x === '' || isNaN(+x) ? null : +x)); ser.sizeRef = bs.ref;
      }
      series.push(ser);
    }
    groups.push({
      type, dir: val(kid(g, 'barDir'), 'col') === 'bar' ? 'bar' : 'col',
      grouping: val(kid(g, 'grouping'), type === 'bar' ? 'clustered' : 'standard')!,
      varyColors: on(kid(g, 'varyColors'), false), series, axIds: kids(g, 'axId').map((a) => a.a.val),
      gap: num(val(kid(g, 'gapWidth')), 150), overlap: num(val(kid(g, 'overlap')), 0), hole: num(val(kid(g, 'holeSize')), 50),
      firstAngle: num(val(kid(g, 'firstSliceAng')), 0), labels: dlbls(kid(g, 'dLbls')), markers: on(kid(g, 'marker'), g.n === 'lineChart' ? false : true),
      scatterStyle: val(kid(g, 'scatterStyle')), radarStyle: val(kid(g, 'radarStyle')), stock: g.n === 'stockChart',
    });
  }
  if (!groups.length) return null;
  const axes: Axis[] = [];
  for (const a of plot.c) {
    if (!['catAx', 'valAx', 'dateAx', 'serAx'].includes(a.n)) continue;
    const sc = kid(a, 'scaling');
    const nf = kid(a, 'numFmt');
    axes.push({
      id: val(kid(a, 'axId'), '')!, kind: a.n.slice(0, 3) as Axis['kind'], pos: val(kid(a, 'axPos'), 'b')!, deleted: on(kid(a, 'delete')),
      min: kid(sc, 'min') ? num(val(kid(sc, 'min'))) : undefined, max: kid(sc, 'max') ? num(val(kid(sc, 'max'))) : undefined,
      major: kid(a, 'majorUnit') ? num(val(kid(a, 'majorUnit'))) : undefined, reverse: val(kid(sc, 'orientation')) === 'maxMin',
      log: kid(sc, 'logBase') ? num(val(kid(sc, 'logBase')), 10) : undefined,
      fmt: nf?.a.formatCode, linked: nf ? nf.a.sourceLinked !== '0' : true, grid: !!kid(a, 'majorGridlines'),
      title: richText(kid(kid(a, 'title'), 'tx')), labels: val(kid(a, 'tickLblPos'), 'nextTo') !== 'none',
      crossAx: val(kid(a, 'crossAx')), crosses: val(kid(a, 'crosses')),
    });
  }
  const t = kid(chart, 'title');
  const lg = kid(chart, 'legend');
  const area = kid(cs, 'spPr');
  const areaFill = fillOf(area, theme), areaLine = lineOf(area, theme);
  const tSz = find(kid(t, 'tx') ?? kid(t, 'txPr'), 'defRPr')[0]?.a.sz ?? find(kid(t, 'tx'), 'rPr')[0]?.a.sz;
  const txPr = find(kid(cs, 'txPr'), 'defRPr')[0];
  return {
    title: t ? richText(kid(t, 'tx')) : undefined, autoTitle: !!t && !on(kid(chart, 'autoTitleDeleted')), groups, axes,
    legend: lg ? { pos: val(kid(lg, 'legendPos'), 'r')!, overlay: on(kid(lg, 'overlay')) } : null,
    bg: areaFill === undefined ? 'FFFFFF' : areaFill, border: areaLine === undefined ? 'D9D9D9' : areaLine?.color ?? null,
    plotBg: fillOf(kid(plot, 'spPr'), theme) ?? null,
    titleSize: tSz ? +tSz / 100 : 14, textSize: txPr?.a.sz ? +txPr.a.sz / 100 : 9, textColor: fillOf(txPr, theme) ?? '595959',
  };
}

/** Fill in series values from the sheet when the chart has no cached data. */
export function fillChartData(spec: ChartSpec, range: (ref: string) => (string | number | boolean | null)[]) {
  const nums = (xs: (string | number | boolean | null)[]) => xs.map((x) => (typeof x === 'number' ? x : null));
  for (const g of spec.groups) for (const s of g.series) {
    if (s.valRef && !s.vals.some((v) => v !== null)) s.vals = nums(range(s.valRef));
    if (s.catRef && !s.cats.some(Boolean)) s.cats = range(s.catRef).map((x) => (x === null ? '' : typeof x === 'number' && s.catFmt ? formatNumber(x, s.catFmt).text : String(x)));
    if (s.xRef && s.xs && !s.xs.some((v) => v !== null)) s.xs = nums(range(s.xRef));
    if (s.sizeRef && s.sizes && !s.sizes.some((v) => v !== null)) s.sizes = nums(range(s.sizeRef));
    if (s.nameRef && /^Series\d+$/.test(s.name)) { const n = range(s.nameRef)[0]; if (n !== null && n !== undefined) s.name = String(n); }
  }
}

/** Every string the chart may draw (to preload fonts). */
export function chartTexts(spec: ChartSpec): string[] {
  const out = [spec.title ?? '', '0123456789.,-–%()$€£¥₹E+ '];
  for (const a of spec.axes) if (a.title) out.push(a.title);
  for (const g of spec.groups) for (const s of g.series) {
    out.push(s.name, ...s.cats.slice(0, 500));
    if (s.fmt) out.push(formatNumber(-1234.5, s.fmt).text, formatNumber(0.5, s.fmt).text);
  }
  return out.filter(Boolean);
}

// ───────── drawing ─────────
const hex = (h: string): [number, number, number] => [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
const K = 0.5523;
const FONT: TextStyle = { family: 'calibri' };

export function seriesColor(theme: Theme, i: number): string {
  const acc = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((k) => theme.byName[k]);
  const base = acc[i % 6];
  const round = Math.floor(i / 6);
  return round === 0 ? base : round % 2 === 1 ? tint(base, -0.4) : tint(base, 0.4);
}

function niceStep(range: number, target: number): number {
  if (range <= 0 || !isFinite(range)) return 1;
  const raw = range / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function scale(lo: number, hi: number, ax: Axis | undefined, target: number) {
  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) { if (lo === 0) hi = 1; else if (lo > 0) lo = 0; else hi = 0; }
  if (lo > 0 && (hi - lo) / hi > 1 / 6) lo = 0;
  if (hi < 0 && (lo - hi) / lo > 1 / 6) hi = 0;
  let step = ax?.major ?? niceStep(hi - lo, target);
  let min = ax?.min ?? Math.floor(lo / step + 1e-9) * step;
  let max = ax?.max ?? Math.ceil(hi / step - 1e-9) * step;
  if (max === hi && ax?.max === undefined && hi !== 0 && hi > 0) max += 0; // Excel leaves the top tick at the max value
  if (max <= min) max = min + step;
  if ((max - min) / step > 40) { step = niceStep(max - min, target); }
  return { min, max, step };
}

interface Box { x: number; y: number; w: number; h: number; }

/** Draw a chart into a box (PDF user space, y up). */
export function drawChart(spec: ChartSpec, box: Box, te: TextEngine, key: Keyer, theme: Theme): PDFOperator[] {
  const o: PDFOperator[] = [];
  const ts = spec.textSize, tc = spec.textColor;
  const text = (s: string, size: number, x: number, y: number, align: 'l' | 'c' | 'r' = 'l', color = tc, rotate = 0, bold = false) => {
    if (!s) return 0;
    const st = bold ? { ...FONT, bold: true } : FONT;
    const sh = te.shape(s, st, size);
    let dx = align === 'c' ? -sh.width / 2 : align === 'r' ? -sh.width : 0;
    // keep horizontal labels inside the chart area
    if (!rotate) { const lo = box.x + 2, hi = box.x + box.w - 2; if (x + dx < lo) dx = lo - x; if (x + dx + sh.width > hi) dx = hi - x - sh.width; }
    if (rotate) {
      const a = (rotate * Math.PI) / 180;
      o.push(...te.ops(sh, x + dx * Math.cos(a), y + dx * Math.sin(a), { color: hex(color), key, rotate }));
    } else o.push(...te.ops(sh, x + dx, y, { color: hex(color), key }));
    return sh.width;
  };
  const measure = (s: string, size: number) => (s ? te.measure(s, FONT, size) : 0);
  const rect = (x: number, y: number, w: number, h: number, f?: string | null, line?: string | null, lw = 0.75) => {
    if (w <= 0 || h <= 0) return;
    if (f) o.push(setFillingRgbColor(...hex(f)));
    if (line) o.push(setStrokingRgbColor(...hex(line)), setLineWidth(lw));
    if (f || line) o.push(rectangle(x, y, w, h), f && line ? fillAndStroke() : f ? fill() : stroke());
  };

  o.push(pushGraphicsState(), rectangle(box.x, box.y, box.w, box.h), clip(), endPath());
  rect(box.x, box.y, box.w, box.h, spec.bg, spec.border);
  const pad = Math.min(8, box.w * 0.04);
  let top = box.y + box.h - pad, bottom = box.y + pad, left = box.x + pad, right = box.x + box.w - pad;

  // series colours
  const allSeries = spec.groups.flatMap((g) => g.series.map((s) => ({ g, s })));
  allSeries.forEach(({ s }, i) => { if (!s.color && !s.noFill) s.color = s.line?.color ?? seriesColor(theme, i); });
  const pointColor = (g: Group, s: Series, i: number) => s.points[i] ?? (g.varyColors && (g.type === 'pie' || g.type === 'doughnut' || g.series.length === 1) ? seriesColor(theme, i) : s.color ?? seriesColor(theme, 0));

  // title
  const pieOnly = spec.groups.every((g) => g.type === 'pie' || g.type === 'doughnut');
  const title = spec.title ?? (spec.autoTitle && allSeries.length === 1 ? allSeries[0].s.name : undefined);
  if (title) {
    const tsz = Math.min(spec.titleSize, box.h / 10);
    for (const line of title.split('\n')) { text(line, tsz, box.x + box.w / 2, top - tsz * 0.9, 'c', '595959'); top -= tsz * 1.25; }
    top -= 4;
  }

  // legend
  type Entry = { label: string; color: string; line: boolean; marker: boolean };
  const entries: Entry[] = [];
  if (spec.legend) {
    const single = spec.groups.length === 1 && (pieOnly || (spec.groups[0].varyColors && spec.groups[0].series.length === 1));
    if (single) { const g = spec.groups[0], s = g.series[0]; s?.cats.forEach((c, i) => entries.push({ label: c || String(i + 1), color: pointColor(g, s, i), line: false, marker: false })); }
    else for (const { g, s } of allSeries) entries.push({ label: s.name, color: s.color ?? s.line?.color ?? '808080', line: g.type === 'line' || (g.type === 'scatter' && s.line !== null), marker: (g.type === 'line' || g.type === 'scatter') && s.marker !== 'none' });
  }
  if (entries.length) {
    const lsz = ts, sw = lsz * 0.8, gap = lsz * 0.9;
    const ew = (e: Entry) => (e.line ? lsz * 2 : sw) + 3 + measure(e.label, lsz);
    const drawEntry = (e: Entry, x: number, y: number) => {
      if (e.line) { o.push(setStrokingRgbColor(...hex(e.color)), setLineWidth(2), moveTo(x, y + lsz * 0.3), lineTo(x + lsz * 2, y + lsz * 0.3), stroke()); if (e.marker) rect(x + lsz - 2, y + lsz * 0.3 - 2, 4, 4, e.color); }
      else rect(x, y, sw, sw, e.color);
      text(e.label, lsz, x + (e.line ? lsz * 2 : sw) + 3, y, 'l');
    };
    const pos = spec.legend!.pos;
    if (pos === 'r' || pos === 'l' || pos === 'tr') {
      const w = Math.min(box.w * 0.35, Math.max(...entries.map(ew)));
      const totalH = entries.length * lsz * 1.4;
      let y = (top + bottom) / 2 + totalH / 2 - lsz;
      const x = pos === 'l' ? left : right - w;
      for (const e of entries) { if (y < bottom) break; drawEntry(e, x, y); y -= lsz * 1.4; }
      if (!spec.legend!.overlay) { if (pos === 'l') left += w + gap; else right -= w + gap; }
    } else {
      // rows of entries, centred
      const rows: Entry[][] = [[]];
      let rw = 0;
      for (const e of entries) { const w = ew(e) + gap; if (rw + w > right - left && rows[rows.length - 1].length) { rows.push([]); rw = 0; } rows[rows.length - 1].push(e); rw += w; }
      const rowsShown = rows.slice(0, Math.max(1, Math.floor((top - bottom) / 4 / (lsz * 1.4))));
      const blockH = rowsShown.length * lsz * 1.4;
      let y = pos === 't' ? top - lsz : bottom + blockH - lsz;
      for (const r of rowsShown) {
        const w = r.reduce((t, e) => t + ew(e) + gap, -gap);
        let x = (left + right) / 2 - w / 2;
        for (const e of r) { drawEntry(e, x, y); x += ew(e) + gap; }
        y -= lsz * 1.4;
      }
      if (!spec.legend!.overlay) { if (pos === 't') top -= blockH + 4; else bottom += blockH + 4; }
    }
  }

  // pies and doughnuts
  if (pieOnly) {
    const g = spec.groups[0];
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    const R = Math.max(4, Math.min(right - left, top - bottom) / 2 - 4);
    const rings = g.type === 'doughnut' ? g.series : g.series.slice(0, 1);
    const hole = g.type === 'doughnut' ? R * Math.min(0.9, Math.max(0.1, g.hole / 100)) : 0;
    const ringW = (R - hole) / Math.max(1, rings.length);
    rings.forEach((s, ri) => {
      const vals = s.vals.map((v) => (v && v > 0 ? v : 0));
      const total = vals.reduce((a, b) => a + b, 0);
      if (!total) return;
      const rOut = R - ri * ringW, rIn = g.type === 'doughnut' ? rOut - ringW : 0;
      let ang = Math.PI / 2 - (g.firstAngle * Math.PI) / 180;
      vals.forEach((v, i) => {
        if (!v) return;
        const sweep = (v / total) * Math.PI * 2;
        const a0 = ang, a1 = ang - sweep;
        const ex = s.explosion ? (s.explosion / 100) * rOut * 0.3 : 0;
        const mid = (a0 + a1) / 2;
        const ox = cx + Math.cos(mid) * ex, oy = cy + Math.sin(mid) * ex;
        o.push(setFillingRgbColor(...hex(pointColor(g, s, i))), setStrokingRgbColor(1, 1, 1), setLineWidth(0.75));
        arc(o, ox, oy, rOut, rIn, a0, a1);
        o.push(fillAndStroke());
        const lab = s.labels ?? g.labels;
        if (lab) {
          const parts: string[] = [];
          if (lab.ser) parts.push(s.name);
          if (lab.cat) parts.push(s.cats[i] ?? '');
          if (lab.val) parts.push(formatNumber(v, lab.fmt ?? s.fmt ?? 'General').text);
          if (lab.pct) parts.push(formatNumber(v / total, lab.fmt && /%/.test(lab.fmt) ? lab.fmt : '0%').text);
          const lr = lab.pos === 'outEnd' ? rOut + ts : rIn ? (rOut + rIn) / 2 : rOut * 0.65;
          const lx = ox + Math.cos(mid) * lr, ly = oy + Math.sin(mid) * lr - ts * 0.35;
          const dark = isDark(pointColor(g, s, i)) && lab.pos !== 'outEnd';
          text(parts.join('; '), ts, lx, ly, 'c', dark ? 'FFFFFF' : '404040');
        }
        ang = a1;
      });
    });
    o.push(popGraphicsState());
    return o;
  }

  // radar
  const radar = spec.groups.find((g) => g.type === 'radar');
  if (radar && spec.groups.length === 1) {
    drawRadar(o, radar, { x: left, y: bottom, w: right - left, h: top - bottom }, text, ts, spec);
    o.push(popGraphicsState());
    return o;
  }

  // axis charts
  const axById = new Map(spec.axes.map((a) => [a.id, a]));
  const horizontal = spec.groups.some((g) => g.type === 'bar' && g.dir === 'bar');
  const xyChart = spec.groups.some((g) => g.type === 'scatter' || g.type === 'bubble');
  const nCats = Math.max(1, ...spec.groups.flatMap((g) => g.series.map((s) => Math.max(s.vals.length, s.cats.length))));
  const cats = (spec.groups.flatMap((g) => g.series).find((s) => s.cats.some(Boolean))?.cats ?? []).slice();
  while (cats.length < nCats) cats.push(String(cats.length + 1));

  // value ranges per value axis (primary / secondary)
  const valAxes = spec.axes.filter((a) => a.kind === 'val');
  const groupValAx = (g: Group) => g.axIds.map((id) => axById.get(id)).find((a) => a?.kind === 'val' && !(xyChart && (a.pos === 'b' || a.pos === 't')));
  const primary = valAxes.find((a) => (horizontal ? a.pos === 'b' || a.pos === 't' : a.pos === 'l')) ?? valAxes[0];
  const isSecondary = (g: Group) => { const a = groupValAx(g); return !!a && !!primary && a.id !== primary.id && spec.groups.some((x) => groupValAx(x)?.id === primary.id); };
  const extent = (secondary: boolean) => {
    let lo = Infinity, hi = -Infinity;
    for (const g of spec.groups) {
      if (isSecondary(g) !== secondary) continue;
      if (g.grouping === 'percentStacked') { lo = Math.min(lo, 0); hi = Math.max(hi, 1); continue; }
      if (g.grouping === 'stacked' && (g.type === 'bar' || g.type === 'area' || g.type === 'line')) {
        for (let i = 0; i < nCats; i++) { let p = 0, n = 0; for (const s of g.series) { const v = s.vals[i] ?? 0; if (v >= 0) p += v; else n += v; } hi = Math.max(hi, p); lo = Math.min(lo, n); }
      } else for (const s of g.series) for (const v of s.vals) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (lo === Infinity) { lo = 0; hi = 1; }
    if (spec.groups.some((g) => !isSecondary(g) === !secondary && (g.type === 'bar' || g.type === 'area'))) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    return [lo, hi];
  };
  const secAx = spec.groups.some(isSecondary) ? groupValAx(spec.groups.find(isSecondary)!) : undefined;
  let xr: { min: number; max: number; step: number } | null = null;
  if (xyChart) {
    let lo = Infinity, hi = -Infinity;
    for (const g of spec.groups) for (const s of g.series) for (const x of s.xs ?? []) if (x !== null) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    const xa = spec.axes.find((a) => a.kind === 'val' && (a.pos === 'b' || a.pos === 't'));
    xr = scale(lo, hi, xa, Math.max(3, Math.round((right - left) / 60)));
  }
  const plotHGuess = top - bottom - ts * 2.5;
  const [plo, phi] = extent(false);
  const yAxisForGroups = xyChart ? spec.axes.find((a) => a.kind === 'val' && (a.pos === 'l' || a.pos === 'r')) : primary;
  const ys = scale(plo, phi, yAxisForGroups, Math.max(3, Math.min(10, Math.round((horizontal ? right - left : plotHGuess) / (horizontal ? 60 : 28)))));
  const [slo, shi] = extent(true);
  const ys2 = secAx ? scale(slo, shi, secAx, Math.max(3, Math.min(10, Math.round(plotHGuess / 28)))) : null;
  const valFmt = (ax: Axis | undefined, g?: Group) => (ax?.fmt && !(ax.linked && (g?.series[0]?.fmt))) ? ax.fmt : g?.series[0]?.fmt ?? ax?.fmt ?? 'General';
  const pctFmt = spec.groups.some((g) => g.grouping === 'percentStacked') ? '0%' : undefined;
  const primFmt = pctFmt ?? valFmt(yAxisForGroups, spec.groups.find((g) => !isSecondary(g)));
  const tickLabels = (sc: { min: number; max: number; step: number }, fmt: string) => {
    const out: { v: number; s: string }[] = [];
    for (let v = sc.min, k = 0; v <= sc.max + sc.step * 1e-6 && k < 60; v += sc.step, k++) { const vv = Math.abs(v) < sc.step * 1e-9 ? 0 : v; out.push({ v: vv, s: formatNumber(vv, fmt).text }); }
    return out;
  };
  const yTicks = tickLabels(ys, primFmt);
  const y2Ticks = ys2 ? tickLabels(ys2, valFmt(secAx, spec.groups.find(isSecondary))) : [];
  const xTicks = xr ? tickLabels(xr, valFmt(spec.axes.find((a) => a.kind === 'val' && (a.pos === 'b' || a.pos === 't')), undefined)) : [];
  const catAx = spec.axes.find((a) => a.kind === 'cat' || a.kind === 'date');
  const showY = !(yAxisForGroups?.deleted) && (yAxisForGroups?.labels ?? true);
  const showCat = !(catAx?.deleted) && (catAx?.labels ?? true);

  // axis titles
  const valTitle = yAxisForGroups?.title, catTitle = xyChart ? spec.axes.find((a) => a.kind === 'val' && (a.pos === 'b' || a.pos === 't'))?.title : catAx?.title;
  const leftTitle = horizontal ? catTitle : valTitle, bottomTitle = horizontal ? valTitle : catTitle;
  if (leftTitle) { text(leftTitle, ts, left + ts * 0.8, (top + bottom) / 2, 'c', tc, 90, true); left += ts * 1.6; }
  if (bottomTitle) { text(bottomTitle, ts, (left + right) / 2, bottom + 1, 'c', tc, 0, true); bottom += ts * 1.6; }
  if (secAx?.title) { text(secAx.title, ts, right - ts * 0.3, (top + bottom) / 2, 'c', tc, -90, true); right -= ts * 1.6; }

  // reserve room for tick labels
  const leftLabels = horizontal ? (showCat ? cats.map((c) => c) : []) : showY ? yTicks.map((t) => t.s) : [];
  const leftW = leftLabels.length ? Math.min((right - left) * 0.35, Math.max(...leftLabels.map((s) => measure(s, ts)))) + 4 : 0;
  left += leftW;
  if (ys2 && !horizontal) right -= Math.max(...y2Ticks.map((t) => measure(t.s, ts))) + 4;
  const plotW0 = right - left;
  let rotateCats = false, catEvery = 1;
  if (!horizontal && !xyChart && showCat) {
    const band = plotW0 / nCats;
    const maxW = Math.max(...cats.map((c) => measure(c, ts)));
    if (maxW > band * 0.95) { rotateCats = true; catEvery = Math.max(1, Math.ceil((ts * 1.3) / band)); }
    bottom += rotateCats ? Math.min((top - bottom) * 0.4, maxW * 0.72 + ts) : ts * 1.5;
  } else if (horizontal || xyChart) bottom += (horizontal ? (showY ? ts * 1.5 : 0) : ts * 1.5);
  const P: Box = { x: left, y: bottom, w: Math.max(4, right - left), h: Math.max(4, top - bottom - ts * 0.5) };
  if (spec.plotBg) rect(P.x, P.y, P.w, P.h, spec.plotBg);

  // value → position
  const vPos = (v: number, sc: { min: number; max: number }) => (horizontal ? P.x + ((v - sc.min) / (sc.max - sc.min)) * P.w : P.y + ((v - sc.min) / (sc.max - sc.min)) * P.h);
  const revCats = catAx?.reverse ?? false;
  const band = (horizontal ? P.h : P.w) / nCats;
  const catCenter = (i: number) => {
    const k = revCats ? nCats - 1 - i : i; // first category at the left, or at the bottom for horizontal bars
    return (horizontal ? P.y : P.x) + k * band + band / 2;
  };
  const xPos = (x: number) => P.x + ((x - xr!.min) / (xr!.max - xr!.min)) * P.w;

  // gridlines + value labels
  o.push(setLineWidth(0.6), setDashPattern([], 0));
  const gridOn = yAxisForGroups ? yAxisForGroups.grid : true;
  for (const t of yTicks) {
    const p = xyChart ? P.y + ((t.v - ys.min) / (ys.max - ys.min)) * P.h : vPos(t.v, ys);
    if (gridOn) { o.push(setStrokingRgbColor(0.85, 0.85, 0.85)); if (horizontal) o.push(moveTo(p, P.y), lineTo(p, P.y + P.h), stroke()); else o.push(moveTo(P.x, p), lineTo(P.x + P.w, p), stroke()); }
    if (showY) { if (horizontal) text(t.s, ts, p, P.y - ts * 1.2, 'c'); else text(t.s, ts, P.x - 3, p - ts * 0.33, 'r'); }
  }
  if (ys2 && !horizontal) for (const t of y2Ticks) text(t.s, ts, P.x + P.w + 3, P.y + ((t.v - ys2.min) / (ys2.max - ys2.min)) * P.h - ts * 0.33, 'l');
  if (xyChart && xr) {
    const xa = spec.axes.find((a) => a.kind === 'val' && (a.pos === 'b' || a.pos === 't'));
    for (const t of xTicks) {
      const p = xPos(t.v);
      if (xa?.grid) o.push(setStrokingRgbColor(0.85, 0.85, 0.85), moveTo(p, P.y), lineTo(p, P.y + P.h), stroke());
      if (!xa?.deleted) text(t.s, ts, p, P.y - ts * 1.2, 'c');
    }
  }
  // category labels
  if (!xyChart && showCat) {
    cats.forEach((c, i) => {
      if (i % catEvery) return;
      const p = catCenter(i);
      if (horizontal) text(c, ts, P.x - 3, p - ts * 0.33, 'r');
      else if (rotateCats) text(c, ts, p + ts * 0.3, P.y - 4, 'r', tc, 45);
      else text(c, ts, p, P.y - ts * 1.2, 'c');
    });
  }
  // axis line (category axis at the zero line)
  const zero = vPos(Math.max(ys.min, Math.min(ys.max, 0)), ys);
  o.push(setStrokingRgbColor(0.75, 0.75, 0.75), setLineWidth(0.75));
  if (xyChart) o.push(moveTo(P.x, P.y), lineTo(P.x + P.w, P.y), stroke());
  else if (horizontal) o.push(moveTo(zero, P.y), lineTo(zero, P.y + P.h), stroke());
  else o.push(moveTo(P.x, zero), lineTo(P.x + P.w, zero), stroke());

  o.push(pushGraphicsState(), rectangle(P.x - 2, P.y - 2, P.w + 4, P.h + 4), clip(), endPath());
  const labels: (() => void)[] = [];
  // draw groups: areas first, then bars, then lines/scatter on top
  const order = (g: Group) => (g.type === 'area' ? 0 : g.type === 'bar' ? 1 : 2);
  for (const g of spec.groups.slice().sort((a, b) => order(a) - order(b))) {
    const sc = isSecondary(g) && ys2 ? ys2 : ys;
    const n = g.series.length;
    const stacked = g.grouping === 'stacked' || g.grouping === 'percentStacked';
    const totals = Array.from({ length: nCats }, (_, i) => g.series.reduce((t, s) => t + Math.abs(s.vals[i] ?? 0), 0) || 1);
    const norm = (v: number, i: number) => (g.grouping === 'percentStacked' ? v / totals[i] : v);
    const fmtOf = (s: Series) => (s.labels ?? g.labels)?.fmt ?? s.fmt ?? 'General';
    const label = (s: Series, i: number, v: number, x: number, y: number, inside: boolean) => {
      const lab = s.labels ?? g.labels;
      if (!lab) return;
      const parts: string[] = [];
      if (lab.ser) parts.push(s.name);
      if (lab.cat) parts.push(cats[i] ?? '');
      if (lab.val || lab.pct) parts.push(formatNumber(v, fmtOf(s)).text);
      labels.push(() => text(parts.join('; '), ts, x, y, 'c', inside && isDark(pointColor(g, s, i)) ? 'FFFFFF' : '404040'));
    };
    if (g.type === 'bar') {
      const ov = stacked ? 1 : Math.max(-1, Math.min(1, g.overlap / 100));
      const groupW = band / (1 + g.gap / 100);
      const bw = stacked ? groupW : groupW / (n - (n - 1) * ov);
      const pos = new Array(nCats).fill(0), neg = new Array(nCats).fill(0);
      g.series.forEach((s, si) => {
        if (s.noFill && !s.line) return;
        for (let i = 0; i < nCats; i++) {
          const raw = s.vals[i];
          if (raw === null || raw === undefined) continue;
          const v = norm(raw, i);
          let base = 0;
          if (stacked) { if (v >= 0) { base = pos[i]; pos[i] += v; } else { base = neg[i]; neg[i] += v; } }
          const p0 = vPos(Math.max(sc.min, Math.min(sc.max, base)), sc), p1 = vPos(Math.max(sc.min, Math.min(sc.max, base + v)), sc);
          const c = catCenter(i);
          const off = stacked ? -bw / 2 : -groupW / 2 + si * bw * (1 - ov);
          const color = s.noFill ? null : pointColor(g, s, i);
          const edge = s.line ? s.line.color : null;
          if (horizontal) rect(Math.min(p0, p1), c + off, Math.abs(p1 - p0), bw, color, edge, s.line?.w ?? 0.75);
          else rect(c + off, Math.min(p0, p1), bw, Math.abs(p1 - p0), color, edge, s.line?.w ?? 0.75);
          const inside = stacked || (s.labels ?? g.labels)?.pos === 'ctr' || (s.labels ?? g.labels)?.pos === 'inEnd';
          if (horizontal) label(s, i, raw, inside ? (p0 + p1) / 2 : p1 + (v >= 0 ? 12 : -12), c + off + bw / 2 - ts * 0.33, inside);
          else label(s, i, raw, c + off + bw / 2, inside ? (p0 + p1) / 2 - ts * 0.33 : v >= 0 ? p1 + 2 : p1 - ts - 1, inside);
        }
      });
    } else if (g.type === 'area') {
      const acc = new Array(nCats).fill(0);
      g.series.forEach((s) => {
        const pts: [number, number][] = [], basePts: [number, number][] = [];
        for (let i = 0; i < nCats; i++) {
          const v = norm(s.vals[i] ?? 0, i);
          const b = stacked ? acc[i] : 0;
          const top_ = stacked ? b + v : v;
          const x = nCats === 1 ? P.x + P.w / 2 : P.x + (i / (nCats - 1)) * P.w;
          pts.push([x, vPos(top_, sc)]); basePts.push([x, vPos(Math.max(sc.min, b), sc)]);
          if (stacked) acc[i] += v;
        }
        o.push(setFillingRgbColor(...hex(s.color ?? '808080')));
        pts.forEach(([x, y], k) => o.push(k ? lineTo(x, y) : moveTo(x, y)));
        basePts.slice().reverse().forEach(([x, y]) => o.push(lineTo(x, y)));
        o.push(closePath(), fill());
      });
    } else if (g.type === 'line') {
      const acc = new Array(nCats).fill(0);
      g.series.forEach((s, si) => {
        const pts: ([number, number] | null)[] = [];
        for (let i = 0; i < nCats; i++) {
          const raw = s.vals[i];
          if (raw === null || raw === undefined) { pts.push(null); continue; }
          let v = norm(raw, i);
          if (stacked) { acc[i] += v; v = acc[i]; }
          pts.push([catCenter(i), vPos(v, sc)]);
          label(s, i, raw, catCenter(i), vPos(v, sc) + 5, false);
        }
        const color = s.line?.color ?? s.color ?? seriesColor(theme, si);
        if (s.line !== null && !g.stock) polyline(o, pts, color, s.line?.w ?? 2.25, s.smooth, s.line?.dash);
        const mk = s.marker === undefined ? (g.markers ? 'auto' : 'none') : s.marker;
        if (mk && mk !== 'none') for (const p of pts) if (p) marker(o, mk === 'auto' ? ['circle', 'square', 'diamond', 'triangle'][si % 4] : mk, p[0], p[1], s.markerSize, s.markerFill ?? color);
      });
      if (g.stock) { // high-low lines
        for (let i = 0; i < nCats; i++) {
          const vs = g.series.map((s) => s.vals[i]).filter((v): v is number => v !== null && v !== undefined);
          if (vs.length < 2) continue;
          o.push(setStrokingRgbColor(0.3, 0.3, 0.3), setLineWidth(0.75), moveTo(catCenter(i), vPos(Math.min(...vs), sc)), lineTo(catCenter(i), vPos(Math.max(...vs), sc)), stroke());
        }
      }
    } else if ((g.type === 'scatter' || g.type === 'bubble') && xr) {
      const maxSize = Math.max(1, ...g.series.flatMap((s) => (s.sizes ?? []).map((v) => Math.abs(v ?? 0))));
      g.series.forEach((s, si) => {
        const pts: ([number, number] | null)[] = s.vals.map((v, i) => { const x = s.xs?.[i]; return v === null || x === null || x === undefined ? null : [xPos(x), P.y + ((v - ys.min) / (ys.max - ys.min)) * P.h]; });
        const color = s.color ?? seriesColor(theme, si);
        if (g.type === 'bubble') {
          pts.forEach((p, i) => { if (!p) return; const r = Math.max(2, Math.sqrt(Math.abs(s.sizes?.[i] ?? 1) / maxSize) * Math.min(P.w, P.h) * 0.12); o.push(setFillingRgbColor(...hex(color)), setStrokingRgbColor(1, 1, 1), setLineWidth(0.5)); circle(o, p[0], p[1], r); o.push(fillAndStroke()); });
          return;
        }
        const lines = s.line !== null && (g.scatterStyle !== 'marker' || !!s.line);
        if (lines) polyline(o, pts, s.line?.color ?? color, s.line?.w ?? 2.25, s.smooth || /smooth/i.test(g.scatterStyle ?? ''), s.line?.dash);
        const mk = s.marker ?? 'auto';
        if (mk !== 'none') pts.forEach((p) => p && marker(o, mk === 'auto' ? ['circle', 'square', 'diamond', 'triangle'][si % 4] : mk, p[0], p[1], s.markerSize, s.markerFill ?? color));
        pts.forEach((p, i) => p && label(s, i, s.vals[i]!, p[0], p[1] + 5, false));
      });
    }
  }
  o.push(popGraphicsState());
  labels.forEach((f) => f());
  o.push(popGraphicsState());
  return o;
}

function isDark(h: string) { const [r, g, b] = hex(h); return 0.299 * r + 0.587 * g + 0.114 * b < 0.55; }

function circle(o: PDFOperator[], cx: number, cy: number, r: number) {
  o.push(moveTo(cx + r, cy), appendBezierCurve(cx + r, cy + r * K, cx + r * K, cy + r, cx, cy + r), appendBezierCurve(cx - r * K, cy + r, cx - r, cy + r * K, cx - r, cy), appendBezierCurve(cx - r, cy - r * K, cx - r * K, cy - r, cx, cy - r), appendBezierCurve(cx + r * K, cy - r, cx + r, cy - r * K, cx + r, cy), closePath());
}

/** Annular sector from angle a0 to a1 (radians, a1 < a0 = clockwise). */
function arc(o: PDFOperator[], cx: number, cy: number, r: number, rIn: number, a0: number, a1: number) {
  const seg = (rr: number, from: number, to: number, first: boolean) => {
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2)));
    const d = (to - from) / n;
    for (let i = 0; i < n; i++) {
      const s = from + i * d, e = s + d;
      const k = (4 / 3) * Math.tan((e - s) / 4);
      const x0 = cx + rr * Math.cos(s), y0 = cy + rr * Math.sin(s), x3 = cx + rr * Math.cos(e), y3 = cy + rr * Math.sin(e);
      if (i === 0) o.push(first ? moveTo(x0, y0) : lineTo(x0, y0));
      o.push(appendBezierCurve(x0 - k * rr * Math.sin(s), y0 + k * rr * Math.cos(s), x3 + k * rr * Math.sin(e), y3 - k * rr * Math.cos(e), x3, y3));
    }
  };
  if (Math.abs(a0 - a1) >= Math.PI * 2 - 1e-6) {
    circle(o, cx, cy, r);
    if (rIn > 0) { // even-odd not available via helper: draw inner circle reversed
      o.push(moveTo(cx + rIn, cy));
      o.push(appendBezierCurve(cx + rIn, cy - rIn * K, cx + rIn * K, cy - rIn, cx, cy - rIn), appendBezierCurve(cx - rIn * K, cy - rIn, cx - rIn, cy - rIn * K, cx - rIn, cy), appendBezierCurve(cx - rIn, cy + rIn * K, cx - rIn * K, cy + rIn, cx, cy + rIn), appendBezierCurve(cx + rIn * K, cy + rIn, cx + rIn, cy + rIn * K, cx + rIn, cy), closePath());
    }
    return;
  }
  if (rIn > 0) { seg(r, a0, a1, true); seg(rIn, a1, a0, false); o.push(closePath()); }
  else { o.push(moveTo(cx, cy)); seg(r, a0, a1, false); o.push(closePath()); }
}

const DASH: Record<string, number[]> = { dash: [4, 3], sysDash: [3, 1], dot: [1, 2], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3] };
function polyline(o: PDFOperator[], pts: ([number, number] | null)[], color: string, w: number, smooth: boolean, dash?: string) {
  o.push(setStrokingRgbColor(...hex(color)), setLineWidth(w), setDashPattern(DASH[dash ?? ''] ?? [], 0));
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length > 1) {
      o.push(moveTo(run[0][0], run[0][1]));
      for (let i = 1; i < run.length; i++) {
        if (!smooth) { o.push(lineTo(run[i][0], run[i][1])); continue; }
        const p0 = run[i - 2] ?? run[i - 1], p1 = run[i - 1], p2 = run[i], p3 = run[i + 1] ?? p2;
        o.push(appendBezierCurve(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]));
      }
      o.push(stroke());
    }
    run = [];
  };
  for (const p of pts) { if (p) run.push(p); else flush(); }
  flush();
  o.push(setDashPattern([], 0));
}
function marker(o: PDFOperator[], sym: string, x: number, y: number, size: number, color: string) {
  const r = Math.max(1.5, size * 0.45);
  o.push(setFillingRgbColor(...hex(color)), setStrokingRgbColor(...hex(color)), setLineWidth(0.75));
  if (sym === 'square') o.push(rectangle(x - r, y - r, 2 * r, 2 * r), fill());
  else if (sym === 'diamond') o.push(moveTo(x, y + r * 1.2), lineTo(x + r * 1.2, y), lineTo(x, y - r * 1.2), lineTo(x - r * 1.2, y), closePath(), fill());
  else if (sym === 'triangle') o.push(moveTo(x, y + r * 1.2), lineTo(x + r * 1.1, y - r * 0.8), lineTo(x - r * 1.1, y - r * 0.8), closePath(), fill());
  else if (sym === 'x' || sym === 'star' || sym === 'plus') { o.push(moveTo(x - r, y - r), lineTo(x + r, y + r), moveTo(x - r, y + r), lineTo(x + r, y - r), stroke()); if (sym !== 'x') o.push(moveTo(x, y - r), lineTo(x, y + r), stroke()); }
  else if (sym === 'dash') o.push(rectangle(x - r, y - r * 0.3, 2 * r, r * 0.6), fill());
  else if (sym === 'dot') { circle(o, x, y, r * 0.5); o.push(fill()); }
  else { circle(o, x, y, r); o.push(fill()); }
}

function drawRadar(o: PDFOperator[], g: Group, P: Box, text: (s: string, size: number, x: number, y: number, align?: 'l' | 'c' | 'r') => number, ts: number, spec: ChartSpec) {
  const n = Math.max(3, ...g.series.map((s) => s.vals.length));
  const cats = g.series[0]?.cats ?? [];
  const cx = P.x + P.w / 2, cy = P.y + P.h / 2, R = Math.max(4, Math.min(P.w, P.h) / 2 - ts * 2);
  let hi = 0; for (const s of g.series) for (const v of s.vals) if (v !== null) hi = Math.max(hi, v);
  const sc = scale(0, hi, spec.axes.find((a) => a.kind === 'val'), 5);
  const ang = (i: number) => Math.PI / 2 - (i / n) * Math.PI * 2;
  o.push(setStrokingRgbColor(0.85, 0.85, 0.85), setLineWidth(0.6));
  for (let v = sc.step; v <= sc.max + 1e-9; v += sc.step) {
    const r = (v / sc.max) * R;
    for (let i = 0; i <= n; i++) o.push(i ? lineTo(cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))) : moveTo(cx + r * Math.cos(ang(0)), cy + r * Math.sin(ang(0))));
    o.push(stroke());
  }
  for (let i = 0; i < n; i++) {
    o.push(moveTo(cx, cy), lineTo(cx + R * Math.cos(ang(i)), cy + R * Math.sin(ang(i))), stroke());
    text(cats[i] ?? String(i + 1), ts, cx + (R + ts) * Math.cos(ang(i)), cy + (R + ts) * Math.sin(ang(i)) - ts * 0.33, 'c');
  }
  g.series.forEach((s) => {
    const pts = s.vals.map((v, i) => [cx + ((v ?? 0) / sc.max) * R * Math.cos(ang(i)), cy + ((v ?? 0) / sc.max) * R * Math.sin(ang(i))] as [number, number]);
    if (g.radarStyle === 'filled') { o.push(setFillingRgbColor(...hex(s.color ?? '808080'))); pts.forEach(([x, y], k) => o.push(k ? lineTo(x, y) : moveTo(x, y))); o.push(closePath(), fill()); }
    else polyline(o, [...pts, pts[0]], s.line?.color ?? s.color ?? '808080', s.line?.w ?? 2, false);
  });
}
