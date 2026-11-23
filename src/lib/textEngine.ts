/**
 * Draw text in (almost) any language into a PDF with pdf-lib.
 *
 * - Font fallback by script: Latin families (Liberation/Carlito/Tinos/Cousine/Caladea), Arabic & Urdu (Noto Naskh),
 *   Hebrew, Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala, Thai.
 * - OpenType shaping with fontkit, and every glyph placed at its GPOS position (pdf-lib's drawText ignores GPOS,
 *   which breaks Arabic dots and Indic marks).
 * - Bidirectional text: right-to-left runs are reordered (simplified Unicode bidi algorithm).
 * - Anything we ship no font for (Chinese, Japanese, Korean, emoji…) is drawn by the browser on a canvas and placed
 *   as an image, with the original text attached (ActualText) so it can still be copied.
 * Works in the main thread and in workers (OffscreenCanvas). In Node, unsupported characters become “?”.
 */
import 'regenerator-runtime/runtime.js'; // fontkit's Indic/USE shapers use regenerator-compiled generators
import {
  PDFDocument, PDFFont, PDFHexString, PDFName, PDFOperator, PDFOperatorNames, CustomFontEmbedder, CustomFontSubsetEmbedder,
  type PDFImage, type PDFPage, beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingRgbColor,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, setGraphicsState, drawObject, setTextRenderingMode, TextRenderingMode,
} from 'pdf-lib';
import { FONTS_BASE, PDFJS_BASE } from './vendor';

export type Family = 'sans' | 'serif' | 'mono' | 'calibri' | 'cambria';
export interface TextStyle { family?: Family; bold?: boolean; italic?: boolean; }

// ───────────────────────── scripts ─────────────────────────
const SCRIPTS: [string, RegExp][] = [
  ['arabic', /[؀-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-﻿]/],
  ['hebrew', /[֐-׿יִ-ﭏ]/],
  ['devanagari', /[ऀ-ॿ꣠-ꣿ᳐-᳿]/],
  ['bengali', /[ঀ-৿]/],
  ['gurmukhi', /[਀-੿]/],
  ['gujarati', /[઀-૿]/],
  ['oriya', /[଀-୿]/],
  ['tamil', /[஀-௿]/],
  ['telugu', /[ఀ-౿]/],
  ['kannada', /[ಀ-೿]/],
  ['malayalam', /[ഀ-ൿ]/],
  ['sinhala', /[඀-෿]/],
  ['thai', /[฀-๿]/],
];
const MARK = /[\p{M}‌‍︀-️]/u;
const LETTER = /\p{L}/u;
const DIGIT = /[\p{Nd}]/u;
const RTL_LETTER = /[֐-׿؀-ٟٮ-ۯۺ-ۿ܀-ࣿיִ-﷿ﹰ-﻿]/;

function scriptOf(ch: string): string {
  for (const [name, re] of SCRIPTS) if (re.test(ch)) return name;
  if (MARK.test(ch)) return 'inherit';
  if (LETTER.test(ch)) return 'latin';
  return 'common';
}

/** 'R' if the first strong character is right-to-left, 'L' if left-to-right, 'N' if there is none. */
export function strongDir(text: string): 'L' | 'R' | 'N' {
  for (const ch of text) { if (RTL_LETTER.test(ch)) return 'R'; if (LETTER.test(ch)) return 'L'; }
  return 'N';
}

/** Bidi class per character (simplified): R, L, NUM (digits) or N (neutral). */
function bidiClass(ch: string): 'R' | 'L' | 'NUM' | 'N' {
  if (RTL_LETTER.test(ch)) return 'R';
  if (DIGIT.test(ch)) return 'NUM';
  if (LETTER.test(ch) || MARK.test(ch)) return 'L';
  return 'N';
}

/** Embedding levels for a sequence of classes (UBA rules W7, N1/N2 and I1/I2, simplified). */
export function bidiLevels(classes: ('R' | 'L' | 'NUM' | 'N')[], baseRtl: boolean): number[] {
  const n = classes.length;
  const res = classes.slice();
  // W7-ish: numbers after L (or at start of an LTR paragraph) behave as L
  let prevStrong: 'R' | 'L' = baseRtl ? 'R' : 'L';
  for (let i = 0; i < n; i++) {
    if (res[i] === 'R' || res[i] === 'L') prevStrong = res[i] as 'R' | 'L';
    else if (res[i] === 'NUM' && prevStrong === 'L') res[i] = 'L';
  }
  // N1/N2: neutrals take the direction of surrounding strong types (numbers count as R), otherwise the base
  const strongAt = (i: number) => (res[i] === 'L' ? 'L' : res[i] === 'R' || res[i] === 'NUM' ? 'R' : null);
  for (let i = 0; i < n; i++) {
    if (res[i] !== 'N') continue;
    let j = i; while (j < n && res[j] === 'N') j++;
    let before: 'L' | 'R' = baseRtl ? 'R' : 'L';
    for (let k = i - 1; k >= 0; k--) { const s = strongAt(k); if (s) { before = s; break; } }
    const after = j < n ? strongAt(j)! : (baseRtl ? 'R' : 'L');
    const d = before === after ? before : baseRtl ? 'R' : 'L';
    for (let k = i; k < j; k++) res[k] = d;
    i = j - 1;
  }
  return res.map((c) => {
    if (baseRtl) return c === 'R' ? 1 : 2; // L and numbers inside RTL
    return c === 'L' ? 0 : c === 'R' ? 1 : 2; // numbers after R
  });
}

/** Visual order (indices) for items with the given levels (UBA rule L2). */
export function visualOrder(levels: number[]): number[] {
  const order = levels.map((_, i) => i);
  if (!levels.length) return order;
  const max = Math.max(...levels);
  const minOdd = Math.min(...levels.filter((l) => l % 2 === 1), Infinity);
  if (minOdd === Infinity) return order;
  for (let lvl = max; lvl >= minOdd; lvl--) {
    for (let i = 0; i < order.length; i++) {
      if (levels[order[i]] < lvl) continue;
      let j = i; while (j < order.length && levels[order[j]] >= lvl) j++;
      order.splice(i, j - i, ...order.slice(i, j).reverse());
      i = j;
    }
  }
  return order;
}

// ───────────────────────── fonts ─────────────────────────
interface Face { key: string; fk: any; pdf: PDFFont | null; bytes: Uint8Array; subset: boolean; upm: number; asc: number; desc: number; }
interface Fallback { img: PDFImage | null; w: number; asc: number; desc: number; } // per em
const REF = 64; // px size used for canvas fallback rendering

const RANGES_FOR_SUBSET: Record<string, RegExp> = {
  'latin-ext': /[Ā-ɏḀ-ỿⱠ-Ɀ꜠-ꟿ]/,
  greek: /[Ͱ-Ͽἀ-῿]/,
  cyrillic: /[Ѐ-ӿ]/,
};
const FAMILY_SUBSETS: Record<Exclude<Family, 'sans'>, string[]> = {
  calibri: ['latin', 'latin-ext', 'greek', 'cyrillic'],
  serif: ['latin', 'latin-ext', 'greek', 'cyrillic'],
  mono: ['latin', 'latin-ext', 'greek', 'cyrillic'],
  cambria: ['latin', 'latin-ext'],
};
const LIBERATION = ['Regular', 'Bold', 'Italic', 'BoldItalic'];
const styleIdx = (s: TextStyle) => (s.bold ? 1 : 0) + (s.italic ? 2 : 0);

/** Map a Word/document font name to one of our families. */
export function familyFor(name: string | undefined): Family {
  const n = (name ?? '').toLowerCase();
  if (!n) return 'sans';
  if (/calibri|carlito|aptos|segoe|candara|corbel/.test(n)) return 'calibri';
  if (/cambria|caladea/.test(n)) return 'cambria';
  if (/courier|consolas|mono|lucida console|menlo|monaco|code/.test(n)) return 'mono';
  if (/times|georgia|garamond|book antiqua|palatino|serif|minion|baskerville|bookman|century schoolbook|tinos|liberation serif|cambria/.test(n) && !/sans/.test(n)) return 'serif';
  return 'sans';
}

export interface Piece { face: Face | null; fb: Fallback | null; text: string; level: number; glyphs: any[]; pos: any[]; width: number; reversed: boolean; }
export interface Shaped { width: number; ascent: number; descent: number; pieces: Piece[]; size: number; }

type Fetcher = (url: string) => Promise<Uint8Array | null>;
let defaultFetch: Fetcher = async (url) => { try { const r = await fetch(url); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
/** Replace how font files are loaded (tests read them from disk). */
export function setFontFetcher(f: Fetcher) { defaultFetch = f; }

export class TextEngine {
  private faces = new Map<string, Face | null>();
  private fallbacks = new Map<string, Fallback>();
  private fontkit: any;
  /** characters that could not be drawn at all (no font and no canvas) */
  missing = 0;

  private constructor(private doc: PDFDocument, private fetcher: Fetcher, fontkit: any) { this.fontkit = fontkit; }

  static async create(doc: PDFDocument, fetcher?: Fetcher): Promise<TextEngine> {
    const mod: any = await import('@pdf-lib/fontkit');
    return new TextEngine(doc, fetcher ?? defaultFetch, mod.default ?? mod);
  }

  private url(key: string) {
    return key.startsWith('liberation-') ? `${PDFJS_BASE}standard_fonts/LiberationSans-${key.slice(11)}.ttf` : `${FONTS_BASE}${key}.ttf`;
  }
  private async loadFace(key: string): Promise<Face | null> {
    if (this.faces.has(key)) return this.faces.get(key)!;
    const bytes = await this.fetcher(this.url(key));
    let face: Face | null = null;
    if (bytes) {
      try {
        const fk = this.fontkit.create(bytes);
        face = { key, fk, pdf: null, bytes, subset: key.startsWith('liberation-'), upm: fk.unitsPerEm, asc: fk.ascent / fk.unitsPerEm, desc: -fk.descent / fk.unitsPerEm };
      } catch { face = null; }
    }
    this.faces.set(key, face);
    return face;
  }
  private face(key: string): Face | null { return this.faces.get(key) ?? null; }

  /** Latin font keys to try, in order, for a style. */
  private latinKeys(style: TextStyle, text?: string): string[] {
    const fam = style.family ?? 'sans';
    const keys: string[] = [];
    if (fam !== 'sans') {
      const w = style.bold ? 700 : 400, st = style.italic ? 'italic' : 'normal';
      for (const sub of FAMILY_SUBSETS[fam]) {
        if (text !== undefined && sub !== 'latin' && !RANGES_FOR_SUBSET[sub]?.test(text)) continue;
        keys.push(`${fam}-${sub}-${w}-${st}`);
      }
    }
    keys.push(`liberation-${LIBERATION[styleIdx(style)]}`);
    return keys;
  }
  private scriptKey(script: string, style: TextStyle) { return `${script}-${style.bold ? 700 : 400}`; }

  /** Load every font (and canvas fallback) the given texts need. Call before shape()/draw(). */
  async prepare(items: { text: string; style?: TextStyle }[]): Promise<void> {
    const byStyle = new Map<string, { style: TextStyle; texts: Set<string> }>();
    for (const it of items) {
      const st = it.style ?? {};
      const k = `${st.family ?? 'sans'}|${!!st.bold}|${!!st.italic}`;
      let e = byStyle.get(k);
      if (!e) { e = { style: st, texts: new Set() }; byStyle.set(k, e); }
      e.texts.add(it.text);
    }
    for (const { style, texts } of byStyle.values()) {
      const all = [...texts].join(' ');
      const keys = new Set<string>(this.latinKeys(style, all).filter((k) => !k.startsWith('liberation-')));
      for (const ch of new Set(all)) { const s = scriptOf(ch); if (s !== 'latin' && s !== 'common' && s !== 'inherit') keys.add(this.scriptKey(s, style)); }
      await Promise.all([...keys].map((k) => this.loadFace(k)));
      // Liberation covers Latin, Greek and Cyrillic: load it only when the family fonts miss something
      if (this.segment(all, style).some((s) => !s.face)) await this.loadFace(`liberation-${LIBERATION[styleIdx(style)]}`);
      // bold script text falls back to the regular script font if the bold one failed
      for (const s of this.segment(all, style)) if (!s.face && s.script !== 'latin' && s.script !== 'common') await this.loadFace(`${s.script}-400`);
      // whatever is still uncovered is drawn by the browser; fallbacks are keyed by the exact segment text,
      // so segment each string the way shape() will
      for (const t of texts) for (const s of this.segment(t, style)) if (!s.face) await this.makeFallback(s.text, style);
    }
  }

  /** True if some characters need the canvas fallback (callers may split such text per character). */
  needsFallback(text: string, style: TextStyle = {}): boolean { return this.segment(text, style).some((s) => !s.face); }

  /** Split text into runs that one face can draw (logical order). */
  private segment(text: string, style: TextStyle): { text: string; face: Face | null; script: string }[] {
    const out: { text: string; face: Face | null; script: string }[] = [];
    const chars = [...text];
    const latin = this.latinKeys(style, text).map((k) => this.face(k)).filter(Boolean) as Face[];
    const has = (f: Face, cluster: string) => { for (const ch of cluster) { const cp = ch.codePointAt(0)!; if (cp === 0x200c || cp === 0x200d) continue; if (!f.fk.hasGlyphForCodePoint(cp)) return false; } return true; };
    let i = 0;
    while (i < chars.length) {
      // a cluster = base character + following marks / joiners
      let cluster = chars[i++];
      while (i < chars.length && MARK.test(chars[i])) cluster += chars[i++];
      let script = scriptOf(cluster[0]);
      if (script === 'inherit') script = 'common';
      const prev = out[out.length - 1];
      let face: Face | null = null;
      if (script !== 'latin' && script !== 'common') {
        const sf = this.face(this.scriptKey(script, style)) ?? this.face(`${script}-400`);
        if (sf && has(sf, cluster)) face = sf;
      } else if (script === 'common' && prev?.face && has(prev.face, cluster)) face = prev.face;
      if (!face) face = latin.find((f) => has(f, cluster)) ?? null;
      if (!face && script === 'common') { // e.g. Arabic punctuation-only text: try any loaded script font
        for (const f of this.faces.values()) if (f && has(f, cluster)) { face = f; break; }
      }
      if (prev && prev.face === face && (face || prev.script === script || script === 'common')) prev.text += cluster;
      else out.push({ text: cluster, face, script });
    }
    return out;
  }

  private canvas(w: number, h: number): any {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    return null;
  }
  private cssFont(style: TextStyle, px: number) {
    const fam = { sans: 'Arial, sans-serif', serif: '"Times New Roman", serif', mono: '"Courier New", monospace', calibri: 'Calibri, Carlito, sans-serif', cambria: 'Cambria, Caladea, serif' }[style.family ?? 'sans'];
    return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${px}px ${fam}`;
  }
  private fbKey(text: string, style: TextStyle) { return `${text}\u0000${style.bold ? 1 : 0}${style.italic ? 1 : 0}${style.family ?? 'sans'}`; }
  private async makeFallback(text: string, style: TextStyle) {
    const key = this.fbKey(text, style);
    if (this.fallbacks.has(key)) return;
    const probe = this.canvas(8, 8);
    const ctx = probe?.getContext('2d');
    if (!ctx) { this.fallbacks.set(key, { img: null, w: 0, asc: 0.9, desc: 0.25 }); return; }
    ctx.font = this.cssFont(style, REF);
    const m = ctx.measureText(text);
    const asc = Math.max(m.fontBoundingBoxAscent ?? REF * 0.9, m.actualBoundingBoxAscent ?? 0, REF * 0.8);
    const desc = Math.max(m.fontBoundingBoxDescent ?? REF * 0.25, m.actualBoundingBoxDescent ?? 0, REF * 0.2);
    const w = Math.max(1, Math.ceil(m.width));
    const scale = 4; // render at 256px per em: sharp when printed
    const c = this.canvas(w * scale, Math.ceil((asc + desc) * scale));
    const x = c.getContext('2d');
    x.scale(scale, scale);
    x.font = this.cssFont(style, REF);
    x.fillStyle = '#000';
    x.textBaseline = 'alphabetic';
    x.direction = strongDir(text) === 'R' ? 'rtl' : 'ltr';
    x.textAlign = 'left';
    x.fillText(text, 0, asc);
    let png: Uint8Array | null = null;
    try {
      const blob: Blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' }) : await new Promise((r) => c.toBlob(r, 'image/png'));
      png = new Uint8Array(await blob.arrayBuffer());
    } catch { png = null; }
    const img = png ? await this.doc.embedPng(png) : null;
    this.fallbacks.set(key, { img, w: w / REF, asc: asc / REF, desc: desc / REF });
  }

  private pdfFont(face: Face): PDFFont {
    if (face.pdf) return face.pdf;
    const emb = face.subset ? new (CustomFontSubsetEmbedder as any)(face.fk, face.bytes) : new (CustomFontEmbedder as any)(face.fk, face.bytes);
    if (!face.subset) {
      // widths + ToUnicode only for the glyphs we drew, keeping the code points from shaping (better copy/paste)
      const used = new Map<number, any>();
      emb.used = used;
      emb.glyphCache = { access: () => [...used.values()].sort((a, b) => a.id - b.id), invalidate: () => {} };
    }
    const font = PDFFont.of(this.doc.context.nextRef(), this.doc, emb);
    (this.doc as any).fonts.push(font);
    face.pdf = font;
    return font;
  }

  /** Shape a string (one line) at a size. `rtl`: paragraph direction; auto-detected when undefined. */
  shape(text: string, style: TextStyle, size: number, rtl?: boolean): Shaped {
    const base = rtl ?? strongDir(text) === 'R';
    const segs = this.segment(text, style);
    // split segments further by bidi level
    const chars: string[] = [];
    const segOf: number[] = [];
    segs.forEach((s, i) => { for (const ch of s.text) { chars.push(ch); segOf.push(i); } });
    const levels = bidiLevels(chars.map(bidiClass), base);
    // marks/joiners keep the level of their base character
    for (let i = 1; i < chars.length; i++) if (MARK.test(chars[i])) levels[i] = levels[i - 1];
    const runs: { seg: number; level: number; text: string }[] = [];
    chars.forEach((ch, i) => {
      const r = runs[runs.length - 1];
      if (r && r.seg === segOf[i] && r.level === levels[i]) r.text += ch;
      else runs.push({ seg: segOf[i], level: levels[i], text: ch });
    });
    const pieces: Piece[] = runs.map((r) => {
      const face = segs[r.seg].face;
      if (!face) {
        const fb = this.fallbacks.get(this.fbKey(segs[r.seg].text, style)) ?? null;
        // a fallback image covers the whole segment; split levels are rare inside it, so the segment is drawn once
        if (!fb || !fb.img) { this.missing += [...r.text].length; }
        return { face: null, fb, text: r.text, level: r.level, glyphs: [], pos: [], width: fb ? fb.w * size * ([...r.text].length / Math.max(1, [...segs[r.seg].text].length)) : 0, reversed: false };
      }
      const run = safeLayout(face, r.text);
      if (!run) { this.missing += [...r.text].length; return { face: null, fb: null, text: r.text, level: r.level, glyphs: [], pos: [], width: 0, reversed: false }; }
      let glyphs = run.glyphs.slice(), pos = run.positions.slice();
      const rtlRun = run.direction === 'rtl';
      let reversed = rtlRun;
      if ((r.level % 2 === 1) !== rtlRun) { glyphs.reverse(); pos.reverse(); reversed = !reversed; }
      const k = size / face.upm;
      const width = pos.reduce((s: number, p: any) => s + p.xAdvance, 0) * k;
      return { face, fb: null, text: r.text, level: r.level, glyphs, pos, width, reversed };
    });
    // fallback images: draw once per segment (merge consecutive pieces of the same fallback segment)
    const merged: Piece[] = [];
    for (const p of pieces) {
      const last = merged[merged.length - 1];
      if (!p.face && last && !last.face && last.fb === p.fb) { last.text += p.text; last.width += p.width; } else merged.push(p);
    }
    const order = visualOrder(merged.map((p) => p.level));
    const visual = order.map((i) => merged[i]);
    let asc = 0, desc = 0;
    for (const p of visual) {
      const a = p.face ? p.face.asc : p.fb ? p.fb.asc : 0.9, d = p.face ? p.face.desc : p.fb ? p.fb.desc : 0.2;
      asc = Math.max(asc, a * size); desc = Math.max(desc, d * size);
    }
    if (!visual.length) { asc = 0.905 * size; desc = 0.212 * size; }
    return { width: visual.reduce((s, p) => s + p.width, 0), ascent: asc, descent: desc, pieces: visual, size };
  }

  measure(text: string, style: TextStyle, size: number, rtl?: boolean) { return this.shape(text, style, size, rtl).width; }

  /**
   * Operators that draw shaped text with its baseline starting at (x, y).
   * `key` registers a font or image on the target and returns its resource name.
   */
  ops(sh: Shaped, x: number, y: number, o: { color?: [number, number, number]; key: Keyer; rotate?: number; opacity?: PDFName | null; scaleX?: number; invisible?: boolean }): PDFOperator[] {
    const actualText = (text: string) => [PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('Span'), this.doc.context.obj({ ActualText: PDFHexString.of(utf16Hex(text)) }) as any])];
    const out: PDFOperator[] = [pushGraphicsState()];
    if (o.opacity) out.push(setGraphicsState(o.opacity));
    const a = ((o.rotate ?? 0) * Math.PI) / 180;
    const sx = o.scaleX ?? 1;
    out.push(concatTransformationMatrix(Math.cos(a) * sx, Math.sin(a) * sx, -Math.sin(a), Math.cos(a), x, y));
    const [r, g, b] = o.color ?? [0, 0, 0];
    out.push(setFillingRgbColor(r, g, b));
    let pen = 0;
    for (const p of sh.pieces) {
      if (!p.face) {
        if (p.fb?.img && !o.invisible) {
          const name = o.key.image(p.fb.img);
          const h = (p.fb.asc + p.fb.desc) * sh.size;
          out.push(...actualText(p.text), pushGraphicsState(), concatTransformationMatrix(p.width, 0, 0, h, pen, -p.fb.desc * sh.size), drawObject(name), popGraphicsState(), endMC());
        }
        pen += p.width; continue;
      }
      const font = this.pdfFont(p.face);
      const name = o.key.font(font);
      const k = sh.size / p.face.upm;
      const needActual = p.reversed || !/^(liberation|calibri|serif|mono|cambria)-/.test(p.face.key);
      if (needActual) out.push(...actualText(p.text));
      out.push(beginText(), setFontAndSize(name, sh.size));
      if (o.invisible) out.push(setTextRenderingMode(TextRenderingMode.Invisible));
      let gx = pen;
      p.glyphs.forEach((gl: any, i: number) => {
        const ps = p.pos[i];
        out.push(setTextMatrix(1, 0, 0, 1, gx + ps.xOffset * k, ps.yOffset * k), showText(encodeGlyph(font, gl)));
        gx += ps.xAdvance * k;
      });
      out.push(endText());
      if (needActual) out.push(endMC());
      pen += p.width;
    }
    out.push(popGraphicsState());
    return out;
  }

  /** Draw on a page. (x, y) is the baseline start in page coordinates. */
  drawOnPage(page: PDFPage, sh: Shaped, x: number, y: number, o: { color?: [number, number, number]; rotate?: number; opacity?: number; scaleX?: number; invisible?: boolean } = {}) {
    let gs: PDFName | null = null;
    if (o.opacity !== undefined && o.opacity < 1) gs = page.node.newExtGState('GS', this.doc.context.obj({ ca: o.opacity, CA: o.opacity }));
    page.pushOperators(...this.ops(sh, x, y, { color: o.color, rotate: o.rotate, opacity: gs, key: pageKeyer(page), scaleX: o.scaleX, invisible: o.invisible }));
  }
}

export interface Keyer { font(f: PDFFont): PDFName; image(i: PDFImage): PDFName; }
export const pageKeyer = (page: PDFPage): Keyer => {
  const fonts = new Map<PDFFont, PDFName>(), imgs = new Map<PDFImage, PDFName>();
  return {
    font: (f) => { let n = fonts.get(f); if (!n) { n = page.node.newFontDictionary(f.name, f.ref); fonts.set(f, n); } return n; },
    image: (i) => { let n = imgs.get(i); if (!n) { n = page.node.newXObject('Image', i.ref); imgs.set(i, n); } return n; },
  };
};

function encodeGlyph(font: PDFFont, glyph: any): PDFHexString {
  const emb: any = (font as any).embedder;
  let id: number;
  if (emb.subset) {
    id = emb.subset.includeGlyph(glyph);
    emb.glyphs[id - 1] = glyph;
    emb.glyphIdMap.set(glyph.id, id);
    emb.glyphCache.invalidate();
  } else { id = glyph.id; if (!emb.used.has(id) || !emb.used.get(id).codePoints?.length) emb.used.set(id, glyph); }
  return PDFHexString.of(id.toString(16).padStart(4, '0'));
}

function utf16Hex(s: string) {
  let h = 'FEFF';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return h;
}
// Some fonts have null GPOS anchors that crash fontkit (e.g. Noto Sans Gurmukhi): retry without mark positioning.
const NO_MARKS = { mark: false, mkmk: false, curs: false, abvm: false, blwm: false, dist: false };
function safeLayout(face: Face, text: string): any | null {
  try { return face.fk.layout(text); } catch { /* fall through */ }
  try { return face.fk.layout(text, NO_MARKS); } catch { return null; }
}

const endMC = () => PDFOperator.of(PDFOperatorNames.EndMarkedContent);

/** Break text into lines that fit `width` (word wrap, honours \n). Returns logical-order line strings. */
export function wrapLines(engine: TextEngine, text: string, style: TextStyle, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      if (!w) continue;
      const next = line + w;
      if (line.trim() && engine.measure(next.trimEnd(), style, size) > width) { out.push(line.trimEnd()); line = /^\s+$/.test(w) ? '' : w; }
      else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export { PDFDocument };
