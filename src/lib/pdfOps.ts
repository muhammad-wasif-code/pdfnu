/**
 * Pure pdf-lib operations. Executed inside the pdf worker (see workers/pdf.worker.ts).
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

const load = (buf: ArrayBuffer) => PDFDocument.load(buf, { updateMetadata: false });
const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true, addDefaultPage: false });

export async function inspect(input: ArrayBuffer) {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  return { pageCount: doc.getPageCount(), encrypted: doc.isEncrypted };
}

export async function lossless(input: ArrayBuffer) {
  return save(await load(input));
}

export async function merge(inputs: ArrayBuffer[]) {
  const out = await PDFDocument.create();
  for (const buf of inputs) {
    const src = await load(buf);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return save(out);
}

/** Build one new PDF per group of 0-based page indexes. */
export async function extractGroups(input: ArrayBuffer, groups: number[][]) {
  const src = await load(input);
  const outs: Uint8Array[] = [];
  for (const g of groups) {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, g);
    pages.forEach((p) => out.addPage(p));
    outs.push(await save(out));
  }
  return outs;
}

/** New document from [{ src: pageIndex, rotate: extra degrees }] — covers organize, delete, rotate. */
export async function rearrange(input: ArrayBuffer, spec: { src: number; rotate: number }[]) {
  const src = await load(input);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, spec.map((s) => s.src));
  pages.forEach((p, i) => {
    const r = (((p.getRotation().angle + spec[i].rotate) % 360) + 360) % 360;
    p.setRotation(degrees(r));
    out.addPage(p);
  });
  return save(out);
}

/* ---------- Visual-space helpers (respect /Rotate so marks appear upright) ---------- */

interface Frame { vw: number; vh: number; toUser: (vx: number, vy: number) => [number, number]; angle: (va: number) => number; }

function frame(page: PDFPage): Frame {
  const { width: W, height: H, x: ox, y: oy } = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const t = (x: number, y: number): [number, number] => [x + ox, y + oy];
  switch (r) {
    case 90: return { vw: H, vh: W, toUser: (vx, vy) => t(W - vy, vx), angle: (a) => a + 90 };
    case 180: return { vw: W, vh: H, toUser: (vx, vy) => t(W - vx, H - vy), angle: (a) => a + 180 };
    case 270: return { vw: H, vh: W, toUser: (vx, vy) => t(vy, H - vx), angle: (a) => a + 270 };
    default: return { vw: W, vh: H, toUser: t, angle: (a) => a };
  }
}

/** Origin (visual) for a box of size w×h, rotated by `a` degrees around its center placed at (cx, cy). */
function originFor(cx: number, cy: number, w: number, h: number, a: number): [number, number] {
  const rad = (a * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return [cx - (c * w) / 2 + (s * h) / 2, cy - (s * w) / 2 - (c * h) / 2];
}

export type Position = 'center' | 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'tile';

function anchor(pos: Position, f: Frame, w: number, h: number, margin: number): [number, number] {
  const left = margin + w / 2, right = f.vw - margin - w / 2, cx = f.vw / 2;
  const top = f.vh - margin - h / 2, bottom = margin + h / 2, cy = f.vh / 2;
  switch (pos) {
    case 'top-left': return [left, top];
    case 'top-center': return [cx, top];
    case 'top-right': return [right, top];
    case 'bottom-left': return [left, bottom];
    case 'bottom-center': return [cx, bottom];
    case 'bottom-right': return [right, bottom];
    default: return [cx, cy];
  }
}

/** pdf-lib standard fonts only cover WinAnsi; replace anything else so drawing never throws. */
function safeText(font: PDFFont, text: string) {
  return [...text].map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) ?? ['', '6b7280'];
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export interface WatermarkOpts {
  kind: 'text' | 'image';
  text?: string;
  fontSize?: number;
  color?: string;
  image?: ArrayBuffer;
  imageType?: 'png' | 'jpg';
  /** image width as fraction of page width */
  imageScale?: number;
  opacity: number;
  position: Position;
  /** visual angle in degrees */
  angle: number;
  pages?: number[] | null;
}

export async function watermark(input: ArrayBuffer, o: WatermarkOpts) {
  const doc = await load(input);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const img = o.kind === 'image' && o.image ? (o.imageType === 'png' ? await doc.embedPng(o.image) : await doc.embedJpg(o.image)) : null;
  const text = o.kind === 'text' ? safeText(font, o.text || 'CONFIDENTIAL') : '';
  const color = hexToRgb(o.color || '#6b7280');
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    if (o.pages && !o.pages.includes(i)) return;
    const f = frame(page);
    let w: number, h: number, size = 0;
    if (img) {
      w = f.vw * (o.imageScale ?? 0.4);
      h = (img.height / img.width) * w;
    } else {
      size = o.fontSize ?? Math.round(Math.min(f.vw, f.vh) / 9);
      w = font.widthOfTextAtSize(text, size);
      h = font.heightAtSize(size, { descender: false });
    }
    const centers: [number, number][] = [];
    if (o.position === 'tile') {
      const stepX = Math.max(w * 1.1, f.vw / 3), stepY = Math.max(h * 4, f.vh / 5);
      for (let y = stepY / 2; y < f.vh; y += stepY) for (let x = stepX / 2; x < f.vw + stepX / 2; x += stepX) centers.push([x + ((y / stepY) % 2 ? stepX / 2 : 0) - stepX / 4, y]);
    } else {
      // keep rotated box inside page for corner positions
      const rad = (o.angle * Math.PI) / 180;
      const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
      const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
      centers.push(anchor(o.position, f, bw, bh, Math.min(f.vw, f.vh) * 0.05));
    }
    for (const [cx, cy] of centers) {
      const [vx, vy] = originFor(cx, cy, w, h, o.angle);
      const [x, y] = f.toUser(vx, vy);
      const rotate = degrees(f.angle(o.angle));
      if (img) page.drawImage(img, { x, y, width: w, height: h, opacity: o.opacity, rotate });
      else page.drawText(text, { x, y, size, font, color, opacity: o.opacity, rotate });
    }
  });
  return save(doc);
}

export interface PageNumberOpts {
  position: Exclude<Position, 'center' | 'tile'>;
  format: 'n' | 'page-n' | 'n-of-total' | 'page-n-of-total';
  start: number;
  fontSize: number;
  skipFirst: boolean;
}

export async function pageNumbers(input: ArrayBuffer, o: PageNumberOpts) {
  const doc = await load(input);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const numbered = pages.length - (o.skipFirst ? 1 : 0);
  const total = o.start + numbered - 1;
  pages.forEach((page, i) => {
    if (o.skipFirst && i === 0) return;
    const n = o.start + i - (o.skipFirst ? 1 : 0);
    const label = { n: `${n}`, 'page-n': `Page ${n}`, 'n-of-total': `${n} / ${total}`, 'page-n-of-total': `Page ${n} of ${total}` }[o.format];
    const f = frame(page);
    const w = font.widthOfTextAtSize(label, o.fontSize);
    const h = font.heightAtSize(o.fontSize, { descender: false });
    const margin = Math.max(18, Math.min(f.vw, f.vh) * 0.04);
    const [cx, cy] = anchor(o.position, f, w, h, margin);
    const [vx, vy] = originFor(cx, cy, w, h, 0);
    const [x, y] = f.toUser(vx, vy);
    page.drawText(label, { x, y, size: o.fontSize, font, color: rgb(0.2, 0.2, 0.22), rotate: degrees(f.angle(0)) });
  });
  return save(doc);
}

export interface ImagePage { data: ArrayBuffer; type: 'jpg' | 'png'; width: number; height: number; }
export interface ImagesToPdfOpts {
  /** 'fit' = page matches image; otherwise a fixed size in points */
  pageSize: 'fit' | 'a4' | 'letter';
  orientation: 'auto' | 'portrait' | 'landscape';
  margin: number;
}

const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export async function imagesToPdf(images: ImagePage[], o: ImagesToPdfOpts) {
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = im.type === 'png' ? await doc.embedPng(im.data) : await doc.embedJpg(im.data);
    // image px → pt at 96 dpi feels natural for 'fit' pages; fixed sizes scale-to-fit
    let pw: number, ph: number;
    if (o.pageSize === 'fit') {
      const scale = 72 / 96;
      pw = im.width * scale + o.margin * 2;
      ph = im.height * scale + o.margin * 2;
    } else {
      [pw, ph] = SIZES[o.pageSize];
      const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && im.width > im.height);
      if (landscape) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const aw = pw - o.margin * 2, ah = ph - o.margin * 2;
    const s = Math.min(aw / im.width, ah / im.height);
    const w = im.width * s, h = im.height * s;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  doc.setProducer('PDFSherpa');
  return save(doc);
}

export async function jpegsToPdf(pages: { jpeg: ArrayBuffer; w: number; h: number }[]) {
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const img = await doc.embedJpg(p.jpeg);
    const page = doc.addPage([p.w, p.h]);
    page.drawImage(img, { x: 0, y: 0, width: p.w, height: p.h });
  }
  doc.setProducer('PDFSherpa');
  return save(doc);
}
