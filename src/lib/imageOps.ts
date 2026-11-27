/**
 * Canvas image operations for the image tools (browser). Pixel work is done by hand rather than with
 * ctx.filter so results are identical in every browser, including Safari.
 */
import type { Decoded } from './image';

export type Src = Decoded | HTMLCanvasElement;
const srcOf = (s: Src): CanvasImageSource => ('source' in s ? s.source : s);
export const sizeOf = (s: Src) => ({ w: s.width, h: s.height });

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
export function toCanvas(s: Src): HTMLCanvasElement {
  if (!('source' in s)) return s;
  const c = canvas(s.width, s.height);
  c.getContext('2d')!.drawImage(s.source, 0, 0);
  return c;
}
/** A fresh canvas with the image drawn on it (never the input itself). */
export function copy(s: Src): HTMLCanvasElement {
  const c = canvas(s.width, s.height);
  c.getContext('2d')!.drawImage(srcOf(s), 0, 0);
  return c;
}
/** Scaled copy no larger than max on its longer side (for previews). */
export function scaled(s: Src, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(s.width, s.height));
  const c = canvas(s.width * k, s.height * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcOf(s), 0, 0, c.width, c.height);
  return c;
}

// ───────────── rotate / flip ─────────────

/** Rotate by any angle (degrees, clockwise). expand: grow the canvas to fit; else crop to the largest upright rectangle. */
export function rotate(s: Src, deg: number, opts: { expand: boolean; background: string | null }): HTMLCanvasElement {
  const r = (((deg % 360) + 360) % 360) * Math.PI / 180;
  const w = s.width, h = s.height;
  const cos = Math.abs(Math.cos(r)), sin = Math.abs(Math.sin(r));
  let cw = w * cos + h * sin, ch = w * sin + h * cos;
  if (!opts.expand) {
    // largest upright rectangle inside the rotated picture, with the shape of the picture turned
    // by the nearest quarter turn (so 95° gives a portrait result for a landscape photo)
    const q = Math.round(deg / 90);
    const [tw, th] = Math.abs(q) % 2 ? [h, w] : [w, h];
    const a = Math.abs(((deg - q * 90) * Math.PI) / 180);
    const ca = Math.cos(a), sa = Math.sin(a);
    const k = Math.min(tw / (tw * ca + th * sa), th / (tw * sa + th * ca));
    cw = tw * k; ch = th * k;
  }
  // exact right angles: keep integer sizes
  const right = Math.abs(Math.sin(r * 2)) < 1e-9;
  if (right) { cw = Math.round(cw); ch = Math.round(ch); }
  const c = canvas(cw, ch);
  const ctx = c.getContext('2d')!;
  if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(r);
  ctx.drawImage(srcOf(s), -w / 2, -h / 2);
  return c;
}

export function flip(s: Src, horizontal: boolean, vertical: boolean): HTMLCanvasElement {
  const c = canvas(s.width, s.height);
  const ctx = c.getContext('2d')!;
  ctx.translate(horizontal ? c.width : 0, vertical ? c.height : 0);
  ctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
  ctx.drawImage(srcOf(s), 0, 0);
  return c;
}

// ───────────── colour adjustments ─────────────

export interface Adjust {
  brightness: number; contrast: number; saturation: number; warmth: number; // -100..100
  exposure: number; highlights: number; shadows: number; // -100..100
  sharpen: number; vignette: number; // 0..100
  filter: FilterName;
}
export type FilterName = 'none' | 'mono' | 'sepia' | 'vintage' | 'vivid' | 'cool' | 'warm' | 'fade' | 'noir' | 'dramatic';
export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, exposure: 0, highlights: 0, shadows: 0, sharpen: 0, vignette: 0, filter: 'none' };

const FILTERS: Record<FilterName, Partial<Adjust> & { mono?: boolean; sepia?: number; lift?: number }> = {
  none: {}, mono: { mono: true, contrast: 10 }, sepia: { sepia: 1 }, vintage: { sepia: 0.45, contrast: -10, saturation: -20, lift: 25, vignette: 35 },
  vivid: { saturation: 40, contrast: 15 }, cool: { warmth: -35, saturation: 5 }, warm: { warmth: 35, saturation: 8 }, fade: { contrast: -25, saturation: -25, lift: 35 },
  noir: { mono: true, contrast: 45, vignette: 40 }, dramatic: { contrast: 35, saturation: -15, vignette: 45, shadows: -15 },
};

/** Auto-enhance: stretch levels and lift saturation slightly, based on the histogram. */
export function autoAdjust(s: Src): Adjust {
  const c = scaled(s, 300);
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const hist = new Uint32Array(256);
  let sat = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    hist[l]++;
    sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
  }
  const n = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > n * 0.005) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > n * 0.005) break; }
  const mean = hist.reduce((t, v, i) => t + v * i, 0) / n;
  const range = Math.max(1, hi - lo);
  return {
    ...NO_ADJUST,
    contrast: Math.round(Math.min(40, Math.max(0, (255 / range - 1) * 60))),
    brightness: Math.round(Math.max(-25, Math.min(25, (128 - mean) / 3))),
    saturation: sat / n < 40 ? 18 : 6, sharpen: 15,
  };
}

/** Apply adjustments to a copy. */
export function adjust(s: Src, a: Adjust): HTMLCanvasElement {
  const c = copy(s);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const f = FILTERS[a.filter];
  const p = { ...a, contrast: a.contrast + (f.contrast ?? 0), saturation: a.saturation + (f.saturation ?? 0), warmth: a.warmth + (f.warmth ?? 0), vignette: Math.min(100, a.vignette + (f.vignette ?? 0)), shadows: a.shadows + (f.shadows ?? 0) };
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  // tone curve as a lookup table: exposure, brightness, contrast, shadows/highlights, fade lift
  const lut = new Uint8ClampedArray(256);
  const ex = Math.pow(2, p.exposure / 50), br = p.brightness * 1.28, ct = (100 + p.contrast) / 100, lift = (f.lift ?? 0);
  for (let v = 0; v < 256; v++) {
    let x = v * ex + br;
    x = (x - 128) * ct + 128;
    const t = x / 255;
    if (p.shadows) x += p.shadows * 0.9 * Math.max(0, 1 - t * 2) * (1 - Math.max(0, 1 - t * 2) * 0.3);
    if (p.highlights) x += p.highlights * 0.9 * Math.max(0, t * 2 - 1);
    if (lift) x = lift + x * (255 - lift) / 255;
    lut[v] = x;
  }
  const sat = (100 + p.saturation) / 100, warm = p.warmth * 0.35, sepia = f.sepia ?? 0, mono = !!f.mono;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (mono) { r = g = b = l; }
    else {
      if (sat !== 1) { r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
      if (warm) { r += warm; b -= warm; }
      if (sepia) {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
        r += (sr - r) * sepia; g += (sg - g) * sepia; b += (sb - b) * sepia;
      }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  if (p.sharpen > 0) sharpenData(img, p.sharpen / 100);
  ctx.putImageData(img, 0, 0);
  if (p.vignette > 0) {
    const g = ctx.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.35, c.width / 2, c.height / 2, Math.hypot(c.width, c.height) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(p.vignette / 100) * 0.7})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

/** Unsharp-style 3×3 sharpen, in place. */
function sharpenData(img: ImageData, amount: number) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const k = amount * 1.2;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      const v = src[i + c] * (1 + 4 * k) - k * (src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c]);
      d[i + c] = v;
    }
  }
}

// ───────────── blur / pixelate areas ─────────────

export interface Area { x: number; y: number; w: number; h: number; ellipse: boolean; } // fractions
export type Hide = 'blur' | 'pixelate' | 'solid';

/** Blur, pixelate or black out areas (or the whole image when areas is empty and whole=true). */
export function hideAreas(s: Src, areas: Area[], mode: Hide, strength: number, color = '#000000'): HTMLCanvasElement {
  const base = toCanvas(s);
  const c = canvas(base.width, base.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  // effect layer for the whole picture, then copied through each area's shape
  const fx = canvas(c.width, c.height);
  const fctx = fx.getContext('2d')!;
  const size = Math.max(c.width, c.height);
  if (mode === 'solid') { fctx.fillStyle = color; fctx.fillRect(0, 0, fx.width, fx.height); }
  else if (mode === 'pixelate') {
    const block = Math.max(4, Math.round(size * (0.006 + strength / 100 * 0.045)));
    const small = canvas(Math.ceil(c.width / block), Math.ceil(c.height / block));
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'medium';
    sctx.drawImage(base, 0, 0, small.width, small.height);
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(small, 0, 0, small.width * block, small.height * block);
  } else {
    // repeated down/up scaling: a strong, irreversible blur that runs fast everywhere
    const k = 4 + strength / 100 * 36;
    const small = canvas(Math.max(1, c.width / k), Math.max(1, c.height / k));
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(base, 0, 0, small.width, small.height);
    const mid = canvas(small.width * 2, small.height * 2);
    mid.getContext('2d')!.drawImage(small, 0, 0, mid.width, mid.height);
    sctx.drawImage(mid, 0, 0, small.width, small.height);
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(small, 0, 0, c.width, c.height);
  }
  for (const a of areas) {
    ctx.save();
    ctx.beginPath();
    const x = a.x * c.width, y = a.y * c.height, w = a.w * c.width, h = a.h * c.height;
    if (a.ellipse) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(fx, 0, 0);
    ctx.restore();
  }
  fx.width = fx.height = 0;
  return c;
}

// ───────────── text and watermarks ─────────────

export interface TextLayer {
  text: string; x: number; y: number; // centre, fractions
  size: number; // fraction of image width (cap height-ish)
  color: string; font: string; bold: boolean; italic: boolean;
  stroke: number; strokeColor: string; // stroke width relative to size (0..0.25)
  background: string | null; align: 'left' | 'center' | 'right'; angle: number; opacity: number; upper: boolean;
}

export function drawText(ctx: CanvasRenderingContext2D, L: TextLayer, W: number, H: number) {
  let px = Math.max(4, L.size * W);
  const font = (p: number) => `${L.italic ? 'italic ' : ''}${L.bold ? '700 ' : ''}${p}px ${L.font}`;
  ctx.save();
  ctx.font = font(px);
  // wrap to the picture width (minus a margin); shrink when a single word is still too wide
  const maxW = W * 0.94;
  const wrap = () => {
    const out: string[] = [];
    for (const para of (L.upper ? L.text.toUpperCase() : L.text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const t = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(t).width > maxW) { out.push(line); line = word; } else line = t;
      }
      out.push(line);
    }
    return out;
  };
  let lines = wrap();
  const widest = () => Math.max(...lines.map((l) => ctx.measureText(l).width));
  for (let i = 0; i < 12 && widest() > maxW; i++) { px *= 0.9; ctx.font = font(px); lines = wrap(); }
  ctx.globalAlpha = L.opacity;
  ctx.textAlign = L.align; ctx.textBaseline = 'middle';
  const lh = px * 1.18;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const bw = Math.max(...widths), bh = lh * lines.length;
  // keep the whole block inside the picture (long top/bottom captions grow inward)
  const pad = px * 0.15;
  const cy = Math.min(Math.max(L.y * H, bh / 2 + pad), Math.max(bh / 2 + pad, H - bh / 2 - pad));
  ctx.translate(L.x * W, cy);
  ctx.rotate((L.angle * Math.PI) / 180);
  const ax = L.align === 'left' ? 0 : L.align === 'right' ? -bw : -bw / 2;
  if (L.background) { ctx.fillStyle = L.background; const pad = px * 0.25; ctx.fillRect(ax - pad, -bh / 2 - pad * 0.6, bw + pad * 2, bh + pad * 1.2); }
  const tx = L.align === 'left' ? 0 : L.align === 'right' ? 0 : 0;
  lines.forEach((l, i) => {
    const y = -bh / 2 + lh * (i + 0.5);
    if (L.stroke > 0) { ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = px * L.stroke; ctx.strokeStyle = L.strokeColor; ctx.strokeText(l, tx, y); }
    ctx.fillStyle = L.color; ctx.fillText(l, tx, y);
  });
  ctx.restore();
  return { w: bw / W, h: bh / H };
}

export function withText(s: Src, layers: TextLayer[]): HTMLCanvasElement {
  const c = copy(s);
  const ctx = c.getContext('2d')!;
  for (const L of layers) if (L.text.trim()) drawText(ctx, L, c.width, c.height);
  return c;
}

export interface Mark {
  kind: 'text' | 'logo'; text: string; logo: HTMLCanvasElement | null;
  color: string; size: number; // fraction of the shorter side
  opacity: number; angle: number; position: 'tile' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'bottom-center';
  bold: boolean;
}

/** Visible watermark: text or a logo, once in a corner/centre or tiled across the image. */
export function watermark(s: Src, m: Mark): HTMLCanvasElement {
  const c = copy(s);
  const ctx = c.getContext('2d')!;
  const short = Math.min(c.width, c.height);
  let mw: number, mh: number;
  const px = Math.max(8, m.size * short);
  if (m.kind === 'text') { ctx.font = `${m.bold ? '700 ' : ''}${px}px Arial, Helvetica, sans-serif`; mw = ctx.measureText(m.text).width; mh = px; }
  else if (m.logo) { mw = m.size * short * 2.2; mh = (mw * m.logo.height) / m.logo.width; }
  else return c;
  const stamp = (cx: number, cy: number) => {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate((m.angle * Math.PI) / 180);
    if (m.kind === 'text') {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // thin contrasting outline keeps text readable on light and dark photos
      ctx.lineWidth = px * 0.06; ctx.strokeStyle = isLight(m.color) ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.35)'; ctx.strokeText(m.text, 0, 0);
      ctx.fillStyle = m.color; ctx.fillText(m.text, 0, 0);
    } else ctx.drawImage(m.logo!, -mw / 2, -mh / 2, mw, mh);
    ctx.restore();
  };
  ctx.globalAlpha = m.opacity;
  if (m.position === 'tile') {
    const stepX = mw * 1.6 + short * 0.08, stepY = mh * 3.2 + short * 0.06;
    for (let y = -stepY, row = 0; y < c.height + stepY; y += stepY, row++) for (let x = -stepX + (row % 2) * stepX / 2; x < c.width + stepX; x += stepX) stamp(x, y);
  } else {
    const pad = short * 0.04;
    const pos: Record<string, [number, number]> = {
      center: [c.width / 2, c.height / 2], 'top-left': [pad + mw / 2, pad + mh / 2], 'top-right': [c.width - pad - mw / 2, pad + mh / 2],
      'bottom-left': [pad + mw / 2, c.height - pad - mh / 2], 'bottom-right': [c.width - pad - mw / 2, c.height - pad - mh / 2], 'bottom-center': [c.width / 2, c.height - pad - mh / 2],
    };
    stamp(...pos[m.position]);
  }
  ctx.globalAlpha = 1;
  return c;
}
const isLight = (hex: string) => { const n = parseInt(hex.replace('#', ''), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150; };

// ───────────── borders / frames ─────────────

export interface Border { width: number; /* fraction of the shorter side */ color: string; radius: number; /* fraction */ style: 'solid' | 'double' | 'polaroid' | 'shadow'; }

/** Add a frame around the picture (the canvas grows; the photo is never covered). */
export function addBorder(s: Src, b: Border): HTMLCanvasElement {
  const short = Math.min(s.width, s.height);
  const bw = Math.round(b.width * short);
  let top = bw, side = bw, bottom = bw;
  if (b.style === 'polaroid') { side = top = Math.max(bw, Math.round(short * 0.05)); bottom = Math.round(side * 3.6); }
  const shadow = b.style === 'shadow' ? Math.round(short * 0.05) : 0;
  const W = s.width + side * 2 + shadow * 2, H = s.height + top + bottom + shadow * 2;
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  const r = b.radius * short;
  const rr = (x: number, y: number, w: number, h: number, rad: number) => { ctx.beginPath(); if ((ctx as any).roundRect && rad > 0) (ctx as any).roundRect(x, y, w, h, rad); else ctx.rect(x, y, w, h); };
  if (shadow) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = shadow; ctx.shadowOffsetY = shadow * 0.3; ctx.fillStyle = b.color; rr(shadow, shadow, W - shadow * 2, H - shadow * 2, r); ctx.fill(); ctx.restore(); }
  else { ctx.fillStyle = b.color; rr(0, 0, W, H, r + (b.style === 'polaroid' ? 0 : bw)); ctx.fill(); }
  ctx.save();
  rr(shadow + side, shadow + top, s.width, s.height, r);
  ctx.clip();
  ctx.drawImage(srcOf(s), shadow + side, shadow + top);
  ctx.restore();
  if (b.style === 'double' && bw >= 6) { ctx.strokeStyle = isLight(b.color) ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.7)'; ctx.lineWidth = Math.max(1, bw * 0.12); rr(bw * 0.45, bw * 0.45, W - bw * 0.9, H - bw * 0.9, r); ctx.stroke(); }
  return c;
}
