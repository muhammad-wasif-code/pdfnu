/**
 * Pure pdf-lib operations. Executed inside the pdf worker (see workers/pdf.worker.ts).
 */
import {
  PDFDocument, StandardFonts, degrees, rgb, PDFName, PDFDict, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown,
  PDFOptionList, PDFSignature, PDFButton, PDFArray, PDFStream, PDFRef, PDFNumber,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, beginText, endText, setFontAndSize,
  setTextRenderingMode, TextRenderingMode, setTextMatrix, showText, setCharacterSqueeze, TextAlignment, type PDFPage, type PDFFont,
} from 'pdf-lib';
import { TextEngine, wrapLines, type Keyer, type TextStyle } from './textEngine';
/** Tests point font loading at the files on disk. */
export { setFontFetcher } from './textEngine';

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
