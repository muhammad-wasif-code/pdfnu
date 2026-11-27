/**
 * HTML → PDF in the browser, with real (selectable, searchable) text and working links.
 * The page is laid out by the browser itself in a sandboxed iframe (no scripts run), then the
 * rendered boxes are painted into a PDF: backgrounds, borders (incl. rounded corners), images,
 * SVG/canvas, list markers and every word at the exact position the browser placed it.
 * Pages break between lines, never through a line of text or a picture.
 */
import {
  PDFDocument, PDFName, PDFString, rectangle, fill, stroke, clip, endPath, moveTo, lineTo, appendBezierCurve, closePath,
  setFillingRgbColor, setStrokingRgbColor, setLineWidth, setDashPattern, pushGraphicsState, popGraphicsState,
  concatTransformationMatrix, drawObject, setGraphicsState, type PDFImage, type PDFOperator,
} from 'pdf-lib';
import { TextEngine, familyFor, pageKeyer, type TextStyle } from './textEngine';

export type HtmlPage = 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
export interface HtmlOptions {
  page: HtmlPage; landscape: boolean;
  /** margin in points */ margin: number;
  /** layout width in CSS px; null = the printable width of the page (1 CSS px = 0.75 pt) */
  viewport: number | null;
  backgrounds: boolean;
  title?: string;
  onProgress?: (stage: string, done?: number, total?: number) => void;
}
export interface HtmlResult { pdf: Uint8Array; pages: number; skippedImages: number; missingGlyphs: number; links: number; }

const SIZES: Record<HtmlPage, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28] };

type RGBA = [number, number, number, number];
function parseColor(s: string): RGBA | null {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(s);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  if (a <= 0.01) return null;
  return [+m[1] / 255, +m[2] / 255, +m[3] / 255, a];
}

interface Box { x: number; y: number; w: number; h: number; }
type Item =
  | { t: 'rect'; b: Box; c: RGBA; r: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; c: RGBA; dash: number[] }
  | { t: 'rborder'; b: Box; r: number; w: number; c: RGBA }
  | { t: 'img'; b: Box; key: string; clip?: Box }
  | { t: 'text'; x: number; top: number; h: number; text: string; style: TextStyle; size: number; c: RGBA; u: boolean; strike: boolean; rtl: boolean };

/** Rewrite relative references (images, stylesheets, fonts) to the files the user added. */
function wireAssets(html: string, assets: Map<string, Blob>, urls: string[]): string {
  if (!assets.size) return html;
  const byName = new Map<string, string>();
  for (const [name, blob] of assets) {
    const u = URL.createObjectURL(blob); urls.push(u);
    const n = name.replace(/\\/g, '/').toLowerCase();
    byName.set(n, u); byName.set(n.split('/').pop()!, u);
  }
  const look = (ref: string) => {
    if (!ref || /^(data|blob|https?|mailto|tel|#|javascript):?/i.test(ref)) return null;
    const clean = decodeURIComponent(ref.split(/[?#]/)[0]).replace(/^\.?\//, '').replace(/\\/g, '/').toLowerCase();
    return byName.get(clean) ?? byName.get(clean.split('/').pop()!) ?? null;
  };
  const css = (text: string) => text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => { const u = look(ref); return u ? `url(${q}${u}${q})` : m; });
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll<HTMLElement>('[src]').forEach((el) => { const u = look(el.getAttribute('src')!); if (u) el.setAttribute('src', u); });
  d.querySelectorAll<HTMLElement>('[srcset]').forEach((el) => el.setAttribute('srcset', el.getAttribute('srcset')!.split(',').map((p) => { const [ref, ...rest] = p.trim().split(/\s+/); const u = look(ref); return [u ?? ref, ...rest].join(' '); }).join(', ')));
  d.querySelectorAll<HTMLElement>('[style]').forEach((el) => el.setAttribute('style', css(el.getAttribute('style')!)));
  d.querySelectorAll('style').forEach((el) => { el.textContent = css(el.textContent ?? ''); });
  return '<!doctype html>' + d.documentElement.outerHTML;
}

/** Stylesheets added as separate files are inlined, so relative url()s inside them resolve too. */
async function inlineStyles(html: string, assets: Map<string, Blob>): Promise<string> {
  const d = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  for (const link of Array.from(d.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const ref = decodeURIComponent(link.getAttribute('href')!.split(/[?#]/)[0]).replace(/^\.?\//, '').toLowerCase();
    const hit = [...assets.entries()].find(([n]) => { const k = n.toLowerCase().replace(/\\/g, '/'); return k === ref || k.split('/').pop() === ref.split('/').pop(); });
    if (!hit) continue;
    const style = d.createElement('style');
    style.textContent = await hit[1].text();
    link.replaceWith(style);
    changed = true;
  }
  // scripts never run (sandbox), so drop them and anything they would have hidden behind "noscript"
  d.querySelectorAll('script').forEach((s) => { s.remove(); changed = true; });
  d.querySelectorAll('noscript').forEach((n) => { const frag = d.createElement('div'); frag.innerHTML = n.textContent ?? ''; n.replaceWith(...Array.from(frag.childNodes)); changed = true; });
  return changed ? '<!doctype html>' + d.documentElement.outerHTML : html;
}

async function loadFrame(html: string, widthPx: number): Promise<HTMLIFrameElement> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${widthPx}px;height:800px;border:0;visibility:hidden;pointer-events:none`;
  const loaded = new Promise<void>((r) => { frame.onload = () => r(); });
  frame.srcdoc = html;
  document.body.appendChild(frame);
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 15000))]);
  const d = frame.contentDocument!;
  try { await (d as any).fonts?.ready; } catch { /* ignore */ }
  await Promise.all(Array.from(d.images).map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = () => r(null); setTimeout(r, 8000); }))));
  // let the frame grow to the full document height so nothing lazy stays hidden
  frame.style.height = `${Math.max(800, d.documentElement.scrollHeight)}px`;
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  return frame;
}

const MARKERS: Record<string, (n: number) => string> = {
  disc: () => '•', circle: () => '◦', square: () => '▪',
  decimal: (n) => `${n}.`, 'decimal-leading-zero': (n) => `${String(n).padStart(2, '0')}.`,
  'lower-alpha': (n) => `${alpha(n)}.`, 'lower-latin': (n) => `${alpha(n)}.`, 'upper-alpha': (n) => `${alpha(n).toUpperCase()}.`, 'upper-latin': (n) => `${alpha(n).toUpperCase()}.`,
  'lower-roman': (n) => `${roman(n)}.`, 'upper-roman': (n) => `${roman(n).toUpperCase()}.`,
};
function alpha(n: number) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
function roman(n: number) { const R: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of R) while (n >= v) { s += r; n -= v; } return s; }

interface Collected { items: Item[]; images: Map<string, { el: Element; kind: 'img' | 'svg' | 'canvas' }>; links: { b: Box; href: string }[]; breaks: number[]; height: number; }

/** Walk the laid-out document and record what to paint, in document CSS px. */
function collect(d: Document, o: HtmlOptions): Collected {
  const win = d.defaultView!;
  const items: Item[] = [];
  const images = new Map<string, { el: Element; kind: 'img' | 'svg' | 'canvas' }>();
  const links: { b: Box; href: string }[] = [];
  const breaks: number[] = [];
  const range = d.createRange();
  const sy = win.scrollY, sx = win.scrollX;
  const box = (r: DOMRect): Box => ({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height });
  let imgSeq = 0;
  const pendingMarkers: { li: Element; text: string; style: TextStyle; size: number; c: RGBA; box: Box; inside: boolean }[] = [];

  const page = (el: Element, cs: CSSStyleDeclaration, op: number) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return;
    const b = box(r);
    if (/page|always|left|right/.test(cs.breakBefore + cs.getPropertyValue('page-break-before'))) breaks.push(b.y);
    if (/page|always|left|right/.test(cs.breakAfter + cs.getPropertyValue('page-break-after'))) breaks.push(b.y + b.h);
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    if (o.backgrounds || el === d.body || el === d.documentElement) {
      const bg = parseColor(cs.backgroundColor);
      if (bg) items.push({ t: 'rect', b, c: [bg[0], bg[1], bg[2], bg[3] * op], r: Math.min(radius, b.w / 2, b.h / 2) });
    }
    const side = (s: 'Top' | 'Right' | 'Bottom' | 'Left') => {
      const w = parseFloat((cs as any)[`border${s}Width`]) || 0, style = (cs as any)[`border${s}Style`], c = parseColor((cs as any)[`border${s}Color`]);
      return w > 0 && c && style !== 'none' && style !== 'hidden' ? { w, c: [c[0], c[1], c[2], c[3] * op] as RGBA, dash: style === 'dashed' ? [w * 3, w * 2] : style === 'dotted' ? [w, w * 1.5] : [] } : null;
    };
    const [t, rt, bt, l] = (['Top', 'Right', 'Bottom', 'Left'] as const).map(side);
    if (radius > 0 && t && rt && bt && l && t.w === l.w && t.c.join() === l.c.join() && !t.dash.length) {
      items.push({ t: 'rborder', b, r: Math.min(radius, b.w / 2, b.h / 2), w: t.w, c: t.c });
    } else {
      if (t) items.push({ t: 'line', x1: b.x, y1: b.y + t.w / 2, x2: b.x + b.w, y2: b.y + t.w / 2, w: t.w, c: t.c, dash: t.dash });
      if (bt) items.push({ t: 'line', x1: b.x, y1: b.y + b.h - bt.w / 2, x2: b.x + b.w, y2: b.y + b.h - bt.w / 2, w: bt.w, c: bt.c, dash: bt.dash });
      if (l) items.push({ t: 'line', x1: b.x + l.w / 2, y1: b.y, x2: b.x + l.w / 2, y2: b.y + b.h, w: l.w, c: l.c, dash: l.dash });
      if (rt) items.push({ t: 'line', x1: b.x + b.w - rt.w / 2, y1: b.y, x2: b.x + b.w - rt.w / 2, y2: b.y + b.h, w: rt.w, c: rt.c, dash: rt.dash });
    }
    const tag = el.localName;
    if (tag === 'img' || tag === 'svg' || tag === 'canvas') {
      const key = `i${imgSeq++}`;
      images.set(key, { el, kind: tag === 'img' ? 'img' : tag === 'svg' ? 'svg' : 'canvas' });
      // the content box (inside padding and borders), with object-fit handled at raster time
      const pl = parseFloat(cs.paddingLeft) + (l?.w ?? 0), pt = parseFloat(cs.paddingTop) + (t?.w ?? 0);
      const pr = parseFloat(cs.paddingRight) + (rt?.w ?? 0), pb = parseFloat(cs.paddingBottom) + (bt?.w ?? 0);
      items.push({ t: 'img', b: { x: b.x + pl, y: b.y + pt, w: b.w - pl - pr, h: b.h - pt - pb, }, key });
    }
    if (tag === 'a') {
      const href = (el as HTMLAnchorElement).getAttribute('href') ?? '';
      if (/^(https?:|mailto:|tel:)/i.test(href)) for (const rr of Array.from(el.getClientRects())) if (rr.width > 0) links.push({ b: box(rr), href });
    }
    if (cs.display === 'list-item' && cs.listStyleType !== 'none') {
      const parent = el.parentElement;
      let n = 1;
      if (parent) {
        const start = parent.localName === 'ol' ? parseInt(parent.getAttribute('start') ?? '1', 10) || 1 : 1;
        const sibs = Array.from(parent.children).filter((c) => win.getComputedStyle(c).display === 'list-item');
        const v = (el as HTMLLIElement).value;
        n = v > 0 && el.hasAttribute('value') ? v : start + sibs.indexOf(el);
      }
      const fmt = MARKERS[cs.listStyleType] ?? MARKERS.disc;
      const c = parseColor(cs.color) ?? [0, 0, 0, 1];
      pendingMarkers.push({ li: el, text: fmt(n), style: styleFor(cs), size: parseFloat(cs.fontSize), c: [c[0], c[1], c[2], c[3] * op], box: b, inside: cs.listStylePosition === 'inside' });
    }
  };

  const styleFor = (cs: CSSStyleDeclaration): TextStyle => ({ family: familyFor(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() || 'sans-serif'), bold: parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === 'bold', italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique' });

  const text = (node: Text, cs: CSSStyleDeclaration, op: number) => {
    const data = node.data;
    if (!data.trim()) return;
    const c = parseColor(cs.color);
    if (!c) return;
    const transform = (s: string) => (cs.textTransform === 'uppercase' ? s.toUpperCase() : cs.textTransform === 'lowercase' ? s.toLowerCase() : cs.textTransform === 'capitalize' ? s.replace(/(^|\s)(\S)/g, (_m, a, b) => a + b.toUpperCase()) : s);
    const style = styleFor(cs);
    const size = parseFloat(cs.fontSize) || 16;
    const deco = cs.textDecorationLine || cs.textDecoration;
    const u = /underline/.test(deco), strike = /line-through/.test(deco);
    const rtl = cs.direction === 'rtl';
    const color: RGBA = [c[0], c[1], c[2], c[3] * op];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(data))) {
      const s = m.index, e = s + m[0].length;
      range.setStart(node, s); range.setEnd(node, e);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      if (rects.length === 1) { const b = box(rects[0]); items.push({ t: 'text', x: b.x, top: b.y, h: b.h, text: transform(m[0]), style, size, c: color, u, strike, rtl }); continue; }
      // a word broken across lines (hyphenation, break-all): place it character by character
      for (let i = s; i < e; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (!r || r.width <= 0) continue;
        const b = box(r);
        items.push({ t: 'text', x: b.x, top: b.y, h: b.h, text: transform(data[i]), style, size, c: color, u, strike, rtl });
      }
    }
  };

  const visit = (el: Element, op: number) => {
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none') return;
    const opacity = op * (parseFloat(cs.opacity) || (cs.opacity === '0' ? 0 : 1));
    if (opacity <= 0.01) return;
    const visible = cs.visibility !== 'hidden' && cs.visibility !== 'collapse';
    if (visible) page(el, cs, opacity);
    const tag = el.localName;
    if (tag === 'svg' || tag === 'canvas' || tag === 'img' || tag === 'iframe' || tag === 'video' || tag === 'audio' || tag === 'select' || tag === 'head' || tag === 'style' || tag === 'template') return;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) { if (visible) text(child as Text, cs, opacity); }
      else if (child.nodeType === 1) visit(child as Element, opacity);
    }
  };
  visit(d.documentElement, 1);

  // list markers: next to the first line of each item
  for (const mk of pendingMarkers) {
    const first = items.find((it) => it.t === 'text' && it.top >= mk.box.y - 1 && it.top < mk.box.y + mk.box.h && it.x >= mk.box.x - 2) as Extract<Item, { t: 'text' }> | undefined;
    const top = first ? first.top : mk.box.y, h = first ? first.h : mk.size * 1.2;
    const w = mk.text.length * mk.size * (mk.text.length === 1 ? 0.5 : 0.55);
    const x = mk.inside ? mk.box.x : mk.box.x - w - mk.size * 0.45;
    items.push({ t: 'text', x, top, h, text: mk.text, style: mk.style, size: mk.size, c: mk.c, u: false, strike: false, rtl: false });
  }
  const height = Math.max(d.documentElement.scrollHeight, d.body?.scrollHeight ?? 0);
  return { items, images, links, breaks, height };
}

/** Rasterise an image element to PNG/JPEG bytes (original bytes when possible). */
async function rasterise(el: Element, kind: 'img' | 'svg' | 'canvas', w: number, h: number): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' } | null> {
  try {
    if (kind === 'img') {
      const img = el as HTMLImageElement;
      const src = img.currentSrc || img.src;
      if (!src || !img.naturalWidth) return null;
      const fit = getComputedStyle(img).objectFit;
      if ((fit === 'fill' || !fit) && /^(blob|data):/.test(src)) {
        const blob = await (await fetch(src)).blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, type: 'jpg' };
        if (bytes[0] === 0x89 && bytes[1] === 0x50) return { bytes, type: 'png' };
      }
      // other formats, object-fit, or cross-origin: draw through a canvas
      const scale = Math.min(3, Math.max(1, 1600 / Math.max(w, h)));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
      const ctx = c.getContext('2d')!;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      let dx = 0, dy = 0, dw = c.width, dh = c.height, sx = 0, sy = 0, sw = iw, sh = ih;
      if (fit === 'contain' || fit === 'scale-down') { const k = Math.min(c.width / iw, c.height / ih); dw = iw * k; dh = ih * k; dx = (c.width - dw) / 2; dy = (c.height - dh) / 2; }
      else if (fit === 'cover') { const k = Math.max(c.width / iw, c.height / ih); sw = c.width / k; sh = c.height / k; sx = (iw - sw) / 2; sy = (ih - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      c.width = c.height = 0;
      return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' } : null;
    }
    if (kind === 'canvas') {
      const blob = await new Promise<Blob | null>((r) => (el as HTMLCanvasElement).toBlob(r, 'image/png'));
      return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' } : null;
    }
    // inline SVG: serialise with computed colours resolved by the browser, draw at 3×
    const svg = el.cloneNode(true) as SVGSVGElement;
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!svg.getAttribute('width')) svg.setAttribute('width', String(w));
    if (!svg.getAttribute('height')) svg.setAttribute('height', String(h));
    const color = getComputedStyle(el).color;
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg).replace(/currentColor/g, color));
    const im = new Image();
    im.src = src;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * 3)); c.height = Math.max(1, Math.round(h * 3));
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    c.width = c.height = 0;
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' } : null;
  } catch { return null; }
}

/** Break positions (CSS px) so no text line or picture is cut, plus forced breaks. */
export function pageBreaks(boxes: { top: number; bottom: number }[], forced: number[], total: number, pageH: number): number[] {
  const out = [0];
  const forcedS = [...new Set(forced.map((f) => Math.round(f)))].filter((f) => f > 1 && f < total - 1).sort((a, b) => a - b);
  let y = 0;
  let guard = 0;
  while (y < total - 1 && guard++ < 5000) {
    let target = y + pageH;
    const f = forcedS.find((v) => v > y + 1 && v < target);
    if (f !== undefined) target = f;
    else if (target < total) {
      // move up past anything that straddles the cut (but not further than 40% of a page)
      for (let pass = 0; pass < 20; pass++) {
        const hit = boxes.filter((b) => b.top < target - 0.5 && b.bottom > target + 0.5 && b.bottom - b.top < pageH * 0.8);
        if (!hit.length) break;
        const t = Math.min(...hit.map((b) => b.top));
        if (t <= y + pageH * 0.4) break;
        target = t;
      }
    }
    if (target >= total) break;
    out.push(target);
    y = target;
  }
  out.push(total);
  return out;
}

export async function htmlToPdf(html: string, assets: Map<string, Blob>, o: HtmlOptions): Promise<HtmlResult> {
  const urls: string[] = [];
  let frame: HTMLIFrameElement | null = null;
  try {
    o.onProgress?.('Laying out the page…');
    const [pw0, ph0] = SIZES[o.page];
    const [PW, PH] = o.landscape ? [ph0, pw0] : [pw0, ph0];
    const contentW = PW - 2 * o.margin, contentH = PH - 2 * o.margin;
    const viewport = Math.round(o.viewport ?? contentW / 0.75);
    const k = contentW / viewport; // pt per CSS px
    const prepared = wireAssets(await inlineStyles(html, assets), assets, urls);
    frame = await loadFrame(prepared, viewport);
    const d = frame.contentDocument!;
    const title = o.title || d.title || '';
    const col = collect(d, o);

    const doc = await PDFDocument.create();
    const te = await TextEngine.create(doc);
    const texts = col.items.filter((i): i is Extract<Item, { t: 'text' }> => i.t === 'text');
    o.onProgress?.('Loading fonts…');
    await te.prepare(texts.map((t) => ({ text: t.text, style: t.style })));

    o.onProgress?.('Adding pictures…');
    const pdfImgs = new Map<string, PDFImage | null>();
    let skippedImages = 0, n = 0;
    for (const it of col.items) {
      if (it.t !== 'img' || pdfImgs.has(it.key)) continue;
      const ref = col.images.get(it.key)!;
      const r = await rasterise(ref.el, ref.kind, it.b.w, it.b.h);
      let im: PDFImage | null = null;
      if (r) { try { im = r.type === 'jpg' ? await doc.embedJpg(r.bytes) : await doc.embedPng(r.bytes); } catch { im = null; } }
      if (!im) skippedImages++;
      pdfImgs.set(it.key, im);
      o.onProgress?.('Adding pictures…', ++n, col.images.size);
    }

    // pagination
    const pageHpx = contentH / k;
    const boxes = col.items.flatMap((i) => (i.t === 'text' ? [{ top: i.top, bottom: i.top + i.h }] : i.t === 'img' ? [{ top: i.b.y, bottom: i.b.y + i.b.h }] : []));
    const cuts = pageBreaks(boxes, col.breaks, col.height, pageHpx);

    const shaped = new Map<Extract<Item, { t: 'text' }>, ReturnType<TextEngine['shape']>>();
    for (const t of texts) shaped.set(t, te.shape(t.text, t.style, t.size * k, t.rtl || undefined));

    let links = 0;
    for (let p = 0; p < cuts.length - 1; p++) {
      const y0 = cuts[p], y1 = cuts[p + 1];
      const page = doc.addPage([PW, PH]);
      const key = pageKeyer(page);
      const gs = new Map<number, PDFName>();
      const alpha = (a: number) => { const r = Math.round(a * 100) / 100; let nm = gs.get(r); if (!nm) { nm = page.node.newExtGState('GS', doc.context.obj({ ca: r, CA: r })); gs.set(r, nm); } return nm; };
      const X = (x: number) => o.margin + x * k;
      const Y = (y: number) => PH - o.margin - (y - y0) * k;
      const ops: PDFOperator[] = [];
      // the page background follows the document background (so dark pages stay dark edge to edge)
      const rootBg = col.items.find((i) => i.t === 'rect' && i.b.w >= viewport - 1 && i.b.y <= 1) as Extract<Item, { t: 'rect' }> | undefined;
      if (rootBg && o.backgrounds) ops.push(setFillingRgbColor(rootBg.c[0], rootBg.c[1], rootBg.c[2]), rectangle(0, 0, PW, PH), fill());
      ops.push(pushGraphicsState(), rectangle(o.margin - 0.5, o.margin - 0.5, contentW + 1, contentH + 1), clip(), endPath());
      const inPage = (top: number, bottom: number) => bottom > y0 && top < y1;
      for (const it of col.items) {
        if (it.t === 'rect') {
          if (!inPage(it.b.y, it.b.y + it.b.h) || it === rootBg) continue;
          ops.push(pushGraphicsState(), ...(it.c[3] < 1 ? [setGraphicsState(alpha(it.c[3]))] : []), setFillingRgbColor(it.c[0], it.c[1], it.c[2]), ...roundRect(X(it.b.x), Y(it.b.y + it.b.h), it.b.w * k, it.b.h * k, it.r * k), fill(), popGraphicsState());
        } else if (it.t === 'line') {
          if (!inPage(Math.min(it.y1, it.y2) - it.w, Math.max(it.y1, it.y2) + it.w)) continue;
          ops.push(pushGraphicsState(), ...(it.c[3] < 1 ? [setGraphicsState(alpha(it.c[3]))] : []), setStrokingRgbColor(it.c[0], it.c[1], it.c[2]), setLineWidth(it.w * k), setDashPattern(it.dash.map((v) => v * k), 0), moveTo(X(it.x1), Y(it.y1)), lineTo(X(it.x2), Y(it.y2)), stroke(), popGraphicsState());
        } else if (it.t === 'rborder') {
          if (!inPage(it.b.y, it.b.y + it.b.h)) continue;
          const hw = it.w / 2;
          ops.push(pushGraphicsState(), ...(it.c[3] < 1 ? [setGraphicsState(alpha(it.c[3]))] : []), setStrokingRgbColor(it.c[0], it.c[1], it.c[2]), setLineWidth(it.w * k), ...roundRect(X(it.b.x + hw), Y(it.b.y + it.b.h - hw), (it.b.w - it.w) * k, (it.b.h - it.w) * k, Math.max(0, it.r - hw) * k), stroke(), popGraphicsState());
        } else if (it.t === 'img') {
          if (!inPage(it.b.y, it.b.y + it.b.h) || it.b.w <= 0 || it.b.h <= 0) continue;
          const im = pdfImgs.get(it.key);
          if (!im) continue;
          ops.push(pushGraphicsState(), concatTransformationMatrix(it.b.w * k, 0, 0, it.b.h * k, X(it.b.x), Y(it.b.y + it.b.h)), drawObject(key.image(im)), popGraphicsState());
        } else {
          if (!inPage(it.top, it.top + it.h)) continue;
          const sh = shaped.get(it)!;
          // centre the font's ascent+descent in the box the browser reported
          const boxH = it.h * k;
          const base = Y(it.top) - (boxH - (sh.ascent + sh.descent)) / 2 - sh.ascent;
          if (it.c[3] < 1) ops.push(pushGraphicsState(), setGraphicsState(alpha(it.c[3])));
          ops.push(...te.ops(sh, X(it.x), base, { color: [it.c[0], it.c[1], it.c[2]], key }));
          if (it.u || it.strike) {
            ops.push(pushGraphicsState(), setStrokingRgbColor(it.c[0], it.c[1], it.c[2]), setLineWidth(Math.max(0.4, it.size * k * 0.06)));
            if (it.u) ops.push(moveTo(X(it.x), base - it.size * k * 0.12), lineTo(X(it.x) + sh.width, base - it.size * k * 0.12), stroke());
            if (it.strike) ops.push(moveTo(X(it.x), base + it.size * k * 0.3), lineTo(X(it.x) + sh.width, base + it.size * k * 0.3), stroke());
            ops.push(popGraphicsState());
          }
          if (it.c[3] < 1) ops.push(popGraphicsState());
        }
      }
      ops.push(popGraphicsState());
      page.pushOperators(...ops);
      // clickable links
      for (const l of col.links) {
        if (l.b.y < y0 || l.b.y + l.b.h > y1) continue;
        const rect = [X(l.b.x), Y(l.b.y + l.b.h), X(l.b.x + l.b.w), Y(l.b.y)];
        const annot = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(l.href) } }));
        const arr = page.node.Annots();
        if (arr) arr.push(annot); else page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
        links++;
      }
      o.onProgress?.('Writing pages…', p + 1, cuts.length - 1);
    }
    if (title) doc.setTitle(title, { showInWindowTitleBar: true });
    doc.setProducer('PDFSherpa');
    doc.setCreator('PDFSherpa HTML to PDF');
    const pdf = await doc.save({ useObjectStreams: true });
    return { pdf, pages: cuts.length - 1, skippedImages, missingGlyphs: te.missing, links };
  } finally {
    frame?.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number): PDFOperator[] {
  if (r <= 0.1) return [rectangle(x, y, w, h)];
  const K = 0.5523 * r;
  return [moveTo(x + r, y), lineTo(x + w - r, y), appendBezierCurve(x + w - r + K, y, x + w, y + r - K, x + w, y + r), lineTo(x + w, y + h - r),
    appendBezierCurve(x + w, y + h - r + K, x + w - r + K, y + h, x + w - r, y + h), lineTo(x + r, y + h), appendBezierCurve(x + r - K, y + h, x, y + h - r + K, x, y + h - r),
    lineTo(x, y + r), appendBezierCurve(x, y + r - K, x + r - K, y, x + r, y), closePath()];
}
