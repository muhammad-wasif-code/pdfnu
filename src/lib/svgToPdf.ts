/**
 * SVG → PDF as vector graphics (browser only: uses the live DOM for computed styles and transforms).
 * Paths, basic shapes, strokes, dashes, opacity, linear/radial gradients (as PDF shadings),
 * text (real text, any language), embedded images and <use> are converted. Drawings that rely on
 * filters, masks, clip paths or patterns are drawn as a high-resolution picture instead.
 */
import {
  PDFDocument, PDFName, PDFOperator, PDFOperatorNames, pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  setFillingRgbColor, setStrokingRgbColor, setLineWidth, setDashPattern, setLineCap, setLineJoin, LineCapStyle, LineJoinStyle,
  fill, stroke, clip, endPath, rectangle, drawObject, setGraphicsState, type PDFImage, type PDFPage,
} from 'pdf-lib';
// not re-exported by the package entry; the ES build shares classes with it
import { svgPathToOperators } from 'pdf-lib/es/api/svgPath';
import { TextEngine, familyFor, pageKeyer, type TextStyle } from './textEngine';

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const fromDOM = (m: DOMMatrix | SVGMatrix): M => [m.a, m.b, m.c, m.d, m.e, m.f];
const inv = (m: M): M => { const [a, b, c, d, e, f] = m; const det = a * d - b * c || 1; return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]; };

function color(s: string | null): [number, number, number, number] | null {
  if (!s || s === 'none' || s === 'transparent') return null;
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(s);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  return [+m[1] / 255, +m[2] / 255, +m[3] / 255, a];
}

/** d attribute for basic shapes. */
function shapePath(el: SVGElement): string | null {
  const n = (a: string) => parseFloat(el.getAttribute(a) ?? '0') || 0;
  switch (el.localName) {
    case 'path': return el.getAttribute('d');
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      if (w <= 0 || h <= 0) return null;
      let rx = el.hasAttribute('rx') ? n('rx') : n('ry'), ry = el.hasAttribute('ry') ? n('ry') : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!rx && !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle': case 'ellipse': {
      const cx = n('cx'), cy = n('cy'), rx = el.localName === 'circle' ? n('r') : n('rx'), ry = el.localName === 'circle' ? n('r') : n('ry');
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'line': return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    case 'polyline': case 'polygon': {
      const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number).filter((v) => !isNaN(v));
      if (pts.length < 4) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return el.localName === 'polygon' ? d + 'Z' : d;
    }
  }
  return null;
}

const UNSUPPORTED = 'filter, mask, clipPath, pattern, foreignObject, feGaussianBlur';

export interface SvgPdfOpts { page: 'svg' | 'a4' | 'letter'; margin: number; }
export interface SvgPdfResult { pdf: Uint8Array; pages: number; rasterised: number; }

/** Size of an SVG in CSS px from width/height or the viewBox. */
function svgSize(svg: SVGSVGElement): [number, number] {
  const vb = svg.viewBox?.baseVal;
  const len = (a: string) => { const v = svg.getAttribute(a); if (!v || /%$/.test(v)) return 0; const n = parseFloat(v); const u = /[a-z]+$/i.exec(v.trim())?.[0] ?? 'px'; return n * ({ px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16 } as Record<string, number>)[u] || n; };
  let w = len('width'), h = len('height');
  if (vb && vb.width && vb.height) { if (!w && !h) { w = vb.width; h = vb.height; } else if (!w) w = (h * vb.width) / vb.height; else if (!h) h = (w * vb.height) / vb.width; }
  return [w || 300, h || 150];
}

export async function svgToPdf(files: { name: string; text: string }[], o: SvgPdfOpts): Promise<SvgPdfResult> {
  const doc = await PDFDocument.create();
  const te = await TextEngine.create(doc);
  let rasterised = 0;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;opacity:0;pointer-events:none';
  document.body.appendChild(host);
  try {
    for (const f of files) {
      const parsed = new DOMParser().parseFromString(f.text, 'image/svg+xml');
      const src = parsed.documentElement;
      if (src.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('NOT_SVG');
      // never run anything from the file
      src.querySelectorAll('script').forEach((s) => s.remove());
      for (const el of Array.from(src.querySelectorAll('*'))) for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      const svg = document.importNode(src, true) as unknown as SVGSVGElement;
      host.replaceChildren(svg);
      const [wPx, hPx] = svgSize(svg);
      svg.setAttribute('width', String(wPx)); svg.setAttribute('height', String(hPx));
      // <use> → inline copies, so every shape is a real element with a transform
      for (let pass = 0; pass < 5; pass++) {
        const uses = Array.from(svg.querySelectorAll('use'));
        if (!uses.length) break;
        for (const u of uses) {
          const id = (u.getAttribute('href') ?? u.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '').replace(/^#/, '');
          const target = id ? svg.querySelector(`#${CSS.escape(id)}`) : null;
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          for (const a of Array.from(u.attributes)) if (!/^(href|xlink:href|x|y|width|height)$/.test(a.name)) g.setAttribute(a.name, a.value);
          const x = parseFloat(u.getAttribute('x') ?? '0') || 0, y = parseFloat(u.getAttribute('y') ?? '0') || 0;
          g.setAttribute('transform', `${u.getAttribute('transform') ?? ''} translate(${x} ${y})`);
          if (target) { const c = target.cloneNode(true) as Element; c.removeAttribute('id'); if (c.localName === 'symbol') { const inner = document.createElementNS('http://www.w3.org/2000/svg', 'g'); inner.append(...Array.from(c.childNodes)); g.appendChild(inner); } else g.appendChild(c); }
          u.replaceWith(g);
        }
      }
      const tricky = svg.querySelector(UNSUPPORTED) || Array.from(svg.querySelectorAll('[filter],[mask],[clip-path]')).length > 0;
      const k = 0.75; // CSS px → pt
      const W = wPx * k, H = hPx * k;
      let pageW = W, pageH = H, s = 1, ox = 0, oy = 0;
      if (o.page !== 'svg') {
        const [pw, ph] = o.page === 'a4' ? [595.28, 841.89] : [612, 792];
        [pageW, pageH] = W > H ? [ph, pw] : [pw, ph];
        s = Math.min((pageW - 2 * o.margin) / W, (pageH - 2 * o.margin) / H);
        ox = (pageW - W * s) / 2; oy = (pageH - H * s) / 2;
      }
      const page = doc.addPage([pageW, pageH]);
      // SVG px (y down) → PDF pt (y up)
      const toPage: M = [k * s, 0, 0, -k * s, ox, oy + H * s];
      if (tricky) { await rasterise(doc, page, svg, wPx, hPx, toPage); rasterised++; continue; }
      await vector(doc, page, svg, toPage, te);
    }
    doc.setProducer('PDFSherpa');
    return { pdf: await doc.save({ useObjectStreams: true }), pages: doc.getPageCount(), rasterised };
  } finally { host.remove(); }
}

async function rasterise(doc: PDFDocument, page: PDFPage, svg: SVGSVGElement, w: number, h: number, toPage: M) {
  const scale = Math.min(6, 5000 / Math.max(w, h));
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  c.width = c.height = 0;
  if (!blob) return;
  const im = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
  const m = mul(toPage, [w, 0, 0, -h, 0, h]);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(page.node.newXObject('Svg', im.ref)), popGraphicsState());
}

async function vector(doc: PDFDocument, page: PDFPage, svg: SVGSVGElement, toPage: M, te: TextEngine) {
  const ops: PDFOperator[] = [];
  const key = pageKeyer(page);
  const rootInv = inv(fromDOM(svg.getScreenCTM()!));
  const ctmOf = (el: SVGGraphicsElement): M => mul(rootInv, fromDOM(el.getScreenCTM()!));
  const gsCache = new Map<string, PDFName>();
  const gs = (ca: number, CA: number) => { const k = `${ca.toFixed(3)}|${CA.toFixed(3)}`; let n = gsCache.get(k); if (!n) { n = page.node.newExtGState('GS', doc.context.obj({ ca, CA })); gsCache.set(k, n); } return n; };
  const patterns = new Map<string, PDFName>();
  const imgCache = new Map<string, PDFImage | null>();

  // text first pass: collect strings for font loading
  const texts: { text: string; style: TextStyle }[] = [];
  const styleOf = (cs: CSSStyleDeclaration): TextStyle => ({ family: familyFor(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() || 'sans-serif'), bold: parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === 'bold', italic: cs.fontStyle === 'italic' });
  for (const t of Array.from(svg.querySelectorAll('text'))) for (const w of (t.textContent ?? '').split(/\s+/).filter(Boolean)) texts.push({ text: w, style: styleOf(getComputedStyle(t)) });
  if (texts.length) await te.prepare(texts);

  /** Fill paint: solid colour or a gradient pattern. */
  const paint = (val: string, el: SVGGraphicsElement, bbox: DOMRect | null, stroking: boolean): PDFOperator[] | 'none' | null => {
    const url = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(val);
    if (url) {
      const g = svg.querySelector(`#${CSS.escape(url[1])}`);
      if (!g || !/Gradient$/.test(g.localName)) return null;
      const name = gradient(g as SVGGradientElement, el, bbox);
      if (!name) return null;
      return [PDFOperator.of(stroking ? PDFOperatorNames.StrokingColorspace : PDFOperatorNames.NonStrokingColorspace, [PDFName.of('Pattern')]),
        PDFOperator.of(stroking ? PDFOperatorNames.StrokingColorN : PDFOperatorNames.NonStrokingColorN, [name])];
    }
    const c = color(val);
    if (!c) return 'none';
    return [stroking ? setStrokingRgbColor(c[0], c[1], c[2]) : setFillingRgbColor(c[0], c[1], c[2])];
  };

  const gradient = (g: SVGGradientElement, el: SVGGraphicsElement, bbox: DOMRect | null): PDFName | null => {
    // follow href for stops / attributes
    const chain: Element[] = [g];
    for (let cur: Element | null = g, i = 0; cur && i < 5; i++) { const h: string = (cur.getAttribute('href') ?? cur.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '').replace(/^#/, ''); cur = h ? svg.querySelector(`#${CSS.escape(h)}`) : null; if (cur) chain.push(cur); }
    const at = (a: string) => chain.find((c) => c.hasAttribute(a))?.getAttribute(a) ?? null;
    const stopsEl = chain.find((c) => c.querySelector('stop'));
    const stops = Array.from(stopsEl?.querySelectorAll('stop') ?? []).map((st) => {
      const cs = getComputedStyle(st);
      const off = st.getAttribute('offset') ?? '0';
      return { t: Math.min(1, Math.max(0, off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off) || 0)), c: color(cs.stopColor) ?? [0, 0, 0, 1] };
    });
    if (!stops.length) return null;
    for (let i = 1; i < stops.length; i++) stops[i].t = Math.max(stops[i].t, stops[i - 1].t);
    const units = at('gradientUnits') ?? 'objectBoundingBox';
    const num = (a: string, d: number) => { const v = at(a); if (v === null) return d; return v.endsWith('%') ? parseFloat(v) / 100 * (units === 'userSpaceOnUse' ? 1 : 1) : parseFloat(v); };
    let gm: M = [1, 0, 0, 1, 0, 0];
    if (units !== 'userSpaceOnUse' && bbox) gm = [bbox.width, 0, 0, bbox.height, bbox.x, bbox.y];
    const gt = at('gradientTransform');
    if (gt) { const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g'); tmp.setAttribute('transform', gt); svg.appendChild(tmp); const m = tmp.transform.baseVal.consolidate()?.matrix; tmp.remove(); if (m) gm = mul(gm, fromDOM(m)); }
    const full = mul(toPage, mul(ctmOf(el), gm));
    const fn = (a: [number, number, number, number], b: [number, number, number, number]) => ({ FunctionType: 2, Domain: [0, 1], C0: [a[0], a[1], a[2]], C1: [b[0], b[1], b[2]], N: 1 });
    const funcs = stops.length === 1 ? [fn(stops[0].c, stops[0].c)] : stops.slice(1).map((s2, i) => fn(stops[i].c, s2.c));
    const func = funcs.length === 1 ? funcs[0] : { FunctionType: 3, Domain: [0, 1], Functions: funcs, Bounds: stops.slice(1, -1).map((s2) => s2.t), Encode: funcs.flatMap(() => [0, 1]) };
    // stops not covering 0..1 are extended by the Extend flags
    const t0 = stops[0].t, t1 = stops[stops.length - 1].t;
    let shading;
    if (g.localName === 'linearGradient') {
      const x1 = num('x1', 0), y1 = num('y1', 0), x2 = num('x2', 1), y2 = num('y2', 0);
      shading = { ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0, x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1], Function: func, Extend: [true, true] };
    } else {
      const cx = num('cx', 0.5), cy = num('cy', 0.5), r = num('r', 0.5), fx = num('fx', cx), fy = num('fy', cy);
      shading = { ShadingType: 3, ColorSpace: 'DeviceRGB', Coords: [fx, fy, r * t0, cx, cy, r * t1], Function: func, Extend: [true, true] };
    }
    if (funcs.length > 1 && (t0 > 0 || t1 < 1)) (func as any).Bounds = stops.slice(1, -1).map((s2) => (s2.t - t0) / Math.max(1e-6, t1 - t0));
    const k = `${g.id}|${full.map((v) => v.toFixed(3)).join(',')}`;
    let name = patterns.get(k);
    if (!name) {
      const pat = doc.context.register(doc.context.obj({ PatternType: 2, Shading: shading as any, Matrix: full }));
      name = addPattern(page, pat);
      patterns.set(k, name!);
    }
    return name!;
  };

  const walk = (el: Element, opacity: number) => {
    if (!(el instanceof SVGElement)) return;
    const tag = el.localName;
    if (['defs', 'symbol', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'marker', 'title', 'desc', 'metadata', 'style', 'script'].includes(tag)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const op = opacity * (parseFloat(cs.opacity) || (cs.opacity === '0' ? 0 : 1));
    if (op <= 0.003) return;
    if (tag === 'svg' || tag === 'g' || tag === 'a' || tag === 'switch') { for (const c of Array.from(el.children)) walk(c, op); return; }
    if (cs.visibility === 'hidden') return;
    const g = el as unknown as SVGGraphicsElement;
    const m = mul(toPage, ctmOf(g));
    if (tag === 'text') { drawText(g as SVGTextElement, cs, m, op); return; }
    if (tag === 'image') { images.push({ el: g as SVGImageElement, m, op }); return; }
    const d = shapePath(el);
    if (!d) return;
    let bbox: DOMRect | null = null;
    try { bbox = g.getBBox(); } catch { bbox = null; }
    const fillP = paint(cs.fill, g, bbox, false), strokeP = paint(cs.stroke, g, bbox, true);
    const doFill = fillP && fillP !== 'none' && tag !== 'line' && tag !== 'polyline' ? true : fillP && fillP !== 'none' && tag === 'polyline';
    const sw = parseFloat(cs.strokeWidth) || 0;
    const doStroke = !!strokeP && strokeP !== 'none' && sw > 0;
    if (!doFill && !doStroke) return;
    const fa = (parseFloat(cs.fillOpacity) || (cs.fillOpacity === '0' ? 0 : 1)) * (color(cs.fill)?.[3] ?? 1) * op;
    const sa = (parseFloat(cs.strokeOpacity) || (cs.strokeOpacity === '0' ? 0 : 1)) * (color(cs.stroke)?.[3] ?? 1) * op;
    ops.push(pushGraphicsState(), concatTransformationMatrix(...m));
    if (fa < 1 || sa < 1) ops.push(setGraphicsState(gs(doFill ? fa : 1, doStroke ? sa : 1)));
    if (doFill) ops.push(...(fillP as PDFOperator[]));
    if (doStroke) {
      ops.push(...(strokeP as PDFOperator[]), setLineWidth(sw));
      ops.push(setLineCap(cs.strokeLinecap === 'round' ? LineCapStyle.Round : cs.strokeLinecap === 'square' ? LineCapStyle.Projecting : LineCapStyle.Butt));
      ops.push(setLineJoin(cs.strokeLinejoin === 'round' ? LineJoinStyle.Round : cs.strokeLinejoin === 'bevel' ? LineJoinStyle.Bevel : LineJoinStyle.Miter));
      const dash = cs.strokeDasharray && cs.strokeDasharray !== 'none' ? cs.strokeDasharray.split(/[\s,]+/).map(parseFloat).filter((v) => !isNaN(v)) : [];
      if (dash.length) ops.push(setDashPattern(dash.length % 2 ? [...dash, ...dash] : dash, parseFloat(cs.strokeDashoffset) || 0));
    }
    ops.push(...svgPathToOperators(d));
    const evenOdd = cs.fillRule === 'evenodd';
    if (doFill && doStroke) ops.push(PDFOperator.of(evenOdd ? PDFOperatorNames.FillEvenOddAndStroke : PDFOperatorNames.FillNonZeroAndStroke));
    else if (doFill) ops.push(evenOdd ? PDFOperator.of(PDFOperatorNames.FillEvenOdd) : fill());
    else ops.push(stroke());
    ops.push(popGraphicsState());
  };

  const drawText = (t: SVGTextElement, cs: CSSStyleDeclaration, m: M, op: number) => {
    const c = color(cs.fill);
    if (!c) return;
    const size = parseFloat(cs.fontSize) || 16;
    const style = styleOf(cs);
    const content = t.textContent ?? '';
    let n = 0;
    try { n = t.getNumberOfChars(); } catch { return; }
    // place each word where the browser put its first character (indexes count the whitespace-collapsed text)
    const rendered = content.replace(/\s+/g, ' ').trim();
    const re = /\S+/g;
    let mm: RegExpExecArray | null;
    ops.push(pushGraphicsState(), concatTransformationMatrix(...m));
    if (c[3] * op < 1) ops.push(setGraphicsState(gs(c[3] * op, 1)));
    while ((mm = re.exec(rendered))) {
      const start = mm.index;
      if (start >= n) break;
      let p: DOMPoint;
      try { p = t.getStartPositionOfChar(start); } catch { continue; }
      let rot = 0;
      try { rot = t.getRotationOfChar(start); } catch { rot = 0; }
      const sh = te.shape(mm[0], style, size);
      // the text matrix is y-down here: flip each glyph run back upright
      ops.push(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, p.x, p.y), ...(rot ? [concatTransformationMatrix(Math.cos((-rot * Math.PI) / 180), Math.sin((-rot * Math.PI) / 180), -Math.sin((-rot * Math.PI) / 180), Math.cos((-rot * Math.PI) / 180), 0, 0)] : []),
        ...te.ops(sh, 0, 0, { color: [c[0], c[1], c[2]], key }), popGraphicsState());
    }
    ops.push(popGraphicsState());
  };

  const images: { el: SVGImageElement; m: M; op: number }[] = [];
  walk(svg, 1);
  // embed images after walking (async)
  for (const im of images) {
    const href = im.el.getAttribute('href') ?? im.el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
    if (!href) continue;
    let pdfImg = imgCache.get(href);
    if (pdfImg === undefined) {
      pdfImg = null;
      try {
        const el = new Image(); el.src = href; await el.decode();
        const cv = document.createElement('canvas'); cv.width = el.naturalWidth; cv.height = el.naturalHeight;
        cv.getContext('2d')!.drawImage(el, 0, 0);
        const b = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
        if (b) pdfImg = await doc.embedPng(new Uint8Array(await b.arrayBuffer()));
      } catch { pdfImg = null; }
      imgCache.set(href, pdfImg);
    }
    if (!pdfImg) continue;
    const x = im.el.x.baseVal.value, y = im.el.y.baseVal.value, w = im.el.width.baseVal.value || pdfImg.width, h = im.el.height.baseVal.value || pdfImg.height;
    // preserveAspectRatio default: xMidYMid meet
    const par = im.el.getAttribute('preserveAspectRatio') ?? '';
    let dw = w, dh = h, dx = x, dy = y;
    if (!/none/.test(par)) { const s = Math.min(w / pdfImg.width, h / pdfImg.height); dw = pdfImg.width * s; dh = pdfImg.height * s; dx = x + (w - dw) / 2; dy = y + (h - dh) / 2; }
    ops.push(pushGraphicsState(), concatTransformationMatrix(...im.m), ...(im.op < 1 ? [setGraphicsState(gs(im.op, im.op))] : []), concatTransformationMatrix(dw, 0, 0, -dh, dx, dy + dh), drawObject(key.image(pdfImg)), popGraphicsState());
  }
  // clip to the page box of the drawing
  page.pushOperators(pushGraphicsState(), ...rectClip(page), ...ops, popGraphicsState());
}

function rectClip(page: PDFPage): PDFOperator[] { const { width, height } = page.getSize(); return [rectangle(0, 0, width, height), clip(), endPath()]; }
function addPattern(page: PDFPage, ref: any): PDFName {
  const res = page.node.Resources()!;
  let pat = res.lookup(PDFName.of('Pattern')) as any;
  if (!pat) { pat = page.doc.context.obj({}); res.set(PDFName.of('Pattern'), pat); }
  let i = 1; while (pat.has(PDFName.of(`P${i}`))) i++;
  const name = PDFName.of(`P${i}`);
  pat.set(name, ref);
  return name;
}
