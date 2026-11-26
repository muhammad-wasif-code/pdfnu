/**
 * Vector graphics of a PDF page from pdf.js's operator list: filled rectangles (cell shading),
 * horizontal / vertical rules (table borders), images with their placement, and the fill colour
 * used for each run of text. Coordinates are viewport units, measured from the top-left.
 */
export interface GRect { x0: number; y0: number; x1: number; y1: number; color: string; }
export interface GLine { x0: number; y0: number; x1: number; y1: number; color: string; w: number; }
export interface GImage { x0: number; y0: number; x1: number; y1: number; id: string; }
export interface PageGraphics { fills: GRect[]; hlines: GLine[]; vlines: GLine[]; images: GImage[]; textColors: { text: string; color: string }[]; }

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const ap = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function toHex(arg: any): string {
  if (typeof arg === 'string') return arg.replace('#', '').toUpperCase().padStart(6, '0').slice(-6);
  if (arg && arg.length >= 3) return [...arg].slice(0, 3).map((v: number) => Math.round(v > 1 ? v : v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  return '000000';
}

export function pageGraphics(ol: { fnArray: number[]; argsArray: any[] }, OPS: Record<string, number>, viewport: any): PageGraphics {
  const out: PageGraphics = { fills: [], hlines: [], vlines: [], images: [], textColors: [] };
  const vpW = viewport.width, vpH = viewport.height;
  const conv = (m: M, x: number, y: number): [number, number] => { const p = ap(m, x, y); return viewport.convertToViewportPoint(p[0], p[1]); };
  let ctm: M = [1, 0, 0, 1, 0, 0];
  let fillC = '000000', strokeC = '000000', lw = 1;
  // visible area (clipping), as a bounding box in viewport coordinates
  let clipBox: [number, number, number, number] = [-1e9, -1e9, 1e9, 1e9];
  let pendingClip = false;
  const stack: { ctm: M; fillC: string; strokeC: string; lw: number; clipBox: [number, number, number, number] }[] = [];
  const cut = <T extends { x0: number; y0: number; x1: number; y1: number }>(r: T): T | null => {
    const x0 = Math.max(r.x0, clipBox[0]), y0 = Math.max(r.y0, clipBox[1]), x1 = Math.min(r.x1, clipBox[2]), y1 = Math.min(r.y1, clipBox[3]);
    return x1 < x0 - 0.01 || y1 < y0 - 0.01 ? null : { ...r, x0, y0, x1, y1 };
  };
  const add = <T extends { x0: number; y0: number; x1: number; y1: number }>(list: T[], r: T) => { const c = cut(r); if (c) list.push(c); };
  const name: Record<number, string> = {};
  for (const [k, v] of Object.entries(OPS)) name[v] = k;
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = name[ol.fnArray[i]];
    const args = ol.argsArray[i];
    switch (fn) {
      case 'save': stack.push({ ctm, fillC, strokeC, lw, clipBox }); break;
      case 'restore': { const s = stack.pop(); if (s) ({ ctm, fillC, strokeC, lw, clipBox } = s); break; }
      case 'clip': case 'eoClip': pendingClip = true; break;
      case 'transform': ctm = mul(args as M, ctm); break;
      case 'setFillRGBColor': fillC = toHex(args[0] ?? args); break;
      case 'setStrokeRGBColor': strokeC = toHex(args[0] ?? args); break;
      case 'setFillGray': fillC = toHex([args[0], args[0], args[0]]); break;
      case 'setStrokeGray': strokeC = toHex([args[0], args[0], args[0]]); break;
      case 'setLineWidth': lw = args[0] ?? 1; break;
      case 'paintImageXObject': case 'paintImageXObjectRepeat': case 'paintInlineImageXObject': {
        const a = conv(ctm, 0, 0), b = conv(ctm, 1, 1);
        const id = typeof args[0] === 'string' ? args[0] : '';
        if (id) add(out.images, { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]), id });
        break;
      }
      case 'showText': case 'showSpacedText': case 'nextLineShowText': case 'nextLineSetSpacingShowText': {
        const glyphs = (args[0] ?? []) as any[];
        let t = '';
        for (const g of glyphs) if (g && typeof g === 'object' && typeof g.unicode === 'string') t += g.unicode;
        if (t.trim()) out.textColors.push({ text: t, color: fillC });
        break;
      }
      case 'constructPath': {
        // pdf.js ≥ 5: [paintOp, [Float32Array path], minMax]; path ops: 0 move, 1 line, 2 curve, 3 quad, 4 close
        const paint = args[0];
        const data = args[1]?.[0];
        if (typeof paint !== 'number' || !data || typeof data.length !== 'number') break;
        const p = name[paint];
        if (pendingClip) {
          // the path is a clipping path: narrow the visible area to its bounding box
          pendingClip = false;
          const xs: number[] = [], ys: number[] = [];
          for (let k = 0; k < data.length;) {
            const op = data[k++];
            const n = op === 0 || op === 1 ? 2 : op === 2 ? 6 : op === 3 ? 4 : 0;
            for (let j = 0; j < n; j += 2) { const q = conv(ctm, data[k + j], data[k + j + 1]); xs.push(q[0]); ys.push(q[1]); }
            k += n;
            if (op > 4) break;
          }
          if (xs.length) clipBox = [Math.max(clipBox[0], Math.min(...xs)), Math.max(clipBox[1], Math.min(...ys)), Math.min(clipBox[2], Math.max(...xs)), Math.min(clipBox[3], Math.max(...ys))];
        }
        const fills = /fill/i.test(p ?? '') && !/^endPath$/.test(p);
        const strokes = /stroke/i.test(p ?? '');
        if (!fills && !strokes) break;
        // split into sub-paths of points
        const subs: [number, number][][] = [];
        let cur: [number, number][] = [];
        let curved = false;
        for (let k = 0; k < data.length;) {
          const op = data[k++];
          if (op === 0) { if (cur.length) subs.push(cur); cur = [[data[k], data[k + 1]]]; k += 2; }
          else if (op === 1) { cur.push([data[k], data[k + 1]]); k += 2; }
          else if (op === 2) { curved = true; cur.push([data[k + 4], data[k + 5]]); k += 6; }
          else if (op === 3) { curved = true; cur.push([data[k + 2], data[k + 3]]); k += 4; }
          else if (op === 4) { if (cur.length) cur.push(cur[0]); }
          else break;
        }
        if (cur.length) subs.push(cur);
        if (curved) break; // rounded shapes, charts: not table structure
        for (const sp of subs) {
          const pts = sp.map(([x, y]) => conv(ctm, x, y));
          const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
          const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
          const axis = pts.every((q, j) => j === 0 || Math.abs(q[0] - pts[j - 1][0]) < 0.5 || Math.abs(q[1] - pts[j - 1][1]) < 0.5);
          if (!axis) continue;
          const w = x1 - x0, h = y1 - y0;
          const thin = Math.max(lw * Math.hypot(ctm[0], ctm[1]), 0.3);
          if (fills && pts.length >= 4) {
            if (h <= 2.5 && w > 3) add(out.hlines, { x0, x1, y0: (y0 + y1) / 2, y1: (y0 + y1) / 2, color: fillC, w: Math.max(0.3, h) });
            else if (w <= 2.5 && h > 3) add(out.vlines, { x0: (x0 + x1) / 2, x1: (x0 + x1) / 2, y0, y1, color: fillC, w: Math.max(0.3, w) });
            else if (w > 2 && h > 2 && !(w > vpW * 0.95 && h > vpH * 0.95)) add(out.fills, { x0, y0, x1, y1, color: fillC });
          }
          if (strokes) {
            if (pts.length === 2 || (h < 0.5 && w > 1) || (w < 0.5 && h > 1)) {
              if (h < 0.5) add(out.hlines, { x0, x1, y0, y1: y0, color: strokeC, w: thin });
              else if (w < 0.5) add(out.vlines, { x0, x1: x0, y0, y1, color: strokeC, w: thin });
            } else if (pts.length >= 4 && w > 1 && h > 1) { // a stroked rectangle = four rules
              add(out.hlines, { x0, x1, y0, y1: y0, color: strokeC, w: thin }); add(out.hlines, { x0, x1, y0: y1, y1, color: strokeC, w: thin });
              add(out.vlines, { x0, x1: x0, y0, y1, color: strokeC, w: thin }); add(out.vlines, { x0: x1, x1, y0, y1, color: strokeC, w: thin });
            }
          }
        }
        break;
      }
    }
  }
  return out;
}

/** Attach a fill colour to each text item, matching pdf.js text items to the drawing order of text. */
export function colorsForItems(items: { str: string }[], runs: { text: string; color: string }[]): (string | undefined)[] {
  const stream: { ch: string; color: string }[] = [];
  for (const r of runs) for (const ch of r.text.replace(/\s+/g, '')) stream.push({ ch, color: r.color });
  let p = 0;
  return items.map((it) => {
    const s = it.str.replace(/\s+/g, '');
    if (!s) return undefined;
    for (let k = p; k < Math.min(stream.length, p + 400); k++) {
      if (stream[k].ch === s[0] && (s.length < 2 || stream[k + 1]?.ch === s[1])) { p = k + s.length; return stream[k].color; }
    }
    return undefined;
  });
}
