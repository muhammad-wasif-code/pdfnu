/**
 * The drawing layer of a sheet (xl/drawings/drawingN.xml): pictures, shapes, text boxes,
 * connectors, groups and charts, each anchored to cells. Also draws shapes onto a PDF page.
 */
import { kid, kids, find, type XNode } from './xml';
import { dmlColor, fillOf, lineOf, type Theme } from './xlsxColor';
import { parseChart, type ChartSpec } from './xlsxChart';
import { rectangle, fill, stroke, moveTo, lineTo, appendBezierCurve, closePath, setFillingRgbColor, setStrokingRgbColor, setLineWidth, setDashPattern, pushGraphicsState, popGraphicsState, concatTransformationMatrix, fillAndStroke, clip, endPath, type PDFOperator } from 'pdf-lib';
import { familyFor, wrapLines, type TextEngine, type TextStyle, type Keyer } from './textEngine';

export interface XAnchor {
  c0: number; r0: number; dx0: number; dy0: number; c1: number; r1: number; dx1: number; dy1: number;
  /** fixed size in pt (one-cell / absolute anchors) */ w?: number; h?: number;
  /** position inside the anchor box (fractions x, y, w, h), for objects inside groups */ frac?: [number, number, number, number];
}
export interface XRun { text: string; sz?: number; b?: boolean; i?: boolean; u?: boolean; color?: string; font?: string; }
export interface XPara { runs: XRun[]; align?: string; }
export interface XPicture extends XAnchor { kind: 'pic'; bytes: Uint8Array; type: string; /** crop fractions l, t, r, b */ crop?: [number, number, number, number]; }
export interface XShape extends XAnchor {
  kind: 'shape'; geom: string; fill: string | null; line: { color: string; w: number; dash?: string } | null;
  paras: XPara[]; vAnchor: string; rot: number; flipH: boolean; flipV: boolean; inset: [number, number, number, number];
  head?: string; tail?: string; textColor: string; path?: XNode; adj?: Record<string, number>;
}
export interface XChartObj extends XAnchor { kind: 'chart'; spec: ChartSpec; }
export type XObj = XPicture | XShape | XChartObj;

const EMU = 12700;
const num = (v: string | undefined, d = 0) => (v === undefined || v === '' || isNaN(+v) ? d : +v);

export function anchorOf(a: XNode): XAnchor | null {
  const pos = (n: string) => { const e = kid(a, n); return e ? { c: num(kid(e, 'col')?.t), r: num(kid(e, 'row')?.t), dx: num(kid(e, 'colOff')?.t) / EMU, dy: num(kid(e, 'rowOff')?.t) / EMU } : null; };
  const from = pos('from'), to = pos('to'), ext = kid(a, 'ext');
  if (a.n === 'absoluteAnchor') {
    const p = kid(a, 'pos');
    if (!ext || !p) return null;
    return { c0: 0, r0: 0, dx0: num(p.a.x) / EMU, dy0: num(p.a.y) / EMU, c1: 0, r1: 0, dx1: 0, dy1: 0, w: num(ext.a.cx) / EMU, h: num(ext.a.cy) / EMU };
  }
  if (from && to) return { c0: from.c, r0: from.r, dx0: from.dx, dy0: from.dy, c1: to.c, r1: to.r, dx1: to.dx, dy1: to.dy };
  if (from && ext) return { c0: from.c, r0: from.r, dx0: from.dx, dy0: from.dy, c1: from.c, r1: from.r, dx1: 0, dy1: 0, w: num(ext.a.cx) / EMU, h: num(ext.a.cy) / EMU };
  return null;
}

function xfrmOf(el: XNode): XNode | undefined {
  if (el.n === 'graphicFrame') return kid(el, 'xfrm');
  if (el.n === 'grpSp') return kid(kid(el, 'grpSpPr'), 'xfrm');
  return kid(kid(el, 'spPr'), 'xfrm');
}

function textOf(txBody: XNode | undefined, theme: Theme, defColor: string): XPara[] {
  if (!txBody) return [];
  const lst = kid(kid(txBody, 'lstStyle'), 'lvl1pPr');
  const lstDef = kid(lst, 'defRPr');
  const paras: XPara[] = [];
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const def = kid(pPr, 'defRPr') ?? lstDef;
    const style = (rPr: XNode | undefined): Omit<XRun, 'text'> => {
      const pick = (k: string) => rPr?.a[k] ?? def?.a[k];
      const col = fillOf(rPr, theme) ?? fillOf(def, theme);
      return {
        sz: pick('sz') ? num(pick('sz')) / 100 : undefined, b: pick('b') === '1', i: pick('i') === '1', u: !!pick('u') && pick('u') !== 'none',
        color: col ?? defColor, font: kid(rPr, 'latin')?.a.typeface ?? kid(def, 'latin')?.a.typeface,
      };
    };
    const runs: XRun[] = [];
    for (const r of p.c) {
      if (r.n === 'r' || r.n === 'fld') runs.push({ text: kid(r, 't')?.t ?? '', ...style(kid(r, 'rPr')) });
      else if (r.n === 'br') runs.push({ text: '\n', ...style(kid(r, 'rPr')) });
    }
    if (!runs.length) { const end = kid(p, 'endParaRPr'); runs.push({ text: '', ...style(end) }); }
    paras.push({ runs, align: pPr?.a.algn ?? lst?.a.algn });
  }
  return paras;
}

export interface DrawingCtx {
  theme: Theme;
  rels: Map<string, { target: string; type: string }>;
  file(path: string): Promise<Uint8Array | null>;
  xml(path: string): Promise<XNode | null>;
  convertImage?: (bytes: Uint8Array, type: string) => Promise<Uint8Array | null>;
}

export async function parseDrawing(dx: XNode, ctx: DrawingCtx): Promise<{ objects: XObj[]; skipped: number }> {
  const objects: XObj[] = [];
  let skipped = 0;
  const visit = async (el: XNode, base: XAnchor, frac: [number, number, number, number], space: { x: number; y: number; w: number; h: number } | null) => {
    if (el.n === 'AlternateContent') {
      const choice = kid(el, 'Choice');
      if (choice && !/cx|chartex|a14|sle/i.test(choice.a.Requires ?? '')) { for (const c of choice.c) await visit(c, base, frac, space); return; }
      if (choice && /cx|chartex/i.test(choice.a.Requires ?? '')) { skipped++; return; }
      const fb = kid(el, 'Fallback');
      if (fb) for (const c of fb.c) await visit(c, base, frac, space);
      return;
    }
    if (!['pic', 'sp', 'cxnSp', 'graphicFrame', 'grpSp'].includes(el.n)) return;
    // hidden objects
    const nv = find(el, 'cNvPr')[0];
    if (nv?.a.hidden === '1' || nv?.a.hidden === 'true') return;
    let f = frac;
    const xf = xfrmOf(el);
    if (space && xf) {
      const off = kid(xf, 'off'), ext = kid(xf, 'ext');
      if (off && ext && space.w > 0 && space.h > 0) f = [frac[0] + ((num(off.a.x) - space.x) / space.w) * frac[2], frac[1] + ((num(off.a.y) - space.y) / space.h) * frac[3], (num(ext.a.cx) / space.w) * frac[2], (num(ext.a.cy) / space.h) * frac[3]];
    }
    const anchor: XAnchor = { ...base, frac: f[0] === 0 && f[1] === 0 && f[2] === 1 && f[3] === 1 ? undefined : f };
    if (el.n === 'grpSp') {
      const gx = kid(kid(el, 'grpSpPr'), 'xfrm');
      const chOff = kid(gx, 'chOff'), chExt = kid(gx, 'chExt'), off = kid(gx, 'off'), ext = kid(gx, 'ext');
      const sp = chExt ? { x: num(chOff?.a.x), y: num(chOff?.a.y), w: num(chExt.a.cx), h: num(chExt.a.cy) } : ext ? { x: num(off?.a.x), y: num(off?.a.y), w: num(ext.a.cx), h: num(ext.a.cy) } : null;
      for (const c of el.c) await visit(c, base, f, sp);
      return;
    }
    if (el.n === 'graphicFrame') {
      const chartRef = find(el, 'chart')[0];
      const target = chartRef ? ctx.rels.get(chartRef.a.id)?.target : undefined;
      const cx = target ? await ctx.xml(target) : null;
      const spec = cx ? parseChart(cx, ctx.theme) : null;
      if (spec) objects.push({ kind: 'chart', ...anchor, spec });
      else skipped++;
      return;
    }
    if (el.n === 'pic') {
      const blip = find(el, 'blip')[0];
      const target = blip ? ctx.rels.get(blip.a.embed)?.target : undefined;
      if (!target) { skipped++; return; }
      let bytes = await ctx.file(target);
      if (!bytes) { skipped++; return; }
      let type = /\.png$/i.test(target) ? 'png' : /\.jpe?g$/i.test(target) ? 'jpg' : (target.split('.').pop() ?? '').toLowerCase();
      if (type !== 'png' && type !== 'jpg') {
        const conv = ctx.convertImage ? await ctx.convertImage(bytes, type) : null;
        if (!conv) { skipped++; return; }
        bytes = conv; type = 'png';
      }
      const src = find(el, 'srcRect')[0];
      const crop = src ? ([num(src.a.l), num(src.a.t), num(src.a.r), num(src.a.b)].map((v) => v / 100000) as [number, number, number, number]) : undefined;
      objects.push({ kind: 'pic', ...anchor, bytes, type, crop: crop && crop.some((v) => v) ? crop : undefined });
      return;
    }
    // shapes and connectors
    const spPr = kid(el, 'spPr');
    const style = kid(el, 'style');
    const refColor = (n: string) => { const r = kid(style, n); return r && num(r.a.idx) > 0 ? dmlColor(r.c[0], ctx.theme)?.hex : undefined; };
    const isLine = el.n === 'cxnSp' || /line|Connector/i.test(kid(spPr, 'prstGeom')?.a.prst ?? '');
    let fillC = fillOf(spPr, ctx.theme, refColor('fillRef'));
    if (fillC === undefined) fillC = isLine ? null : refColor('fillRef') ?? null;
    let line = lineOf(spPr, ctx.theme, refColor('lnRef'));
    if (line === undefined) { const lc = refColor('lnRef'); line = lc ? { color: lc, w: isLine ? 0.75 : 1 } : null; }
    const fontC = kid(style, 'fontRef') ? dmlColor(kid(style, 'fontRef')!.c[0], ctx.theme)?.hex : undefined;
    const body = kid(el, 'txBody');
    const bodyPr = kid(body, 'bodyPr');
    const xfr = kid(spPr, 'xfrm');
    const prst = kid(spPr, 'prstGeom');
    const adj: Record<string, number> = {};
    for (const g of kids(kid(prst, 'avLst'), 'gd')) { const m = /val\s+(-?\d+)/.exec(g.a.fmla ?? ''); if (m) adj[g.a.name] = +m[1]; }
    const lnEl = kid(spPr, 'ln');
    const shape: XShape = {
      kind: 'shape', ...anchor,
      geom: isLine ? 'line' : prst?.a.prst ?? (kid(spPr, 'custGeom') ? 'custom' : 'rect'),
      fill: fillC, line, paras: textOf(body, ctx.theme, fontC ?? '000000'),
      vAnchor: bodyPr?.a.anchor ?? 't', rot: num(xfr?.a.rot) / 60000, flipH: xfr?.a.flipH === '1', flipV: xfr?.a.flipV === '1',
      inset: [num(bodyPr?.a.lIns, 91440) / EMU, num(bodyPr?.a.tIns, 45720) / EMU, num(bodyPr?.a.rIns, 91440) / EMU, num(bodyPr?.a.bIns, 45720) / EMU],
      head: kid(lnEl, 'headEnd')?.a.type, tail: kid(lnEl, 'tailEnd')?.a.type, textColor: fontC ?? '000000',
      path: kid(spPr, 'custGeom'), adj,
    };
    if (shape.fill === null && !shape.line && !shape.paras.some((p) => p.runs.some((r) => r.text.trim()))) return;
    objects.push(shape);
  };
  for (const a of dx.c) {
    if (!/Anchor$/.test(a.n)) continue;
    const base = anchorOf(a);
    if (!base) continue;
    for (const c of a.c) await visit(c, base, [0, 0, 1, 1], null);
  }
  return { objects, skipped };
}

/** All strings a drawing will draw (to preload fonts). */
export function shapeTexts(s: XShape): { text: string; style: TextStyle }[] {
  return s.paras.flatMap((p) => p.runs.filter((r) => r.text.trim()).map((r) => ({ text: r.text, style: { family: familyFor(r.font ?? 'Calibri'), bold: r.b, italic: r.i } })));
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
const K = 0.5523; // bezier circle constant

/** Outline of a preset shape inside (0,0)-(w,h), y up. */
export function geomPath(s: Pick<XShape, "geom" | "adj" | "path">, w: number, h: number): PDFOperator[] {
  const o: PDFOperator[] = [];
  const poly = (pts: [number, number][]) => { pts.forEach(([x, y], i) => o.push(i ? lineTo(x, y) : moveTo(x, y))); o.push(closePath()); };
  const ss = Math.min(w, h);
  const a = (name: string, d: number) => (s.adj?.[name] ?? d) / 100000;
  switch (s.geom) {
    case 'ellipse': case 'flowChartConnector': {
      const rx = w / 2, ry = h / 2;
      o.push(moveTo(w, ry), appendBezierCurve(w, ry + ry * K, rx + rx * K, h, rx, h), appendBezierCurve(rx - rx * K, h, 0, ry + ry * K, 0, ry), appendBezierCurve(0, ry - ry * K, rx - rx * K, 0, rx, 0), appendBezierCurve(rx + rx * K, 0, w, ry - ry * K, w, ry), closePath());
      break;
    }
    case 'roundRect': case 'flowChartAlternateProcess': {
      const r = Math.min(ss * a('adj', 16667), w / 2, h / 2);
      o.push(moveTo(r, 0), lineTo(w - r, 0), appendBezierCurve(w - r + r * K, 0, w, r - r * K, w, r), lineTo(w, h - r), appendBezierCurve(w, h - r + r * K, w - r + r * K, h, w - r, h), lineTo(r, h), appendBezierCurve(r - r * K, h, 0, h - r + r * K, 0, h - r), lineTo(0, r), appendBezierCurve(0, r - r * K, r - r * K, 0, r, 0), closePath());
      break;
    }
    case 'triangle': case 'flowChartExtract': poly([[0, 0], [w, 0], [w * a('adj', 50000), h]]); break;
    case 'rtTriangle': poly([[0, 0], [w, 0], [0, h]]); break;
    case 'diamond': case 'flowChartDecision': poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]); break;
    case 'parallelogram': case 'flowChartInputOutput': { const d = ss * a('adj', 25000); poly([[0, 0], [w - d, 0], [w, h], [d, h]]); break; }
    case 'trapezoid': { const d = ss * a('adj', 25000); poly([[0, 0], [w, 0], [w - d, h], [d, h]]); break; }
    case 'pentagon': case 'homePlate': { const d = ss * a('adj', 50000); poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h]]); break; }
    case 'chevron': { const d = ss * a('adj', 50000); poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]); break; }
    case 'hexagon': { const d = ss * a('adj', 25000); poly([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]); break; }
    case 'octagon': { const d = ss * a('adj', 29289); poly([[d, 0], [w - d, 0], [w, d], [w, h - d], [w - d, h], [d, h], [0, h - d], [0, d]]); break; }
    case 'plus': case 'flowChartOr': { const d = ss * a('adj', 25000); poly([[d, 0], [w - d, 0], [w - d, h / 2 - d], [w, h / 2 - d], [w, h / 2 + d], [w - d, h / 2 + d], [w - d, h], [d, h], [d, h / 2 + d], [0, h / 2 + d], [0, h / 2 - d], [d, h / 2 - d]].map(([x, y]) => [x, y]) as [number, number][]); break; }
    case 'rightArrow': { const t = h * a('adj1', 50000) / 2, hd = ss * a('adj2', 50000); poly([[0, h / 2 - t], [w - hd, h / 2 - t], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, h / 2 + t], [0, h / 2 + t]]); break; }
    case 'leftArrow': { const t = h * a('adj1', 50000) / 2, hd = ss * a('adj2', 50000); poly([[w, h / 2 - t], [hd, h / 2 - t], [hd, 0], [0, h / 2], [hd, h], [hd, h / 2 + t], [w, h / 2 + t]]); break; }
    case 'upArrow': { const t = w * a('adj1', 50000) / 2, hd = ss * a('adj2', 50000); poly([[w / 2 - t, 0], [w / 2 + t, 0], [w / 2 + t, h - hd], [w, h - hd], [w / 2, h], [0, h - hd], [w / 2 - t, h - hd]]); break; }
    case 'downArrow': { const t = w * a('adj1', 50000) / 2, hd = ss * a('adj2', 50000); poly([[w / 2 - t, h], [w / 2 + t, h], [w / 2 + t, hd], [w, hd], [w / 2, 0], [0, hd], [w / 2 - t, hd]]); break; }
    case 'star5': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) { const ang = Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? 0.38 : 0.5; pts.push([w / 2 + Math.cos(ang) * r * w, h / 2 + Math.sin(ang) * r * h]); }
      poly(pts); break;
    }
    case 'custom': {
      // custGeom: paths in their own w/h space; coordinates are y-down
      let any = false;
      for (const p of find(s.path, 'path')) {
        const pw = num(p.a.w, 1) || 1, ph = num(p.a.h, 1) || 1;
        const X = (v: string | undefined) => (num(v) / pw) * w, Y = (v: string | undefined) => h - (num(v) / ph) * h;
        for (const c of p.c) {
          const pts = kids(c, 'pt');
          if (c.n === 'moveTo' && pts[0]) { o.push(moveTo(X(pts[0].a.x), Y(pts[0].a.y))); any = true; }
          else if (c.n === 'lnTo' && pts[0]) o.push(lineTo(X(pts[0].a.x), Y(pts[0].a.y)));
          else if (c.n === 'cubicBezTo' && pts.length === 3) o.push(appendBezierCurve(X(pts[0].a.x), Y(pts[0].a.y), X(pts[1].a.x), Y(pts[1].a.y), X(pts[2].a.x), Y(pts[2].a.y)));
          else if (c.n === 'quadBezTo' && pts.length === 2) o.push(appendBezierCurve(X(pts[0].a.x), Y(pts[0].a.y), X(pts[0].a.x), Y(pts[0].a.y), X(pts[1].a.x), Y(pts[1].a.y)));
          else if (c.n === 'close') o.push(closePath());
        }
      }
      if (!any) o.push(rectangle(0, 0, w, h));
      break;
    }
    default: o.push(rectangle(0, 0, w, h));
  }
  return o;
}

const DASH: Record<string, number[]> = { dash: [4, 3], sysDash: [3, 1], dot: [1, 2], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], sysDashDot: [3, 1, 1, 1] };

/**
 * Draw a shape into the box (x, y = bottom, w, h) in the current PDF user space (y up).
 * `k` scales text and line widths (sheet scale is already in the CTM).
 */
export function drawShape(s: XShape, x: number, y: number, w: number, h: number, te: TextEngine, key: Keyer): PDFOperator[] {
  const o: PDFOperator[] = [pushGraphicsState()];
  // rotation about the centre
  const cx = x + w / 2, cy = y + h / 2;
  const r = (-s.rot * Math.PI) / 180;
  o.push(concatTransformationMatrix(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), cx, cy));
  o.push(concatTransformationMatrix(s.flipH ? -1 : 1, 0, 0, s.flipV ? -1 : 1, 0, 0), concatTransformationMatrix(1, 0, 0, 1, -w / 2, -h / 2));
  if (s.geom === 'line') {
    if (s.line) {
      o.push(setStrokingRgbColor(...hex(s.line.color)), setLineWidth(s.line.w), setDashPattern(DASH[s.line.dash ?? ''] ?? [], 0));
      // a connector runs from the top-left to the bottom-right of its box (flips are in the CTM)
      o.push(moveTo(0, h), lineTo(w, 0), stroke());
      const arrow = (fx: number, fy: number, tx: number, ty: number) => {
        const ang = Math.atan2(ty - fy, tx - fx), L = Math.max(4, s.line!.w * 4);
        o.push(setFillingRgbColor(...hex(s.line!.color)), moveTo(tx, ty), lineTo(tx - L * Math.cos(ang - 0.45), ty - L * Math.sin(ang - 0.45)), lineTo(tx - L * Math.cos(ang + 0.45), ty - L * Math.sin(ang + 0.45)), closePath(), fill());
      };
      if (s.tail && s.tail !== 'none') arrow(0, h, w, 0);
      if (s.head && s.head !== 'none') arrow(w, 0, 0, h);
    }
    o.push(popGraphicsState());
    return o;
  }
  const path = geomPath(s, w, h);
  if (s.fill) o.push(setFillingRgbColor(...hex(s.fill)));
  if (s.line) o.push(setStrokingRgbColor(...hex(s.line.color)), setLineWidth(s.line.w), setDashPattern(DASH[s.line.dash ?? ''] ?? [], 0));
  if (s.fill || s.line) { o.push(...path); o.push(s.fill && s.line ? fillAndStroke() : s.fill ? fill() : stroke()); }
  o.push(popGraphicsState());

  // text (not flipped, rotated with the shape)
  const text = s.paras.some((p) => p.runs.some((r) => r.text.trim()));
  if (!text) return o;
  const [li, ti, ri, bi] = s.inset;
  const avail = Math.max(4, w - li - ri);
  type L = { parts: { text: string; style: TextStyle; size: number; color: string; u: boolean }[]; width: number; asc: number; h: number; align: string };
  const lines: L[] = [];
  for (const p of s.paras) {
    // runs → words with their style, wrapped greedily
    let cur: L = { parts: [], width: 0, asc: 0, h: 0, align: p.align ?? 'l' };
    const flush = () => { if (!cur.parts.length) { const sz = p.runs[0]?.sz ?? 11; cur.h = sz * 1.2; cur.asc = sz * 0.9; } lines.push(cur); cur = { parts: [], width: 0, asc: 0, h: 0, align: p.align ?? 'l' }; };
    for (const run of p.runs) {
      const style: TextStyle = { family: familyFor(run.font ?? 'Calibri'), bold: run.b, italic: run.i };
      const size = run.sz ?? 11;
      for (const seg of run.text.split(/(\n)/)) {
        if (seg === '\n') { flush(); continue; }
        for (const word of seg.split(/(?<=\s)/)) {
          if (!word) continue;
          const ww = te.measure(word, style, size);
          if (cur.parts.length && cur.width + te.measure(word.trimEnd(), style, size) > avail) flush();
          const last = cur.parts[cur.parts.length - 1];
          if (last && last.style === style && last.size === size) last.text += word; else cur.parts.push({ text: word, style, size, color: run.color ?? s.textColor, u: !!run.u });
          cur.width += ww; cur.asc = Math.max(cur.asc, size * 0.9); cur.h = Math.max(cur.h, size * 1.2);
        }
      }
    }
    flush();
  }
  const total = lines.reduce((t, l) => t + l.h, 0);
  const innerH = h - ti - bi;
  let top = s.vAnchor === 'ctr' ? y + bi + (innerH + total) / 2 : s.vAnchor === 'b' ? y + bi + total : y + h - ti;
  o.push(pushGraphicsState());
  if (s.rot) { o.push(concatTransformationMatrix(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), cx, cy), concatTransformationMatrix(1, 0, 0, 1, -cx, -cy)); }
  o.push(rectangle(x, y, w, h), clip(), endPath());
  for (const l of lines) {
    const base = top - l.asc - (l.h - l.asc) * 0.25;
    const lw = l.parts.reduce((t, p) => t + te.measure(p.text, p.style, p.size), 0) - (l.parts.length ? te.measure(l.parts[l.parts.length - 1].text, l.parts[l.parts.length - 1].style, l.parts[l.parts.length - 1].size) - te.measure(l.parts[l.parts.length - 1].text.trimEnd(), l.parts[l.parts.length - 1].style, l.parts[l.parts.length - 1].size) : 0);
    let px = l.align === 'ctr' ? x + li + (avail - lw) / 2 : l.align === 'r' ? x + w - ri - lw : x + li;
    for (const p of l.parts) {
      const sh = te.shape(p.text, p.style, p.size);
      o.push(...te.ops(sh, px, base, { color: hex(p.color), key }));
      if (p.u) o.push(setStrokingRgbColor(...hex(p.color)), setLineWidth(p.size * 0.05), moveTo(px, base - p.size * 0.12), lineTo(px + sh.width, base - p.size * 0.12), stroke());
      px += sh.width;
    }
    top -= l.h;
  }
  o.push(popGraphicsState());
  return o;
}

export { wrapLines };
