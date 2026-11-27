/**
 * Pure pdf-lib operations. Executed inside the pdf worker (see workers/pdf.worker.ts).
 */
import {
  PDFDocument, StandardFonts, degrees, rgb, PDFName, PDFDict, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown,
  PDFOptionList, PDFSignature, PDFButton, PDFArray, PDFStream, PDFRef, PDFNumber,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, beginText, endText, setFontAndSize,
  setTextRenderingMode, TextRenderingMode, setTextMatrix, showText, setCharacterSqueeze, TextAlignment, type PDFPage, type PDFFont,
  PDFHexString, PDFString, PDFOperator, setGraphicsState, setStrokingRgbColor, setFillingRgbColor, setLineWidth, setLineCap, setLineJoin,
  LineCapStyle, LineJoinStyle, moveTo, lineTo, appendBezierCurve, closePath, stroke, fill, fillAndStroke, rectangle, clip, endPath, setDashPattern,
} from 'pdf-lib';
import { TextEngine, wrapLines, pageKeyer, type Keyer, type TextStyle } from './textEngine';
/** Tests point font loading at the files on disk. */
export { setFontFetcher } from './textEngine';
import { bookletOrder } from './booklet';
export { bookletOrder };

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
/** True if a standard (WinAnsi) font can draw the text as is: the small, fast path. */
function winAnsi(font: PDFFont, text: string) { try { font.encodeText(text); return true; } catch { return false; } }
const rgbOf = (hex: string): [number, number, number] => { const c = hexToRgb(hex) as any; return [c.red, c.green, c.blue]; };

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
  const raw = o.kind === 'text' ? (o.text || 'CONFIDENTIAL').replace(/\s+/g, ' ') : '';
  // any language: Urdu, Hindi, Chinese… go through the multilingual text engine
  const te = raw && !winAnsi(font, raw) ? await TextEngine.create(doc) : null;
  if (te) await te.prepare([{ text: raw, style: { bold: true } }]);
  const text = raw;
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
      w = te ? te.measure(text, { bold: true }, size) : font.widthOfTextAtSize(text, size);
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
      else if (te) te.drawOnPage(page, te.shape(text, { bold: true }, size), x, y, { color: rgbOf(o.color || '#6b7280'), rotate: f.angle(o.angle), opacity: o.opacity });
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

export interface StampItem {
  page: number;
  /** box in the page's *visual* space as fractions (0..1), origin top-left */
  x: number; y: number; w: number; h: number;
  png: ArrayBuffer;
}

/** Place PNG stamps (signatures, dates, initials) on pages, upright even on rotated pages. */
export async function stamp(input: ArrayBuffer, items: StampItem[]) {
  const doc = await load(input);
  const pages = doc.getPages();
  const cache = new Map<ArrayBuffer, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const it of items) {
    const page = pages[it.page];
    if (!page) continue;
    let img = cache.get(it.png);
    if (!img) { img = await doc.embedPng(it.png); cache.set(it.png, img); }
    const f = frame(page);
    const w = it.w * f.vw, h = it.h * f.vh;
    const cx = it.x * f.vw + w / 2;
    const cy = f.vh - (it.y * f.vh + h / 2);
    const [vx, vy] = originFor(cx, cy, w, h, 0);
    const [x, y] = f.toUser(vx, vy);
    page.drawImage(img, { x, y, width: w, height: h, rotate: degrees(f.angle(0)) });
  }
  return save(doc);
}

/** Visual (rotation-aware) size of every page in points. */
export async function pageSizes(input: ArrayBuffer) {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPages().map((p) => { const f = frame(p); return { w: f.vw, h: f.vh }; });
}

export type EditFont = 'helvetica' | 'times' | 'courier';
export type EditItem =
  | { type: 'text'; page: number; x: number; y: number; text: string; size: number; color: string; font: EditFont; bold: boolean }
  | { type: 'rect'; page: number; x: number; y: number; w: number; h: number; color: string; opacity: number }
  | { type: 'image'; page: number; x: number; y: number; w: number; h: number; png: ArrayBuffer };

const FONT_MAP: Record<EditFont, [StandardFonts, StandardFonts]> = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold],
};

/**
 * Add real (selectable) text, rectangles/highlights and images to pages.
 * Coordinates are fractions of the page's visual box, origin top-left.
 * Text x/y is the top-left of the first line; size is in points.
 */
export async function editPdf(input: ArrayBuffer, items: EditItem[]) {
  const doc = await load(input);
  const pages = doc.getPages();
  const fonts = new Map<string, PDFFont>();
  const font = async (f: EditFont, bold: boolean) => {
    const key = `${f}${bold}`;
    if (!fonts.has(key)) fonts.set(key, await doc.embedFont(FONT_MAP[f][bold ? 1 : 0]));
    return fonts.get(key)!;
  };
  const images = new Map<ArrayBuffer, Awaited<ReturnType<typeof doc.embedPng>>>();
  // text a standard font can't draw (Urdu, Hindi, Chinese, emoji…) → multilingual engine
  const FAMILY: Record<EditFont, TextStyle['family']> = { helvetica: 'sans', times: 'serif', courier: 'mono' };
  const helv = await font('helvetica', false);
  const uni = items.filter((it): it is Extract<EditItem, { type: 'text' }> => it.type === 'text' && !winAnsi(helv, it.text.replace(/\n/g, ' ')));
  const te = uni.length ? await TextEngine.create(doc) : null;
  if (te) await te.prepare(uni.flatMap((it) => it.text.split('\n').map((text) => ({ text, style: { family: FAMILY[it.font], bold: it.bold } }))));

  for (const it of items) {
    const page = pages[it.page];
    if (!page) continue;
    const f = frame(page);
    const rotate = degrees(f.angle(0));
    if (it.type === 'text' && te && uni.includes(it)) {
      const style: TextStyle = { family: FAMILY[it.font], bold: it.bold };
      const lineH = it.size * 1.2;
      const ascent = it.size * 0.718; // same baseline as the standard-font path and the editor preview
      it.text.split('\n').forEach((line, i) => {
        if (!line.trim()) return;
        const vx = it.x * f.vw;
        const vy = f.vh - (it.y * f.vh + (lineH - it.size) / 2 + ascent + i * lineH);
        const [x, y] = f.toUser(vx, vy);
        te.drawOnPage(page, te.shape(line, style, it.size), x, y, { color: rgbOf(it.color), rotate: f.angle(0) });
      });
    } else if (it.type === 'text') {
      const fnt = await font(it.font, it.bold);
      const lines = it.text.split('\n').map((l) => safeText(fnt, l));
      const lineH = it.size * 1.2;
      const ascent = fnt.heightAtSize(it.size, { descender: false });
      lines.forEach((line, i) => {
        const vx = it.x * f.vw;
        const vy = f.vh - (it.y * f.vh + (lineH - it.size) / 2 + ascent + i * lineH);
        const [x, y] = f.toUser(vx, vy);
        page.drawText(line, { x, y, size: it.size, font: fnt, color: hexToRgb(it.color), rotate });
      });
    } else {
      const w = it.w * f.vw, h = it.h * f.vh;
      const cx = it.x * f.vw + w / 2, cy = f.vh - (it.y * f.vh + h / 2);
      const [vx, vy] = originFor(cx, cy, w, h, 0);
      const [x, y] = f.toUser(vx, vy);
      if (it.type === 'rect') {
        page.drawRectangle({ x, y, width: w, height: h, color: hexToRgb(it.color), opacity: it.opacity, rotate });
      } else {
        let img = images.get(it.png);
        if (!img) { img = await doc.embedPng(it.png); images.set(it.png, img); }
        page.drawImage(img, { x, y, width: w, height: h, rotate });
      }
    }
  }
  return save(doc);
}

/* ---------------- Forms ---------------- */

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'button' | 'signature' | 'unknown';
export interface FieldInfo { name: string; kind: FieldKind; value: string | boolean | string[]; options?: string[]; multiline?: boolean; readOnly?: boolean; maxLength?: number; page?: number; }

export async function formFields(input: ArrayBuffer): Promise<{ fields: FieldInfo[]; hasXfa: boolean }> {
  const doc = await load(input);
  const form = doc.getForm();
  const hasXfa = !!doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict)?.get(PDFName.of('XFA'));
  const pageRefs = doc.getPages().map((p) => p.ref);
  const fields: FieldInfo[] = [];
  for (const f of form.getFields()) {
    const name = f.getName();
    const readOnly = f.isReadOnly();
    let page: number | undefined;
    try { const w = f.acroField.getWidgets()[0]; const ref = w?.P(); if (ref) { const i = pageRefs.findIndex((r) => r === ref); if (i >= 0) page = i; } } catch {}
    if (f instanceof PDFTextField) fields.push({ name, kind: 'text', value: f.getText() ?? '', multiline: f.isMultiline(), readOnly, maxLength: f.getMaxLength(), page });
    else if (f instanceof PDFCheckBox) fields.push({ name, kind: 'checkbox', value: f.isChecked(), readOnly, page });
    else if (f instanceof PDFRadioGroup) fields.push({ name, kind: 'radio', value: f.getSelected() ?? '', options: f.getOptions(), readOnly, page });
    else if (f instanceof PDFDropdown) fields.push({ name, kind: 'dropdown', value: f.getSelected()[0] ?? '', options: f.getOptions(), readOnly, page });
    else if (f instanceof PDFOptionList) fields.push({ name, kind: 'list', value: f.getSelected(), options: f.getOptions(), readOnly, page });
    else if (f instanceof PDFSignature) fields.push({ name, kind: 'signature', value: '', readOnly: true, page });
    else if (f instanceof PDFButton) fields.push({ name, kind: 'button', value: '', readOnly: true, page });
    else fields.push({ name, kind: 'unknown', value: '', readOnly: true, page });
  }
  return { fields, hasXfa };
}

/** Fill AcroForm fields. Text in any script is supported: values a standard font can't draw get their own appearance. */
export async function fillForm(input: ArrayBuffer, values: Record<string, string | boolean | string[]>, flatten: boolean) {
  const doc = await load(input);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bad: string[] = [];
  const uni: { f: PDFTextField; text: string }[] = [];
  for (const [name, v] of Object.entries(values)) {
    let f;
    try { f = form.getField(name); } catch { continue; }
    if (f.isReadOnly()) continue;
    try {
      if (f instanceof PDFTextField) {
        const max = f.getMaxLength();
        const text = String(v ?? '');
        const val = max ? [...text].slice(0, max).join('') : text;
        f.setText(val);
        if (!winAnsi(font, val.replace(/\r?\n/g, ' '))) uni.push({ f, text: val });
      } else if (f instanceof PDFCheckBox) { v ? f.check() : f.uncheck(); }
      else if (f instanceof PDFRadioGroup) { if (v) f.select(String(v)); }
      else if (f instanceof PDFDropdown) { if (v) f.select(String(v)); else f.clear(); }
      else if (f instanceof PDFOptionList) { const arr = Array.isArray(v) ? v : [String(v)]; if (arr.length) f.select(arr.filter(Boolean)); else f.clear(); }
    } catch { bad.push(name); }
  }
  if (uni.length) {
    const te = await TextEngine.create(doc);
    await te.prepare(uni.flatMap((u) => u.text.split(/\r?\n/).map((text) => ({ text }))).concat(uni.map((u) => ({ text: u.text.replace(/\r?\n/g, ' ') }))));
    for (const u of uni) {
      try { unicodeAppearance(doc, te, u.f, u.text); form.markFieldAsClean(u.f.ref); }
      catch { bad.push(u.f.getName()); }
    }
  }
  form.updateFieldAppearances(font);
  if (flatten) form.flatten({ updateFieldAppearances: false });
  return { bytes: await save(doc), bad };
}

/** Appearance stream for a text field whose value needs the multilingual engine (Urdu, Hindi, Chinese…). */
function unicodeAppearance(doc: PDFDocument, te: TextEngine, field: PDFTextField, text: string) {
  const da = field.acroField.getDefaultAppearance() ?? '';
  const daSize = Number(/([\d.]+)\s+Tf/.exec(da)?.[1] ?? 0);
  const gray = /([\d.]+)\s+g\b/.exec(da), rgbm = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg\b/.exec(da);
  const color: [number, number, number] = rgbm ? [+rgbm[1], +rgbm[2], +rgbm[3]] : gray ? [+gray[1], +gray[1], +gray[1]] : [0, 0, 0];
  const multiline = field.isMultiline();
  const align = field.getAlignment();
  for (const w of field.acroField.getWidgets()) {
    const r = w.getRectangle();
    const pad = 2, innerW = Math.max(4, r.width - pad * 2);
    // DA size (0 = auto), shrunk until the text fits the box
    let size = daSize || (multiline ? 12 : Math.min(r.height * 0.7, 14));
    let lines: string[];
    if (multiline) {
      size = Math.min(size, Math.max(4, (r.height - pad * 2) / 1.2));
      lines = wrapLines(te, text, {}, size, innerW);
      while (size > 4 && lines.length * size * 1.2 > r.height - pad * 2) { size = Math.max(4, size * 0.9); lines = wrapLines(te, text, {}, size, innerW); }
    } else {
      lines = [text.replace(/\r?\n/g, ' ')];
      size = Math.min(size, Math.max(4, r.height * 0.8));
      const w0 = te.measure(lines[0], {}, size);
      if (w0 > innerW) size = Math.max(4, (size * innerW) / w0);
    }
    const fonts = new Map<PDFFont, string>(), imgs = new Map<any, string>();
    const key: Keyer = {
      font: (f) => { let n = fonts.get(f); if (!n) { n = `F${fonts.size}`; fonts.set(f, n); } return PDFName.of(n); },
      image: (i) => { let n = imgs.get(i); if (!n) { n = `I${imgs.size}`; imgs.set(i, n); } return PDFName.of(n); },
    };
    const ops = lines.flatMap((ln, i) => {
      if (!ln.trim()) return [];
      const sh = te.shape(ln, {}, size);
      const rtl = sh.pieces.some((p) => p.level % 2 === 1) && /[\u0590-\u08FF\uFB1D-\uFEFF]/.test(ln);
      const x = align === TextAlignment.Center ? (r.width - sh.width) / 2
        : align === TextAlignment.Right || rtl ? r.width - pad - sh.width : pad;
      const y = multiline ? r.height - pad - size * 0.9 - i * size * 1.2 : (r.height - size) / 2 + size * 0.22;
      return te.ops(sh, x, y, { color, key });
    });
    const Font: Record<string, PDFRef> = {}, XObject: Record<string, PDFRef> = {};
    for (const [f, n] of fonts) Font[n] = f.ref;
    for (const [im, n] of imgs) XObject[n] = im.ref;
    const stream = doc.context.formXObject(ops, { BBox: [0, 0, r.width, r.height], Resources: { Font, XObject } });
    w.setNormalAppearance(doc.context.register(stream));
  }
}

/* ---------------- Repair ---------------- */

/** Lossless rebuild: re-parse leniently and write a fresh cross-reference table. */
export async function rebuild(input: ArrayBuffer) {
  const doc = await PDFDocument.load(input, { ignoreEncryption: false, throwOnInvalidObject: false, updateMetadata: false });
  const pages = doc.getPageCount();
  if (!pages) throw new Error('No pages found');
  return { bytes: await doc.save({ useObjectStreams: false }), pages };
}

/* ---------------- Crop ---------------- */

/** A box in visual page space, as fractions of the visible page (origin top-left). */
export interface FracBox { x: number; y: number; w: number; h: number; }

/** Crop pages to a box. `boxes[i]` applies to page i; null/undefined leaves the page unchanged. */
export async function cropPdf(input: ArrayBuffer, boxes: (FracBox | null | undefined)[]) {
  const doc = await load(input);
  doc.getPages().forEach((page, i) => {
    const b = boxes[i];
    if (!b) return;
    const f = frame(page);
    const [x1, y1] = f.toUser(b.x * f.vw, f.vh - b.y * f.vh);
    const [x2, y2] = f.toUser((b.x + b.w) * f.vw, f.vh - (b.y + b.h) * f.vh);
    const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    if (w < 1 || h < 1) return;
    page.setMediaBox(x, y, w, h);
    page.setCropBox(x, y, w, h);
    page.setTrimBox(x, y, w, h);
    page.setBleedBox(x, y, w, h);
    page.setArtBox(x, y, w, h);
  });
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/* ---------------- Redact ---------------- */

export interface FlatPage { index: number; jpeg: ArrayBuffer; w: number; h: number; }

/**
 * True redaction: pages in `flat` are replaced by an image of the page (already blacked out by the caller).
 * The result is built in a fresh document so the original content of those pages is not carried over,
 * and links on other pages that point at a redacted page are dropped (they would otherwise drag it along).
 */
export async function redactPages(input: ArrayBuffer, flat: FlatPage[], stripInfo: boolean) {
  const src = await load(input);
  const out = await PDFDocument.create();
  const pages = src.getPages();
  const byIndex = new Map(flat.map((p) => [p.index, p]));
  const redactedRefs = new Set(flat.map((p) => pages[p.index]?.ref.toString()));
  const pointsAtRedacted = (v: unknown): boolean => {
    const arr = v as { asArray?: () => unknown[] };
    const first = arr?.asArray?.()[0] as { toString(): string } | undefined;
    return !!first && redactedRefs.has(first.toString());
  };

  for (let i = 0; i < pages.length; i++) {
    const r = byIndex.get(i);
    if (r) {
      const img = await out.embedJpg(r.jpeg);
      const pg = out.addPage([r.w, r.h]);
      pg.drawImage(img, { x: 0, y: 0, width: r.w, height: r.h });
      continue;
    }
    const page = pages[i];
    const annots = page.node.Annots();
    if (annots) {
      const keep = annots.asArray().filter((ref) => {
        const a = src.context.lookup(ref);
        if (!(a instanceof PDFDict)) return true;
        if (pointsAtRedacted(a.get(PDFName.of('Dest')))) return false;
        const act = a.lookup(PDFName.of('A'));
        if (act instanceof PDFDict && pointsAtRedacted(act.get(PDFName.of('D')))) return false;
        return true;
      });
      page.node.set(PDFName.of('Annots'), src.context.obj(keep));
    }
    const [copy] = await out.copyPages(src, [i]);
    out.addPage(copy);
  }
  if (!stripInfo) {
    const t = src.getTitle(); if (t) out.setTitle(t);
    const a = src.getAuthor(); if (a) out.setAuthor(a);
  }
  out.setProducer('PDFSherpa');
  out.setCreator('PDFSherpa');
  return save(out);
}

/* ---------------- Resize page size ---------------- */

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28] } as const;
export type PageSizeName = keyof typeof PAGE_SIZES;
export interface ResizeOpts { size: PageSizeName; orientation: 'auto' | 'portrait' | 'landscape'; margin: number; }

/**
 * Put every page on a new sheet size, scaled to fit and centred. Pages are embedded as vector
 * Form XObjects, so text stays sharp and selectable. Rotated pages come out upright.
 */
export async function resizePages(input: ArrayBuffer, o: ResizeOpts) {
  const src = await load(input);
  const out = await PDFDocument.create();
  const srcPages = src.getPages();
  const embedded = await out.embedPages(srcPages);
  srcPages.forEach((page, i) => {
    const f = frame(page);
    const r = ((page.getRotation().angle % 360) + 360) % 360;
    let [pw, ph] = PAGE_SIZES[o.size] as readonly [number, number];
    const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && f.vw > f.vh);
    if (landscape) [pw, ph] = [ph, pw];
    const s = Math.min((pw - 2 * o.margin) / f.vw, (ph - 2 * o.margin) / f.vh);
    const vw = f.vw * s, vh = f.vh * s;
    const ox = (pw - vw) / 2, oy = (ph - vh) / 2; // bottom-left of the upright, scaled page
    const { width: W, height: H } = page.getCropBox();
    const w = W * s, h = H * s;
    // drawPage rotates counter-clockwise around (x, y); /Rotate turns pages clockwise
    const pos: Record<number, [number, number]> = { 0: [ox, oy], 90: [ox, oy + vh], 180: [ox + w, oy + h], 270: [ox + vw, oy] };
    const [x, y] = pos[r] ?? pos[0];
    const pg = out.addPage([pw, ph]);
    pg.drawPage(embedded[i], { x, y, width: w, height: h, rotate: degrees(-r) });
  });
  out.setProducer('PDFSherpa');
  return save(out);
}

/* ---------------- Flatten ---------------- */

/**
 * Flatten form fields and (optionally) comments/markup into the page content, so they can't be
 * edited and look the same in every viewer. Link annotations are kept so links still work.
 */
export async function flattenPdf(input: ArrayBuffer, opts: { forms: boolean; annotations: boolean }) {
  const doc = await load(input);
  let fields = 0, annots = 0;
  if (opts.forms) {
    const form = doc.getForm();
    fields = form.getFields().length;
    if (fields) form.flatten({ updateFieldAppearances: true });
  }
  if (opts.annotations) {
    for (const page of doc.getPages()) {
      const arr = page.node.Annots();
      if (!arr) continue;
      const keep: unknown[] = [];
      for (let i = 0; i < arr.size(); i++) {
        const ref = arr.get(i);
        const a = doc.context.lookup(ref);
        if (!(a instanceof PDFDict)) continue;
        const sub = a.get(PDFName.of('Subtype'))?.toString();
        if (sub === '/Link' || sub === '/Widget') { keep.push(ref); continue; }
        if (sub === '/Popup') continue;
        const flags = (a.lookup(PDFName.of('F')) as PDFNumber | undefined)?.asNumber?.() ?? 0;
        if (flags & 2) continue; // hidden
        const ap = a.lookup(PDFName.of('AP'));
        const nRef = ap instanceof PDFDict ? ap.get(PDFName.of('N')) : undefined;
        const n = nRef instanceof PDFRef ? doc.context.lookup(nRef) : nRef;
        const rect = (a.lookup(PDFName.of('Rect')) as PDFArray | undefined)?.asRectangle?.();
        if (!(n instanceof PDFStream) || !rect || !(nRef instanceof PDFRef)) continue; // no appearance → drop
        const bbox = (n.dict.lookup(PDFName.of('BBox')) as PDFArray | undefined)?.asRectangle?.() ?? { x: 0, y: 0, width: rect.width, height: rect.height };
        const sx = bbox.width ? rect.width / bbox.width : 1, sy = bbox.height ? rect.height / bbox.height : 1;
        const name = page.node.newXObject('FlatAnnot', nRef);
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, rect.x - bbox.x * sx, rect.y - bbox.y * sy), drawObject(name), popGraphicsState());
        annots++;
      }
      if (keep.length) page.node.set(PDFName.of('Annots'), doc.context.obj(keep as never[]));
      else page.node.delete(PDFName.of('Annots'));
    }
  }
  doc.setProducer('PDFSherpa');
  return { bytes: await save(doc), fields, annots };
}

/* ---------------- Header & footer ---------------- */

export interface HeaderFooterOpts {
  header: [string, string, string]; // left, centre, right
  footer: [string, string, string];
  fontSize: number;
  color: string;
  start: number;
  skipFirst: boolean;
  fileName: string;
  date: string;
}

/** Text in the six header/footer slots. Tokens: [page], [pages], [date], [file]. */
export async function headerFooter(input: ArrayBuffer, o: HeaderFooterOpts) {
  const doc = await load(input);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = o.start + pages.length - (o.skipFirst ? 1 : 0) - 1;
  const fill = (raw: string, n: number) => raw.replace(/\[page\]/gi, String(n)).replace(/\[pages\]/gi, String(total)).replace(/\[date\]/gi, o.date).replace(/\[file\]/gi, o.fileName);
  // non-Latin text (Urdu, Hindi, Chinese…) → multilingual engine; strings differ per page, so prepare them all
  const all: string[] = [];
  pages.forEach((_, i) => { if (!(o.skipFirst && i === 0)) for (const raw of [...o.header, ...o.footer]) if (raw.trim()) all.push(fill(raw, o.start + i - (o.skipFirst ? 1 : 0))); });
  const te = all.some((t) => !winAnsi(font, t)) ? await TextEngine.create(doc) : null;
  if (te) await te.prepare(all.map((text) => ({ text })));
  pages.forEach((page, i) => {
    if (o.skipFirst && i === 0) return;
    const n = o.start + i - (o.skipFirst ? 1 : 0);
    const f = frame(page);
    const margin = Math.max(18, Math.min(f.vw, f.vh) * 0.04);
    const h = font.heightAtSize(o.fontSize, { descender: false });
    const slots: [string, Exclude<Position, 'center' | 'tile'>][] = [
      [o.header[0], 'top-left'], [o.header[1], 'top-center'], [o.header[2], 'top-right'],
      [o.footer[0], 'bottom-left'], [o.footer[1], 'bottom-center'], [o.footer[2], 'bottom-right'],
    ];
    for (const [raw, pos] of slots) {
      if (!raw.trim()) continue;
      const text = fill(raw, n);
      const sh = te && !winAnsi(font, text) ? te.shape(text, {}, o.fontSize) : null;
      const w = sh ? sh.width : font.widthOfTextAtSize(text, o.fontSize);
      const [cx, cy] = anchor(pos, f, w, h, margin);
      const [vx, vy] = originFor(cx, cy, w, h, 0);
      const [x, y] = f.toUser(vx, vy);
      if (sh) te!.drawOnPage(page, sh, x, y, { color: rgbOf(o.color), rotate: f.angle(0) });
      else page.drawText(safeText(font, text), { x, y, size: o.fontSize, font, color: hexToRgb(o.color), rotate: degrees(f.angle(0)) });
    }
  });
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/* ---------------- OCR → searchable PDF ---------------- */

export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number; }
export interface OcrPage { jpeg: ArrayBuffer; w: number; h: number; imgW: number; imgH: number; words: OcrWord[]; }

/**
 * Page image + an invisible text layer placed over each recognised word, so the PDF can be
 * searched, selected and copied. Words are stretched horizontally to match their box.
 */
export async function searchablePdf(pages: OcrPage[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // words a standard font can't encode (Urdu, Hindi…) are placed with the multilingual engine
  const uniWords = pages.flatMap((p) => p.words.map((w) => w.text.trim())).filter((t) => t && !winAnsi(font, t));
  const te = uniWords.length ? await TextEngine.create(doc) : null;
  if (te) await te.prepare(uniWords.map((text) => ({ text })));
  for (const p of pages) {
    const img = await doc.embedJpg(p.jpeg);
    const page = doc.addPage([p.w, p.h]);
    page.drawImage(img, { x: 0, y: 0, width: p.w, height: p.h });
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    const sx = p.w / p.imgW, sy = p.h / p.imgH;
    const ops = [beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const wd of p.words) {
      const raw = wd.text.trim();
      if (!raw) continue;
      const boxW = (wd.x1 - wd.x0) * sx, boxH = (wd.y1 - wd.y0) * sy;
      if (boxW <= 0 || boxH <= 0) continue;
      const size = Math.max(1, boxH * 0.9);
      if (te && !winAnsi(font, raw)) {
        const sh = te.shape(raw, {}, size);
        if (sh.width > 0) te.drawOnPage(page, sh, wd.x0 * sx, p.h - wd.y1 * sy + boxH * 0.15, { invisible: true, scaleX: Math.max(0.1, Math.min(4, boxW / sh.width)) });
        continue;
      }
      const text = safeText(font, raw);
      const natural = font.widthOfTextAtSize(text, size);
      const squeeze = natural > 0 ? Math.max(10, Math.min(400, (boxW / natural) * 100)) : 100;
      ops.push(setFontAndSize(fontKey, size), setCharacterSqueeze(squeeze), setTextMatrix(1, 0, 0, 1, wd.x0 * sx, p.h - wd.y1 * sy + boxH * 0.15), showText(font.encodeText(text)));
    }
    ops.push(endText());
    page.pushOperators(...ops);
  }
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/* ---------------- Page order: alternate merge, blank pages ---------------- */

/**
 * Interleave two scans (fronts + backs) into one document: A1, B1, A2, B2…
 * With `b` null, the single input holds all fronts followed by all backs.
 * `reverseB`: the backs were scanned last page first (usual when the stack is flipped over).
 */
export async function alternateMerge(a: ArrayBuffer, b: ArrayBuffer | null, reverseB: boolean) {
  const out = await PDFDocument.create();
  const docA = await load(a);
  const docB = b ? await load(b) : docA;
  let ia = docA.getPageIndices(), ib = b ? docB.getPageIndices() : [];
  if (!b) { const half = Math.ceil(ia.length / 2); ib = ia.slice(half); ia = ia.slice(0, half); }
  if (reverseB) ib.reverse();
  const pa = await out.copyPages(docA, ia);
  const pb = await out.copyPages(docB, ib);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { if (pa[i]) out.addPage(pa[i]); if (pb[i]) out.addPage(pb[i]); }
  return save(out);
}

export interface BlankInsert { /** insert after this 0-based page; -1 = before the first page */ after: number; count: number; }

/** Insert empty pages. size 'match' copies the neighbouring page's size and orientation. */
export async function insertBlankPages(input: ArrayBuffer, inserts: BlankInsert[], size: 'match' | PageSizeName) {
  const doc = await load(input);
  const n = doc.getPageCount();
  const sizes = doc.getPages().map((p) => { const f = frame(p); return [f.vw, f.vh] as [number, number]; });
  // from the end, so earlier indexes stay valid
  const list = inserts.filter((x) => x.count > 0 && x.after >= -1 && x.after < n).sort((x, y) => y.after - x.after);
  let added = 0;
  for (const ins of list) {
    const ref = sizes[Math.max(0, ins.after)] ?? [595.28, 841.89];
    const dims: [number, number] = size === 'match' ? ref : PAGE_SIZES[size] as [number, number];
    // keep the neighbour's orientation for standard sizes too
    const [w, h] = size !== 'match' && ref[0] > ref[1] ? [Math.max(...dims), Math.min(...dims)] : size !== 'match' ? [Math.min(...dims), Math.max(...dims)] : dims;
    for (let k = 0; k < Math.min(ins.count, 500); k++) { doc.insertPage(ins.after + 1, [w, h]); added++; }
  }
  return { bytes: await save(doc), added };
}

/* ---------------- Metadata ---------------- */

export interface PdfMeta { title: string; author: string; subject: string; keywords: string; creator: string; producer: string; created: string | null; modified: string | null; hasXmp: boolean; }

export async function readMetadata(input: ArrayBuffer): Promise<PdfMeta> {
  const doc = await load(input);
  const iso = (d: Date | undefined) => (d && !isNaN(+d) ? d.toISOString() : null);
  let created: Date | undefined, modified: Date | undefined;
  try { created = doc.getCreationDate(); } catch { /* malformed date */ }
  try { modified = doc.getModificationDate(); } catch { /* malformed date */ }
  const safe = (f: () => string | undefined) => { try { return f() ?? ''; } catch { return ''; } };
  return {
    title: safe(() => doc.getTitle()), author: safe(() => doc.getAuthor()), subject: safe(() => doc.getSubject()),
    keywords: safe(() => doc.getKeywords()), creator: safe(() => doc.getCreator()), producer: safe(() => doc.getProducer()),
    created: iso(created), modified: iso(modified), hasXmp: !!doc.catalog.get(PDFName.of('Metadata')),
  };
}

export interface MetaEdit { title: string; author: string; subject: string; keywords: string; creator: string; producer: string; created: string | null; modified: string | null; }

/**
 * Write document properties. Empty strings and null dates remove the entry.
 * The XMP packet (which can hold an older copy of the same fields) is dropped so viewers show the new values.
 */
export async function writeMetadata(input: ArrayBuffer, m: MetaEdit) {
  const doc = await load(input);
  const info: PDFDict = (doc as any).getInfoDict();
  const set = (key: string, v: string, apply: (s: string) => void) => { if (v.trim()) apply(v.trim()); else info.delete(PDFName.of(key)); };
  set('Title', m.title, (s) => doc.setTitle(s, { showInWindowTitleBar: true }));
  set('Author', m.author, (s) => doc.setAuthor(s));
  set('Subject', m.subject, (s) => doc.setSubject(s));
  set('Keywords', m.keywords, (s) => doc.setKeywords(s.split(/\s*[,;]\s*/).filter(Boolean)));
  set('Creator', m.creator, (s) => doc.setCreator(s));
  set('Producer', m.producer, (s) => doc.setProducer(s));
  const date = (key: string, v: string | null, apply: (d: Date) => void) => { const d = v ? new Date(v) : null; if (d && !isNaN(+d)) apply(d); else info.delete(PDFName.of(key)); };
  date('CreationDate', m.created, (d) => doc.setCreationDate(d));
  date('ModDate', m.modified, (d) => doc.setModificationDate(d));
  if (!m.title.trim()) { const vp = doc.catalog.lookup(PDFName.of('ViewerPreferences')); if (vp instanceof PDFDict) vp.delete(PDFName.of('DisplayDocTitle')); }
  doc.catalog.delete(PDFName.of('Metadata'));
  return save(doc);
}

/* ---------------- Drawing in a page's visual space ---------------- */

/** Affine map from visual space (what the reader sees, y up, origin bottom-left) to user space. */
function visualMatrix(page: PDFPage): [number, number, number, number, number, number] {
  const f = frame(page);
  const [ex, ey] = f.toUser(0, 0), [ax, ay] = f.toUser(1, 0), [cx, cy] = f.toUser(0, 1);
  return [ax - ex, ay - ey, cx - ex, cy - ey, ex, ey];
}
const applyM = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Keyer that registers fonts, images and graphics states on a form XObject's resource dictionary. */
function dictKeyer(doc: PDFDocument, res: PDFDict): Keyer & { gs(o: { ca?: number; CA?: number; BM?: string }): PDFName } {
  const sub = (k: string) => { let d = res.lookup(PDFName.of(k)); if (!(d instanceof PDFDict)) { d = doc.context.obj({}); res.set(PDFName.of(k), d as PDFDict); } return d as PDFDict; };
  let i = 0;
  const add = (k: string, prefix: string, ref: PDFRef | PDFDict) => { const name = PDFName.of(`${prefix}${++i}`); sub(k).set(name, ref); return name; };
  const fonts = new Map<PDFFont, PDFName>(), imgs = new Map<unknown, PDFName>();
  return {
    font: (f) => { let n = fonts.get(f); if (!n) { n = add('Font', 'F', f.ref); fonts.set(f, n); } return n; },
    image: (im) => { let n = imgs.get(im); if (!n) { n = add('XObject', 'Im', im.ref); imgs.set(im, n); } return n; },
    gs: (o) => add('ExtGState', 'GS', doc.context.obj({ ...(o.ca !== undefined ? { ca: o.ca } : {}), ...(o.CA !== undefined ? { CA: o.CA } : {}), ...(o.BM ? { BM: o.BM } : {}) })),
  };
}

/* ---------------- Stamps ---------------- */

export interface StampSpec {
  page: number;
  /** centre of the stamp, fractions of the visual page, origin top-left */
  cx: number; cy: number;
  /** stamp width as a fraction of the page width */
  w: number;
  text: string; sub: string;
  color: string; angle: number; opacity: number;
  shape: 'rect' | 'round' | 'oval';
}

/** Rubber-stamp marks (APPROVED, PAID…) drawn as vector graphics with real, selectable text. */
export async function stampPdf(input: ArrayBuffer, stamps: StampSpec[]) {
  const doc = await load(input);
  const pages = doc.getPages();
  const te = await TextEngine.create(doc);
  await te.prepare(stamps.flatMap((s) => [{ text: s.text, style: { bold: true } }, { text: s.sub, style: { bold: true } }]).filter((x) => x.text.trim()));
  for (const s of stamps) {
    const page = pages[s.page];
    if (!page || !s.text.trim()) continue;
    const f = frame(page);
    const W = s.w * f.vw;
    const ops = stampOps(te, s, W, pageKeyer(page));
    const gs = s.opacity < 1 ? page.node.newExtGState('GS', doc.context.obj({ ca: s.opacity, CA: s.opacity })) : null;
    const [a, b, c, d, e, g] = visualMatrix(page);
    const rad = (s.angle * Math.PI) / 180;
    const vx = s.cx * f.vw, vy = f.vh - s.cy * f.vh;
    page.pushOperators(pushGraphicsState(), ...(gs ? [setGraphicsState(gs)] : []), concatTransformationMatrix(a, b, c, d, e, g),
      concatTransformationMatrix(Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), vx, vy), ...ops, popGraphicsState());
  }
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/** A stamp centred on (0, 0), `W` points wide. */
function stampOps(te: TextEngine, s: StampSpec, W: number, key: Keyer): PDFOperator[] {
  const col = rgbOf(s.color);
  const main = s.text.trim(), sub = s.sub.trim();
  const style = { bold: true };
  // main text fills ~84% of the width; the second line is a third of its size
  const probe = te.measure(main, style, 100) || 100;
  let size = (W * 0.84 * 100) / probe;
  const subSize0 = size * 0.32;
  const subW = sub ? te.measure(sub, style, subSize0) : 0;
  const subSize = sub && subW > W * 0.84 ? (subSize0 * W * 0.84) / subW : subSize0;
  const H = size * 1.25 + (sub ? subSize * 1.5 : 0);
  const lw = Math.max(1.2, size * 0.07);
  const o: PDFOperator[] = [setStrokingRgbColor(...col), setFillingRgbColor(...col), setLineWidth(lw)];
  const box = (inset: number) => {
    const w = W / 2 - inset, h = H / 2 - inset;
    if (s.shape === 'oval') {
      const k = 0.5523;
      o.push(moveTo(w, 0), appendBezierCurve(w, h * k, w * k, h, 0, h), appendBezierCurve(-w * k, h, -w, h * k, -w, 0), appendBezierCurve(-w, -h * k, -w * k, -h, 0, -h), appendBezierCurve(w * k, -h, w, -h * k, w, 0), closePath(), stroke());
    } else if (s.shape === 'round') {
      const r = Math.min(h, w) * 0.35, k = 0.5523 * r;
      o.push(moveTo(-w + r, -h), lineTo(w - r, -h), appendBezierCurve(w - r + k, -h, w, -h + r - k, w, -h + r), lineTo(w, h - r), appendBezierCurve(w, h - r + k, w - r + k, h, w - r, h), lineTo(-w + r, h), appendBezierCurve(-w + r - k, h, -w, h - r + k, -w, h - r), lineTo(-w, -h + r), appendBezierCurve(-w, -h + r - k, -w + r - k, -h, -w + r, -h), closePath(), stroke());
    } else o.push(rectangle(-w, -h, w * 2, h * 2), stroke());
  };
  box(lw / 2);
  o.push(setLineWidth(lw * 0.45));
  box(lw * 2.2);
  if (s.shape === 'oval') { size *= 0.82; }
  const mainSh = te.shape(main, style, size);
  const top = H / 2 - (H - (mainSh.ascent * 0.92 + (sub ? subSize * 1.5 : 0))) / 2;
  o.push(...te.ops(mainSh, -mainSh.width / 2, top - mainSh.ascent * 0.92, { color: col, key }));
  if (sub) {
    const sh = te.shape(sub, style, subSize);
    o.push(...te.ops(sh, -sh.width / 2, top - mainSh.ascent * 0.92 - subSize * 1.3, { color: col, key }));
  }
  return o;
}

/* ---------------- Images on pages ---------------- */

export interface ImagePlacement {
  pages: number[];
  /** box in visual space, fractions, origin top-left */
  x: number; y: number; w: number; h: number;
  png: ArrayBuffer; opacity: number;
  /** JPEG photos are embedded as JPEG (much smaller than PNG) */
  type?: 'png' | 'jpg';
}

/** Place images (logos, photos, signatures) on one or many pages, upright on rotated pages. */
export async function placeImages(input: ArrayBuffer, items: ImagePlacement[]) {
  const doc = await load(input);
  const pages = doc.getPages();
  for (const it of items) {
    const img = it.type === 'jpg' ? await doc.embedJpg(it.png) : await doc.embedPng(it.png);
    for (const p of it.pages) {
      const page = pages[p];
      if (!page) continue;
      const f = frame(page);
      const w = it.w * f.vw, h = it.h * f.vh;
      const name = page.node.newXObject('Img', img.ref);
      const gs = it.opacity < 1 ? page.node.newExtGState('GS', doc.context.obj({ ca: it.opacity, CA: it.opacity })) : null;
      const [a, b, c, d, e, g] = visualMatrix(page);
      page.pushOperators(pushGraphicsState(), ...(gs ? [setGraphicsState(gs)] : []), concatTransformationMatrix(a, b, c, d, e, g),
        concatTransformationMatrix(w, 0, 0, h, it.x * f.vw, f.vh - it.y * f.vh - h), drawObject(name), popGraphicsState());
    }
  }
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/* ---------------- Annotations (real PDF comments) ---------------- */

/** Points are fractions of the visual page, origin top-left. */
export type Annot =
  | { kind: 'highlight' | 'underline' | 'strike'; page: number; color: string; quads: { x: number; y: number; w: number; h: number }[]; note?: string }
  | { kind: 'ink'; page: number; color: string; width: number; paths: [number, number][][] }
  | { kind: 'square' | 'circle'; page: number; color: string; width: number; x: number; y: number; w: number; h: number; note?: string }
  | { kind: 'arrow'; page: number; color: string; width: number; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'text'; page: number; color: string; size: number; x: number; y: number; w: number; h: number; text: string }
  | { kind: 'note'; page: number; color: string; x: number; y: number; text: string };

const SUBTYPE: Record<Annot['kind'], string> = { highlight: 'Highlight', underline: 'Underline', strike: 'StrikeOut', ink: 'Ink', square: 'Square', circle: 'Circle', arrow: 'Line', text: 'FreeText', note: 'Text' };

/**
 * Add standard PDF annotations with appearance streams, so they look the same everywhere and stay
 * editable as comments in Acrobat, Preview, Edge and other readers.
 */
export async function annotatePdf(input: ArrayBuffer, annots: Annot[], author: string) {
  const doc = await load(input);
  const ctx = doc.context;
  const pages = doc.getPages();
  const texts = annots.filter((a): a is Extract<Annot, { kind: 'text' }> => a.kind === 'text');
  const te = await TextEngine.create(doc);
  if (texts.length) await te.prepare(texts.flatMap((t) => t.text.split('\n').map((text) => ({ text }))));
  const now = new Date();
  const pdfDate = `D:${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`;
  const str = (s: string) => PDFHexString.fromText(s);
  for (const an of annots) {
    const page = pages[an.page];
    if (!page) continue;
    const f = frame(page);
    const m = visualMatrix(page);
    const V = (x: number, y: number): [number, number] => [x * f.vw, f.vh - y * f.vh]; // fraction → visual pt
    const col = rgbOf(an.color);
    const res = ctx.obj({}) as PDFDict;
    const key = dictKeyer(doc, res);
    const o: PDFOperator[] = [];
    let bbox: [number, number, number, number];
    const extra: Record<string, unknown> = {};
    const toUserPts = (pts: [number, number][]) => pts.flatMap(([x, y]) => applyM(m, x, y));
    switch (an.kind) {
      case 'highlight': case 'underline': case 'strike': {
        const quads = an.quads.map((q) => { const [x0, y1] = V(q.x, q.y), [x1, y0] = V(q.x + q.w, q.y + q.h); return { x0, y0, x1, y1 }; });
        if (!quads.length) continue;
        bbox = [Math.min(...quads.map((q) => q.x0)), Math.min(...quads.map((q) => q.y0)), Math.max(...quads.map((q) => q.x1)), Math.max(...quads.map((q) => q.y1))];
        // QuadPoints order: top-left, top-right, bottom-left, bottom-right (visual, mapped to user space)
        extra.QuadPoints = quads.flatMap((q) => toUserPts([[q.x0, q.y1], [q.x1, q.y1], [q.x0, q.y0], [q.x1, q.y0]]));
        if (an.kind === 'highlight') {
          o.push(setGraphicsState(key.gs({ ca: 1, BM: 'Multiply' })), setFillingRgbColor(...col));
          for (const q of quads) o.push(rectangle(q.x0, q.y0, q.x1 - q.x0, q.y1 - q.y0));
          o.push(fill());
        } else {
          o.push(setStrokingRgbColor(...col));
          for (const q of quads) {
            const h = q.y1 - q.y0, y = an.kind === 'underline' ? q.y0 + h * 0.08 : q.y0 + h * 0.45;
            o.push(setLineWidth(Math.max(0.6, h * 0.07)), moveTo(q.x0, y), lineTo(q.x1, y), stroke());
          }
        }
        break;
      }
      case 'ink': {
        const paths = an.paths.map((p) => p.map(([x, y]) => V(x, y))).filter((p) => p.length);
        if (!paths.length) continue;
        const all = paths.flat();
        const pad = an.width;
        bbox = [Math.min(...all.map((p) => p[0])) - pad, Math.min(...all.map((p) => p[1])) - pad, Math.max(...all.map((p) => p[0])) + pad, Math.max(...all.map((p) => p[1])) + pad];
        extra.InkList = paths.map((p) => toUserPts(p));
        extra.BS = { W: an.width, S: PDFName.of('S') };
        o.push(setStrokingRgbColor(...col), setLineWidth(an.width), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round));
        for (const p of paths) {
          o.push(moveTo(p[0][0], p[0][1]));
          if (p.length === 1) o.push(lineTo(p[0][0] + 0.01, p[0][1]));
          for (let i = 1; i < p.length; i++) o.push(lineTo(p[i][0], p[i][1]));
          o.push(stroke());
        }
        break;
      }
      case 'square': case 'circle': {
        const [x0, y1] = V(an.x, an.y), [x1, y0] = V(an.x + an.w, an.y + an.h);
        const hw = an.width / 2;
        bbox = [x0 - hw, y0 - hw, x1 + hw, y1 + hw];
        extra.BS = { W: an.width, S: PDFName.of('S') };
        o.push(setStrokingRgbColor(...col), setLineWidth(an.width));
        if (an.kind === 'square') o.push(rectangle(x0, y0, x1 - x0, y1 - y0), stroke());
        else {
          const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2, cx = x0 + rx, cy = y0 + ry, k = 0.5523;
          o.push(moveTo(cx + rx, cy), appendBezierCurve(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry), appendBezierCurve(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy), appendBezierCurve(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry), appendBezierCurve(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy), closePath(), stroke());
        }
        break;
      }
      case 'arrow': {
        const [x1, y1] = V(an.x1, an.y1), [x2, y2] = V(an.x2, an.y2);
        const L = Math.max(6, an.width * 4), ang = Math.atan2(y2 - y1, x2 - x1);
        const h1: [number, number] = [x2 - L * Math.cos(ang - 0.45), y2 - L * Math.sin(ang - 0.45)], h2: [number, number] = [x2 - L * Math.cos(ang + 0.45), y2 - L * Math.sin(ang + 0.45)];
        const xs = [x1, x2, h1[0], h2[0]], ys = [y1, y2, h1[1], h2[1]];
        bbox = [Math.min(...xs) - an.width, Math.min(...ys) - an.width, Math.max(...xs) + an.width, Math.max(...ys) + an.width];
        extra.L = toUserPts([[x1, y1], [x2, y2]]);
        extra.LE = [PDFName.of('None'), PDFName.of('ClosedArrow')];
        extra.IC = col;
        extra.BS = { W: an.width, S: PDFName.of('S') };
        o.push(setStrokingRgbColor(...col), setFillingRgbColor(...col), setLineWidth(an.width), setLineCap(LineCapStyle.Round),
          moveTo(x1, y1), lineTo(x2 - (L * 0.8) * Math.cos(ang), y2 - (L * 0.8) * Math.sin(ang)), stroke(),
          moveTo(x2, y2), lineTo(...h1), lineTo(...h2), closePath(), fill());
        break;
      }
      case 'text': {
        const [x0, y1] = V(an.x, an.y), [x1, y0] = V(an.x + an.w, an.y + an.h);
        bbox = [x0, y0, x1, y1];
        const lineH = an.size * 1.2;
        let y = y1 - an.size * 0.95;
        const lines = an.text.split('\n').flatMap((l) => wrapLines(te, l, {}, an.size, Math.max(10, x1 - x0 - 4)));
        o.push(rectangle(x0, y0, x1 - x0, y1 - y0), clip(), endPath());
        for (const line of lines) { if (line.trim()) o.push(...te.ops(te.shape(line, {}, an.size), x0 + 2, y, { color: col, key })); y -= lineH; }
        const [r, g, b] = col;
        extra.DA = PDFString.of(`/Helv ${an.size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
        extra.BS = { W: 0 };
        break;
      }
      case 'note': {
        const [x, y] = V(an.x, an.y);
        bbox = [x, y - 20, x + 20, y];
        extra.Name = PDFName.of('Comment');
        extra.Open = false;
        // speech-bubble icon
        o.push(setFillingRgbColor(...col), setStrokingRgbColor(0.2, 0.2, 0.2), setLineWidth(0.8),
          moveTo(x + 1, y - 1), lineTo(x + 19, y - 1), lineTo(x + 19, y - 14), lineTo(x + 9, y - 14), lineTo(x + 4, y - 19), lineTo(x + 5, y - 14), lineTo(x + 1, y - 14), closePath(), fillAndStroke(),
          setStrokingRgbColor(0.2, 0.2, 0.2), setLineWidth(1), moveTo(x + 4, y - 5), lineTo(x + 16, y - 5), moveTo(x + 4, y - 9), lineTo(x + 13, y - 9), stroke());
        break;
      }
    }
    const [bx0, by0, bx1, by1] = bbox!;
    const corners = toUserPts([[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]]);
    const ux = [corners[0], corners[2], corners[4], corners[6]], uy = [corners[1], corners[3], corners[5], corners[7]];
    const rect = [Math.min(...ux), Math.min(...uy), Math.max(...ux), Math.max(...uy)];
    const ap = ctx.formXObject(o, { BBox: [bx0, by0, bx1, by1], Matrix: [m[0], m[1], m[2], m[3], 0, 0], Resources: res });
    const apRef = ctx.register(ap);
    const contents = 'note' in an && an.note ? an.note : an.kind === 'text' || an.kind === 'note' ? an.text : '';
    const dict = ctx.obj({
      Type: 'Annot', Subtype: SUBTYPE[an.kind], Rect: rect, C: col, F: 4, M: PDFString.of(pdfDate), CreationDate: PDFString.of(pdfDate),
      NM: PDFString.of(`pdfsherpa-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
      P: page.ref, AP: { N: apRef },
      ...(an.kind === 'highlight' ? { CA: 1 } : {}),
      ...extra,
    }) as PDFDict;
    if (contents) dict.set(PDFName.of('Contents'), str(contents));
    if (author.trim()) dict.set(PDFName.of('T'), str(author.trim()));
    const ref = ctx.register(dict);
    const arr = page.node.Annots();
    if (arr) arr.push(ref); else page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  }
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/* ---------------- Several pages per sheet (N-up, booklet) ---------------- */

const invAffine = (m: number[]): [number, number, number, number, number, number] => {
  const [a, b, c, d, e, f] = m; const det = a * d - b * c || 1;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};

/** Embed source pages as form XObjects, each with its upright size and a draw function. */
async function uprightPages(out: PDFDocument, src: PDFDocument) {
  const pages = src.getPages();
  const embedded = await out.embedPages(pages, pages.map((p) => { const c = p.getCropBox(); return { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height }; }), pages.map(() => [1, 0, 0, 1, 0, 0]) as any);
  return pages.map((p, i) => {
    const f = frame(p);
    const inv = invAffine(visualMatrix(p));
    return {
      w: f.vw, h: f.vh,
      /** draw with the page's visual bottom-left at (x, y), scaled by s */
      draw(target: PDFPage, x: number, y: number, s: number): PDFOperator[] {
        const name = target.node.newXObject('Pg', embedded[i].ref);
        return [pushGraphicsState(), concatTransformationMatrix(s, 0, 0, s, x, y), concatTransformationMatrix(...inv), drawObject(name), popGraphicsState()];
      },
    };
  });
}

export interface NUpOpts { perSheet: 2 | 4 | 6 | 8 | 9 | 16; sheet: 'a4' | 'letter' | 'a3' | 'source'; orientation: 'auto' | 'portrait' | 'landscape'; order: 'across' | 'down'; margin: number; gap: number; border: boolean; }

/** Grid layout for n pages per sheet: [cols, rows] for a portrait sheet. */
function grid(n: number): [number, number] {
  return ({ 2: [1, 2], 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3], 16: [4, 4] } as Record<number, [number, number]>)[n] ?? [2, 2];
}

export async function nUp(input: ArrayBuffer, o: NUpOpts) {
  const src = await load(input);
  const out = await PDFDocument.create();
  const pages = await uprightPages(out, src);
  const first = pages[0] ?? { w: 595.28, h: 841.89 };
  let [sw, sh] = o.sheet === 'source' ? [first.w, first.h] : (PAGE_SIZES[o.sheet] as unknown as [number, number]);
  [sw, sh] = [Math.min(sw, sh), Math.max(sw, sh)];
  let [cols, rows] = grid(o.perSheet);
  // 2, 6, 8 pages of a portrait document fit best on a landscape sheet (pages side by side)
  const srcLandscape = first.w > first.h;
  let landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && ([2, 6, 8].includes(o.perSheet) ? !srcLandscape : srcLandscape));
  if (o.orientation === 'portrait') landscape = false;
  if (landscape) { [sw, sh] = [sh, sw]; [cols, rows] = [rows, cols]; }
  const cellW = (sw - 2 * o.margin - (cols - 1) * o.gap) / cols, cellH = (sh - 2 * o.margin - (rows - 1) * o.gap) / rows;
  for (let i = 0; i < pages.length; i += o.perSheet) {
    const sheet = out.addPage([sw, sh]);
    const ops: PDFOperator[] = [];
    for (let k = 0; k < o.perSheet && i + k < pages.length; k++) {
      const pg = pages[i + k];
      const col = o.order === 'across' ? k % cols : Math.floor(k / rows), row = o.order === 'across' ? Math.floor(k / cols) : k % rows;
      const cx = o.margin + col * (cellW + o.gap), cyTop = sh - o.margin - row * (cellH + o.gap);
      const s = Math.min(cellW / pg.w, cellH / pg.h);
      const x = cx + (cellW - pg.w * s) / 2, y = cyTop - cellH + (cellH - pg.h * s) / 2;
      ops.push(...pg.draw(sheet, x, y, s));
      if (o.border) ops.push(pushGraphicsState(), setStrokingRgbColor(0.6, 0.6, 0.6), setLineWidth(0.5), rectangle(x, y, pg.w * s, pg.h * s), stroke(), popGraphicsState());
    }
    sheet.pushOperators(...ops);
  }
  out.setProducer('PDFSherpa');
  return save(out);
}

export interface BookletOpts { sheet: 'a4' | 'letter' | 'a3' | 'source'; rtl: boolean; margin: number; creep: number; }

/** Imposition for printing double-sided and folding in half: two pages per landscape side. */
export async function booklet(input: ArrayBuffer, o: BookletOpts) {
  const src = await load(input);
  const out = await PDFDocument.create();
  const pages = await uprightPages(out, src);
  const first = pages[0] ?? { w: 595.28, h: 841.89 };
  // the sheet holds two pages side by side: same size as the source page doubled, or a standard sheet
  let [sw, sh] = o.sheet === 'source' ? [first.w * 2, first.h] : (PAGE_SIZES[o.sheet] as unknown as [number, number]);
  if (o.sheet !== 'source') [sw, sh] = [Math.max(sw, sh), Math.min(sw, sh)];
  const half = sw / 2;
  const sides = bookletOrder(pages.length, o.rtl);
  sides.forEach(([l, r], si) => {
    const sheet = out.addPage([sw, sh]);
    const ops: PDFOperator[] = [];
    const sheetNo = Math.floor(si / 2), sheets = sides.length / 2;
    // creep: inner sheets get pushed outward slightly so the trimmed edge stays even
    const shift = o.creep * (sheets > 1 ? (sheets - 1 - sheetNo) / (sheets - 1) : 0);
    [l, r].forEach((idx, side) => {
      if (idx < 0) return;
      const pg = pages[idx];
      const boxW = half - o.margin, boxH = sh - 2 * o.margin;
      const s = Math.min(boxW / pg.w, boxH / pg.h);
      const w = pg.w * s, h = pg.h * s;
      // pages sit against the fold
      const x = side === 0 ? half - w - shift : half + shift;
      ops.push(...pg.draw(sheet, x, (sh - h) / 2, s));
    });
    sheet.pushOperators(...ops);
  });
  out.setProducer('PDFSherpa');
  return save(out);
}

/* ---------------- Split by file size ---------------- */

/**
 * Split into parts no larger than maxBytes (where possible). Parts are built greedily from
 * per-page size estimates, then checked by saving; a part that is still too big is split again.
 */
export async function splitBySize(input: ArrayBuffer, maxBytes: number) {
  const src = await load(input);
  const n = src.getPageCount();
  const build = async (idx: number[]) => { const d = await PDFDocument.create(); (await d.copyPages(src, idx)).forEach((p) => d.addPage(p)); return save(d); };
  // shared resources (fonts, images used on many pages) make single-page sizes overestimate; scale by the whole file
  const single: number[] = [];
  for (let i = 0; i < n; i++) single.push((await build([i])).length);
  const whole = (await save(src)).length;
  const k = Math.min(1, whole / Math.max(1, single.reduce((a, b) => a + b, 0)));
  const groups: number[][] = [];
  let cur: number[] = [], sum = 0;
  for (let i = 0; i < n; i++) {
    const est = single[i] * k;
    if (cur.length && sum + est > maxBytes * 0.97) { groups.push(cur); cur = []; sum = 0; }
    cur.push(i); sum += est;
  }
  if (cur.length) groups.push(cur);
  const parts: { pages: number[]; bytes: Uint8Array }[] = [];
  const emit = async (g: number[]): Promise<void> => {
    const bytes = await build(g);
    if (bytes.length > maxBytes && g.length > 1) { const h = Math.ceil(g.length / 2); await emit(g.slice(0, h)); await emit(g.slice(h)); return; }
    parts.push({ pages: g, bytes });
  };
  for (const g of groups) await emit(g);
  // merge neighbours that fit together after the exact check
  for (let i = 0; i < parts.length - 1; i++) {
    const a = parts[i], b = parts[i + 1];
    if (a.bytes.length + b.bytes.length > maxBytes * 1.3) continue;
    const both = await build([...a.pages, ...b.pages]);
    if (both.length <= maxBytes) { parts.splice(i, 2, { pages: [...a.pages, ...b.pages], bytes: both }); i--; }
  }
  return parts.map((p) => ({ first: p.pages[0], last: p.pages[p.pages.length - 1], bytes: p.bytes, tooBig: p.bytes.length > maxBytes }));
}

/* ---------------- Bookmarks (outline) ---------------- */

export interface Bookmark { title: string; page: number; level: number; }

/** Replace the document outline. Items are in reading order; level 0 = top level. */
export async function writeBookmarks(input: ArrayBuffer, items: Bookmark[], openLevels = 1) {
  const doc = await load(input);
  const ctx = doc.context;
  const pages = doc.getPages();
  const clean = items.filter((b) => b.title.trim() && pages[b.page]);
  if (!clean.length) {
    doc.catalog.delete(PDFName.of('Outlines'));
    return save(doc);
  }
  type Node = { b: Bookmark; ref: PDFRef; dict: PDFDict; kids: Node[] };
  const rootRef = ctx.nextRef();
  const root: Node = { b: { title: '', page: 0, level: -1 }, ref: rootRef, dict: ctx.obj({ Type: 'Outlines' }) as PDFDict, kids: [] };
  const stack: Node[] = [root];
  for (const b of clean) {
    const level = Math.max(0, Math.min(b.level, stack.length - 1));
    while (stack.length > level + 1) stack.pop();
    const parent = stack[stack.length - 1];
    const dict = ctx.obj({ Title: PDFHexString.fromText(b.title.trim()), Parent: parent.ref, Dest: [pages[b.page].ref, PDFName.of('XYZ'), null, null, null] }) as PDFDict;
    const node: Node = { b, ref: ctx.nextRef(), dict, kids: [] };
    parent.kids.push(node);
    stack.push(node);
  }
  // an entry is expanded when its level is above openLevels; Count = visible descendants (negative when collapsed)
  const isOpen = (n: Node) => n.b.level + 1 < openLevels;
  const visible = (n: Node): number => n.kids.reduce((t, k) => t + 1 + (isOpen(k) ? visible(k) : 0), 0);
  const link = (n: Node) => {
    n.kids.forEach((k, i) => {
      if (i > 0) k.dict.set(PDFName.of('Prev'), n.kids[i - 1].ref);
      if (i < n.kids.length - 1) k.dict.set(PDFName.of('Next'), n.kids[i + 1].ref);
      link(k);
    });
    if (n.kids.length) {
      n.dict.set(PDFName.of('First'), n.kids[0].ref);
      n.dict.set(PDFName.of('Last'), n.kids[n.kids.length - 1].ref);
      n.dict.set(PDFName.of('Count'), PDFNumber.of(n === root || isOpen(n) ? visible(n) : -n.kids.length));
    }
    ctx.assign(n.ref, n.dict);
  };
  link(root);
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/* ---------------- Colours: invert, paper background ---------------- */

/** Put operators underneath the existing page content. */
function prependOps(doc: PDFDocument, page: PDFPage, ops: PDFOperator[]) {
  const stream = doc.context.register(doc.context.contentStream(ops));
  const contents = page.node.get(PDFName.of('Contents'));
  const arr = contents instanceof PDFArray ? contents : doc.context.obj(contents ? [contents] : []) as PDFArray;
  arr.insert(0, stream);
  page.node.set(PDFName.of('Contents'), arr);
}
/** Wrap existing content in q … Q so state changes in it can't leak into what we add on top. */
function isolateContent(doc: PDFDocument, page: PDFPage) {
  prependOps(doc, page, [pushGraphicsState()]);
  page.pushOperators(popGraphicsState());
}

/**
 * Invert colours (night mode for reading or saving ink is the reverse: white on black → black on white).
 * Content stays vector: a white "difference" layer is drawn on top of a white base.
 */
export async function invertColors(input: ArrayBuffer, pagesToInvert: number[] | null) {
  const doc = await load(input);
  doc.getPages().forEach((page, i) => {
    if (pagesToInvert && !pagesToInvert.includes(i)) return;
    const { x, y, width, height } = page.getMediaBox();
    isolateContent(doc, page);
    prependOps(doc, page, [pushGraphicsState(), setFillingRgbColor(1, 1, 1), rectangle(x, y, width, height), fill(), popGraphicsState()]);
    const gs = page.node.newExtGState('GS', doc.context.obj({ BM: 'Difference', ca: 1, CA: 1 }));
    page.pushOperators(pushGraphicsState(), setGraphicsState(gs), setFillingRgbColor(1, 1, 1), rectangle(x, y, width, height), fill(), popGraphicsState());
  });
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/**
 * Colour the paper. 'multiply' tints everything white (works on scans too, text stays dark);
 * 'behind' paints under the content (only shows where the page itself is transparent).
 */
export async function pageBackground(input: ArrayBuffer, color: string, mode: 'multiply' | 'behind', pagesToColor: number[] | null) {
  const doc = await load(input);
  const [r, g, b] = rgbOf(color);
  doc.getPages().forEach((page, i) => {
    if (pagesToColor && !pagesToColor.includes(i)) return;
    const { x, y, width, height } = page.getMediaBox();
    if (mode === 'behind') { prependOps(doc, page, [pushGraphicsState(), setFillingRgbColor(r, g, b), rectangle(x, y, width, height), fill(), popGraphicsState()]); return; }
    isolateContent(doc, page);
    prependOps(doc, page, [pushGraphicsState(), setFillingRgbColor(1, 1, 1), rectangle(x, y, width, height), fill(), popGraphicsState()]);
    const gs = page.node.newExtGState('GS', doc.context.obj({ BM: 'Multiply', ca: 1, CA: 1 }));
    page.pushOperators(pushGraphicsState(), setGraphicsState(gs), setFillingRgbColor(r, g, b), rectangle(x, y, width, height), fill(), popGraphicsState());
  });
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/* ---------------- Annotations: list / remove ---------------- */

export type AnnotGroup = 'comments' | 'drawings' | 'links' | 'stamps' | 'attachments' | 'forms' | 'other';
const GROUP_OF: Record<string, AnnotGroup> = {
  Text: 'comments', FreeText: 'comments', Highlight: 'comments', Underline: 'comments', StrikeOut: 'comments', Squiggly: 'comments', Caret: 'comments', Popup: 'comments', Redact: 'comments',
  Ink: 'drawings', Square: 'drawings', Circle: 'drawings', Line: 'drawings', Polygon: 'drawings', PolyLine: 'drawings',
  Link: 'links', Stamp: 'stamps', FileAttachment: 'attachments', Sound: 'attachments', Movie: 'attachments', RichMedia: 'attachments', Screen: 'attachments', Widget: 'forms',
};

export async function annotationSummary(input: ArrayBuffer) {
  const doc = await load(input);
  const counts: Record<AnnotGroup, number> = { comments: 0, drawings: 0, links: 0, stamps: 0, attachments: 0, forms: 0, other: 0 };
  for (const page of doc.getPages()) {
    const arr = page.node.Annots();
    if (!arr) continue;
    for (let i = 0; i < arr.size(); i++) {
      const a = doc.context.lookup(arr.get(i));
      if (!(a instanceof PDFDict)) continue;
      const sub = a.get(PDFName.of('Subtype'))?.toString().slice(1) ?? '';
      if (sub === 'Popup') continue;
      counts[GROUP_OF[sub] ?? 'other']++;
    }
  }
  return counts;
}

/** Remove annotations by group. Removing forms also drops the form definition so readers don't show empty fields. */
export async function removeAnnotations(input: ArrayBuffer, groups: AnnotGroup[]) {
  const doc = await load(input);
  const drop = new Set(groups);
  let removed = 0;
  for (const page of doc.getPages()) {
    const arr = page.node.Annots();
    if (!arr) continue;
    const keep: unknown[] = [];
    for (let i = 0; i < arr.size(); i++) {
      const ref = arr.get(i);
      const a = doc.context.lookup(ref);
      if (!(a instanceof PDFDict)) continue;
      const sub = a.get(PDFName.of('Subtype'))?.toString().slice(1) ?? '';
      // a popup goes with its parent comment
      const g: AnnotGroup = sub === 'Popup' ? 'comments' : GROUP_OF[sub] ?? 'other';
      if (drop.has(g)) { if (sub !== 'Popup') removed++; continue; }
      keep.push(ref);
    }
    if (keep.length) page.node.set(PDFName.of('Annots'), doc.context.obj(keep as never[]));
    else page.node.delete(PDFName.of('Annots'));
  }
  if (drop.has('forms')) doc.catalog.delete(PDFName.of('AcroForm'));
  if (drop.has('attachments')) { const names = doc.catalog.lookup(PDFName.of('Names')); if (names instanceof PDFDict) names.delete(PDFName.of('EmbeddedFiles')); }
  doc.setProducer('PDFSherpa');
  return { bytes: await save(doc), removed };
}

/* ---------------- Deskew ---------------- */

/** Rotate page content by small angles (degrees, counter-clockwise as seen) around the page centre. */
export async function rotateContent(input: ArrayBuffer, angles: (number | null)[]) {
  const doc = await load(input);
  doc.getPages().forEach((page, i) => {
    const a = angles[i];
    if (!a) return;
    const { x, y, width, height } = page.getCropBox();
    const cx = x + width / 2, cy = y + height / 2, r = (a * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    prependOps(doc, page, [pushGraphicsState(), concatTransformationMatrix(c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy)]);
    page.pushOperators(popGraphicsState());
  });
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/* ---------------- TIFF → PDF ---------------- */

export interface TiffPdfOpts { page: 'image' | 'a4' | 'letter'; margin: number; }

/**
 * Multi-page TIFF to PDF. Fax (CCITT G3/G4), LZW, Deflate and JPEG data go into the PDF unchanged
 * (PDF has the same decoders), so scans stay lossless and small. Strips/tiles become image pieces.
 */
export async function tiffToPdf(inputs: ArrayBuffer[], o: TiffPdfOpts) {
  const { readTiff, decodeChunk, reverseBits } = await import('./tiff');
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  let pages = 0;
  const skipped: string[] = [];
  for (const input of inputs) {
    const tp = readTiff(new Uint8Array(input));
    for (const p of tp) {
      try {
        const colors = p.photometric === 2 || p.photometric === 6 ? 3 : p.photometric === 5 ? 4 : 1;
        const hasAlpha = p.spp > colors && p.extra > 0;
        const [dx, dy] = p.dpi ?? [72, 72];
        const imgW = (p.width / dx) * 72, imgH = (p.height / dy) * 72;
        let pageW = imgW, pageH = imgH;
        if (o.page !== 'image') { const s = PAGE_SIZES[o.page]; [pageW, pageH] = imgW > imgH ? [s[1], s[0]] : [s[0], s[1]]; }
        const scale = o.page === 'image' ? 1 : Math.min((pageW - 2 * o.margin) / imgW, (pageH - 2 * o.margin) / imgH);
        const ox = (pageW - imgW * scale) / 2, oy = (pageH - imgH * scale) / 2;
        const page = doc.addPage([pageW, pageH]);
        const ops: PDFOperator[] = [pushGraphicsState(), rectangle(ox, oy, imgW * scale, imgH * scale), clip(), endPath()];
        // colour space
        let cs: unknown = colors === 3 ? 'DeviceRGB' : colors === 4 ? 'DeviceCMYK' : 'DeviceGray';
        let decode: number[] | undefined = p.photometric === 0 && !(p.compression >= 2 && p.compression <= 4) ? [1, 0] : undefined;
        if (p.photometric === 3 && p.colormap) {
          const n = 1 << p.bps, lut = new Uint8Array(n * 3);
          for (let i = 0; i < n; i++) { lut[i * 3] = p.colormap[i] >> 8; lut[i * 3 + 1] = p.colormap[n + i] >> 8; lut[i * 3 + 2] = p.colormap[2 * n + i] >> 8; }
          cs = [PDFName.of('Indexed'), PDFName.of('DeviceRGB'), n - 1, PDFHexString.of(Array.from(lut, (b) => b.toString(16).padStart(2, '0')).join(''))];
          decode = undefined;
        }
        const csObj = typeof cs === 'string' ? PDFName.of(cs) : ctx.obj(cs as never);
        const sx = (imgW * scale) / p.width, sy = (imgH * scale) / p.height;
        const pieces = p.planar === 2 ? p.chunks.slice(0, p.chunks.length / p.spp) : p.chunks;
        for (let ci = 0; ci < pieces.length; ci++) {
          const c = pieces[ci];
          const base = { Type: 'XObject', Subtype: 'Image', Width: c.w, Height: c.h, ColorSpace: csObj, BitsPerComponent: p.bps, ...(decode ? { Decode: decode } : {}) };
          let stream;
          if (p.compression >= 2 && p.compression <= 4) {
            // fax: bilevel, CCITTFaxDecode
            const data = p.fillOrder === 2 ? reverseBits(c.data) : c.data;
            const K = p.compression === 4 ? -1 : p.compression === 3 && p.t4 & 1 ? 1 : 0;
            stream = ctx.stream(data, { ...base, ColorSpace: PDFName.of('DeviceGray'), BitsPerComponent: 1, Filter: 'CCITTFaxDecode',
              DecodeParms: { K, Columns: c.w, Rows: c.h, BlackIs1: p.photometric === 1, EncodedByteAlign: p.compression === 2, EndOfLine: p.compression === 3 } });
          } else if (p.compression === 7) {
            // JPEG: put the shared tables in front of each strip's data
            let data = c.data;
            if (p.jpegTables && p.jpegTables.length > 4) {
              const t = p.jpegTables.subarray(0, p.jpegTables.length - 2); // drop EOI
              const body = data[0] === 0xff && data[1] === 0xd8 ? data.subarray(2) : data;
              data = new Uint8Array(t.length + body.length); data.set(t); data.set(body, t.length);
            }
            stream = ctx.stream(data, { ...base, BitsPerComponent: 8, Filter: 'DCTDecode', ...(p.photometric === 2 ? { DecodeParms: { ColorTransform: 0 } } : {}) });
          } else if ((p.compression === 5 || p.compression === 8 || p.compression === 32946) && p.planar === 1 && !hasAlpha && p.spp === colors && !(p.bps === 16 && p.littleEndian)) {
            stream = ctx.stream(c.data, { ...base, Filter: p.compression === 5 ? 'LZWDecode' : 'FlateDecode',
              ...(p.predictor === 2 ? { DecodeParms: { Predictor: 2, Colors: p.spp, BitsPerComponent: p.bps, Columns: c.w } } : {}) });
          } else {
            // decode ourselves: PackBits, uncompressed, alpha, separate planes, little-endian 16-bit
            let raw: Uint8Array;
            if (p.planar === 2) {
              const planes = await Promise.all(Array.from({ length: p.spp }, (_, k) => decodeChunk(p, p.chunks[ci + k * pieces.length], 1)));
              const bpsB = p.bps / 8;
              raw = new Uint8Array(c.w * c.h * p.spp * bpsB);
              for (let px = 0; px < c.w * c.h; px++) for (let k = 0; k < p.spp; k++) for (let b = 0; b < bpsB; b++) raw[(px * p.spp + k) * bpsB + b] = planes[k][px * bpsB + b];
            } else raw = await decodeChunk(p, c, p.spp);
            let smask: PDFRef | undefined;
            if (hasAlpha && p.bps >= 8) {
              const bpsB = p.bps / 8, n = c.w * c.h;
              const col = new Uint8Array(n * colors * bpsB), alpha = new Uint8Array(n * bpsB);
              for (let px = 0; px < n; px++) {
                for (let b = 0; b < colors * bpsB; b++) col[px * colors * bpsB + b] = raw[px * p.spp * bpsB + b];
                for (let b = 0; b < bpsB; b++) alpha[px * bpsB + b] = raw[(px * p.spp + colors) * bpsB + b];
              }
              raw = col;
              smask = ctx.register(ctx.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Width: c.w, Height: c.h, ColorSpace: 'DeviceGray', BitsPerComponent: p.bps }));
            }
            stream = ctx.flateStream(raw, { ...base, ...(smask ? { SMask: smask } : {}) });
          }
          const ref = ctx.register(stream);
          const name = page.node.newXObject('Im', ref);
          // TIFF rows run top-down; PDF images are drawn into a unit square from the top
          ops.push(pushGraphicsState(), concatTransformationMatrix(c.w * sx, 0, 0, c.h * sy, ox + c.x * sx, oy + (p.height - c.y - c.h) * sy), drawObject(name), popGraphicsState());
        }
        ops.push(popGraphicsState());
        page.pushOperators(...ops);
        pages++;
      } catch (e) { skipped.push(String((e as Error)?.message ?? e)); }
    }
  }
  if (!pages) throw new Error(skipped[0] === 'UNSUPPORTED_COMPRESSION' ? 'UNSUPPORTED_COMPRESSION' : 'NO_IMAGES');
  doc.setProducer('PDFSherpa');
  return { bytes: await save(doc), pages, skipped: skipped.length };
}

/* ---------------- Links ---------------- */

export interface LinkSpec { page: number; /** visual fractions, origin top-left */ x: number; y: number; w: number; h: number; url?: string; toPage?: number; }

/** Add clickable link areas: web/email links or jumps to another page. Invisible border. */
export async function addLinks(input: ArrayBuffer, links: LinkSpec[]) {
  const doc = await load(input);
  const ctx = doc.context;
  const pages = doc.getPages();
  let added = 0;
  for (const l of links) {
    const page = pages[l.page];
    if (!page || (!l.url && (l.toPage === undefined || !pages[l.toPage]))) continue;
    const f = frame(page);
    const pts = [[l.x, l.y], [l.x + l.w, l.y], [l.x, l.y + l.h], [l.x + l.w, l.y + l.h]].map(([fx, fy]) => f.toUser(fx * f.vw, f.vh - fy * f.vh));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const action = l.url
      ? { A: { Type: 'Action', S: 'URI', URI: PDFString.of(/^(https?:|mailto:|tel:|ftp:)/i.test(l.url) ? l.url : /@/.test(l.url) && !/\//.test(l.url) ? `mailto:${l.url}` : `https://${l.url}`) } }
      : { Dest: [pages[l.toPage!].ref, PDFName.of('Fit')] };
    const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], Border: [0, 0, 0], F: 4, P: page.ref, ...action } as any));
    const arr = page.node.Annots();
    if (arr) arr.push(annot); else page.node.set(PDFName.of('Annots'), ctx.obj([annot]));
    added++;
  }
  doc.setProducer('PDFSherpa');
  return { bytes: await save(doc), added };
}

/* ---------------- Overlay (letterhead), split in half, poster ---------------- */

export interface OverlayOpts { layer: 'under' | 'over'; pages: 'all' | 'first' | 'not-first'; repeat: 'first' | 'cycle'; opacity: number; fit: 'stretch' | 'fit'; }

/** Put pages of a second PDF (letterhead, template, watermark) under or over each page. */
export async function overlayPdf(input: ArrayBuffer, layer: ArrayBuffer, o: OverlayOpts) {
  const doc = await load(input);
  const src = await load(layer);
  const lp = await uprightPages(doc, src);
  if (!lp.length) throw new Error('EMPTY_LAYER');
  doc.getPages().forEach((page, i) => {
    if (o.pages === 'first' && i > 0) return;
    if (o.pages === 'not-first' && i === 0) return;
    const L = lp[o.repeat === 'cycle' ? i % lp.length : 0];
    const f = frame(page);
    const vm = visualMatrix(page);
    let sx = f.vw / L.w, sy = f.vh / L.h, dx = 0, dy = 0;
    if (o.fit === 'fit') { const s = Math.min(sx, sy); sx = sy = s; dx = (f.vw - L.w * s) / 2; dy = (f.vh - L.h * s) / 2; }
    const gs = o.opacity < 1 ? page.node.newExtGState('GS', doc.context.obj({ ca: o.opacity, CA: o.opacity })) : null;
    // L.draw scales uniformly; stretch needs separate x/y scale, so wrap in an extra matrix
    const ops = [pushGraphicsState(), ...(gs ? [setGraphicsState(gs)] : []), concatTransformationMatrix(...vm), concatTransformationMatrix(sx, 0, 0, sy, dx, dy), ...L.draw(page, 0, 0, 1), popGraphicsState()];
    if (o.layer === 'over') { isolateContent(doc, page); page.pushOperators(...ops); }
    else prependOps(doc, page, ops);
  });
  doc.setProducer('PDFSherpa');
  return save(doc);
}

/**
 * Split every page into two halves (book scans with two pages per sheet), losslessly via the crop box.
 * direction 'auto': landscape pages split left/right, portrait pages top/bottom. rtl: right half first.
 */
export async function splitHalves(input: ArrayBuffer, o: { direction: 'auto' | 'vertical' | 'horizontal'; rtl: boolean; skipFirst: boolean; skipLast: boolean }) {
  const src = await load(input);
  const out = await PDFDocument.create();
  const n = src.getPageCount();
  for (let i = 0; i < n; i++) {
    const keepWhole = (o.skipFirst && i === 0) || (o.skipLast && i === n - 1 && n > 1);
    if (keepWhole) { const [p] = await out.copyPages(src, [i]); out.addPage(p); continue; }
    const sp = src.getPage(i);
    const f = frame(sp);
    const lr = o.direction === 'vertical' || (o.direction === 'auto' && f.vw >= f.vh);
    // halves in visual space, converted to the user-space crop box
    const halves: [number, number, number, number][] = lr ? [[0, 0, f.vw / 2, f.vh], [f.vw / 2, 0, f.vw / 2, f.vh]] : [[0, f.vh / 2, f.vw, f.vh / 2], [0, 0, f.vw, f.vh / 2]];
    if (lr && o.rtl) halves.reverse();
    const copies = await out.copyPages(src, [i, i]);
    copies.forEach((p, k) => {
      const [x, y, w, h] = halves[k];
      const pts = [f.toUser(x, y), f.toUser(x + w, y), f.toUser(x, y + h), f.toUser(x + w, y + h)];
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] as const;
      p.setCropBox(...box); p.setMediaBox(...box);
      out.addPage(p);
    });
  }
  out.setProducer('PDFSherpa');
  return save(out);
}

export interface PosterOpts { page: number; sheet: 'a4' | 'letter' | 'a3'; across: number; landscape: boolean; overlap: number; marks: boolean; }

/** Enlarge one page over several sheets (tiles) with overlap and cut marks, to tape together. */
export async function posterPdf(input: ArrayBuffer, o: PosterOpts) {
  const src = await load(input);
  const out = await PDFDocument.create();
  const [pg] = await uprightPages(out, await (async () => { const d = await PDFDocument.create(); const [p] = await d.copyPages(src, [Math.min(o.page, src.getPageCount() - 1)]); d.addPage(p); return d; })());
  let [sw, sh] = PAGE_SIZES[o.sheet] as unknown as [number, number];
  if (o.landscape) [sw, sh] = [sh, sw];
  const margin = 18, ov = o.overlap;
  const cw = sw - 2 * margin, ch = sh - 2 * margin; // printable area per sheet
  // scale so `across` sheets cover the width (minus overlaps)
  const totalW = o.across * cw - (o.across - 1) * ov;
  const s = totalW / pg.w;
  const totalH = pg.h * s;
  const down = Math.max(1, Math.ceil((totalH - ov) / (ch - ov) - 1e-6));
  const font = await out.embedFont(StandardFonts.Helvetica);
  for (let r = 0; r < down; r++) for (let c = 0; c < o.across; c++) {
    const sheet = out.addPage([sw, sh]);
    // the poster's top-left lands at the sheet's printable top-left for tile (0, 0)
    const ox = margin - c * (cw - ov), oy = sh - margin - totalH + r * (ch - ov);
    const ops: PDFOperator[] = [pushGraphicsState(), rectangle(margin, margin, cw, ch), clip(), endPath(), ...pg.draw(sheet, ox, oy, s), popGraphicsState()];
    if (o.marks) {
      ops.push(pushGraphicsState(), setStrokingRgbColor(0.5, 0.5, 0.5), setLineWidth(0.4), setDashPattern([3, 2], 0), rectangle(margin, margin, cw, ch), stroke(), popGraphicsState());
      if (ov > 0) ops.push(pushGraphicsState(), setStrokingRgbColor(0.85, 0.2, 0.2), setLineWidth(0.4), setDashPattern([2, 2], 0),
        ...(c > 0 ? [moveTo(margin + ov, margin), lineTo(margin + ov, sh - margin)] : []), ...(r > 0 ? [moveTo(margin, sh - margin - ov), lineTo(sw - margin, sh - margin - ov)] : []), stroke(), popGraphicsState());
    }
    sheet.pushOperators(...ops);
    if (o.marks) sheet.drawText(`Row ${r + 1} / ${down} · Column ${c + 1} / ${o.across}${ov ? ' · glue over the red line' : ''}`, { x: margin, y: 6, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
  }
  out.setProducer('PDFSherpa');
  return { bytes: await save(out), sheets: down * o.across, down, sizeCm: [(totalW / 72) * 2.54, (totalH / 72) * 2.54] };
}
