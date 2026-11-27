/**
 * PowerPoint (.pptx) → PDF, entirely in the browser. One PDF page per slide, same size as the slide.
 * Reads the Office Open XML package with jszip and the shared XML parser, resolves the
 * master → layout → slide inheritance (backgrounds, placeholders, text styles, colour map)
 * and draws with pdf-lib, so text stays real, selectable text in any language.
 * Supported: backgrounds (solid, gradient, picture), preset and custom shapes with solid or
 * gradient fills, outlines and arrows, text boxes with bullets/numbering, levels, spacing,
 * alignment, autofit, pictures (crop, rotation, flips, shape clipping), groups, tables with
 * table styles, charts, SmartArt (from its saved drawing), slide numbers and hidden slides.
 */
import {
  PDFDocument, rectangle, fill, stroke, clip, endPath, moveTo, lineTo, setFillingRgbColor, setStrokingRgbColor, setLineWidth,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, setGraphicsState, PDFName, type PDFImage, type PDFOperator, type PDFPage,
} from 'pdf-lib';
import { parseXml, kid, kids, find, type XNode } from './xml';
import { themeFrom, dmlColor, lineOf, type Theme } from './xlsxColor';
import { drawShape, geomPath, type XShape } from './xlsxDrawing';
import { parseChart, drawChart, chartTexts, type ChartSpec } from './xlsxChart';
import { TextEngine, familyFor, pageKeyer, type TextStyle, type Keyer } from './textEngine';

const EMU = 12700;
const num = (v: string | undefined, d = 0) => (v === undefined || v === '' || isNaN(+v) ? d : +v);
const hex = (h: string): [number, number, number] => [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}

// ───────────────────────── text model ─────────────────────────
interface RProps { sz?: number; b?: boolean; i?: boolean; u?: boolean; strike?: boolean; color?: string; font?: string; baseline?: number; caps?: boolean; highlight?: string; }
interface Bullet { type: 'none' | 'char' | 'num'; char?: string; font?: string; color?: string; scale?: number; scheme?: string; start?: number; }
interface PProps { algn?: string; marL?: number; indent?: number; spcBef?: [number, 'pt' | 'pct']; spcAft?: [number, 'pt' | 'pct']; lnSpc?: [number, 'pt' | 'pct']; bu?: Bullet; rtl?: boolean; def?: RProps; }
type Levels = PProps[]; // index 0..8

interface Run { text: string; r: RProps; }
interface Para { lvl: number; p: PProps; runs: Run[]; end: RProps; }
interface TextBody {
  paras: Para[]; anchor: string; inset: [number, number, number, number];
  wrap: boolean; fontScale: number; lnReduce: number; vert?: string; anchorCtr: boolean;
}

/** Context to turn scheme colours into RGB for one master (theme + colour map). */
interface Pal { theme: Theme; }

function colorOf(el: XNode | undefined, pal: Pal, phClr?: string): string | undefined {
  if (!el) return undefined;
  if (kid(el, 'noFill')) return undefined;
  const solid = kid(el, 'solidFill');
  const c = solid ? solid.c[0] : el;
  return dmlColor(c, pal.theme, phClr)?.hex;
}

function parseR(rPr: XNode | undefined, pal: Pal, phClr?: string): RProps {
  if (!rPr) return {};
  const o: RProps = {};
  if (rPr.a.sz) o.sz = num(rPr.a.sz) / 100;
  if (rPr.a.b !== undefined) o.b = rPr.a.b === '1' || rPr.a.b === 'true';
  if (rPr.a.i !== undefined) o.i = rPr.a.i === '1' || rPr.a.i === 'true';
  if (rPr.a.u !== undefined) o.u = rPr.a.u !== 'none';
  if (rPr.a.strike !== undefined) o.strike = rPr.a.strike !== 'noStrike';
  if (rPr.a.baseline) o.baseline = num(rPr.a.baseline) / 100000;
  if (rPr.a.cap !== undefined) o.caps = rPr.a.cap === 'all';
  const fillEl = kid(rPr, 'solidFill') ?? kid(rPr, 'gradFill');
  if (fillEl) { const c = fillEl.n === 'solidFill' ? dmlColor(fillEl.c[0], pal.theme, phClr)?.hex : dmlColor(find(fillEl, 'gs')[0]?.c[0], pal.theme, phClr)?.hex; if (c) o.color = c; }
  const hl = kid(rPr, 'highlight');
  if (hl) { const c = dmlColor(hl.c[0], pal.theme)?.hex; if (c) o.highlight = c; }
  const latin = kid(rPr, 'latin')?.a.typeface ?? kid(rPr, 'ea')?.a.typeface ?? kid(rPr, 'cs')?.a.typeface;
  if (latin) o.font = latin;
  return o;
}

function parseP(pPr: XNode | undefined, pal: Pal): PProps {
  if (!pPr) return {};
  const o: PProps = {};
  if (pPr.a.algn) o.algn = pPr.a.algn;
  if (pPr.a.marL !== undefined) o.marL = num(pPr.a.marL) / EMU;
  if (pPr.a.indent !== undefined) o.indent = num(pPr.a.indent) / EMU;
  if (pPr.a.rtl !== undefined) o.rtl = pPr.a.rtl === '1';
  const sp = (n: string): [number, 'pt' | 'pct'] | undefined => {
    const e = kid(pPr, n);
    if (!e) return undefined;
    const pts = kid(e, 'spcPts'), pct = kid(e, 'spcPct');
    if (pts) return [num(pts.a.val) / 100, 'pt'];
    if (pct) return [num(pct.a.val) / 100000, 'pct'];
    return undefined;
  };
  o.spcBef = sp('spcBef'); o.spcAft = sp('spcAft'); o.lnSpc = sp('lnSpc');
  if (!o.spcBef) delete o.spcBef; if (!o.spcAft) delete o.spcAft; if (!o.lnSpc) delete o.lnSpc;
  const bu: Bullet | undefined = kid(pPr, 'buNone') ? { type: 'none' }
    : kid(pPr, 'buChar') ? { type: 'char', char: kid(pPr, 'buChar')!.a.char ?? '•' }
    : kid(pPr, 'buAutoNum') ? { type: 'num', scheme: kid(pPr, 'buAutoNum')!.a.type ?? 'arabicPeriod', start: num(kid(pPr, 'buAutoNum')!.a.startAt, 1) } : undefined;
  const buFont = kid(pPr, 'buFont')?.a.typeface;
  const buClr = kid(pPr, 'buClr') ? dmlColor(kid(pPr, 'buClr')!.c[0], pal.theme)?.hex : undefined;
  const buSz = kid(pPr, 'buSzPct') ? num(kid(pPr, 'buSzPct')!.a.val) / 100000 : undefined;
  if (bu || buFont || buClr || buSz) o.bu = { ...(bu ?? { type: undefined as any }), ...(buFont ? { font: buFont } : {}), ...(buClr ? { color: buClr } : {}), ...(buSz ? { scale: buSz } : {}) };
  const def = kid(pPr, 'defRPr');
  if (def) o.def = parseR(def, pal);
  return o;
}

const clean = <T extends object>(o: T | undefined): Partial<T> => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T> : {});
function mergeP(...ps: (PProps | undefined)[]): PProps {
  const out: PProps = {};
  for (const p of ps) {
    if (!p) continue;
    const { def, bu, ...rest } = p;
    Object.assign(out, clean(rest));
    if (def) out.def = { ...out.def, ...clean(def) };
    if (bu) {
      const b = clean(bu);
      // a new bullet type replaces the old one but keeps inherited font/colour/size unless given
      out.bu = b.type ? { ...(out.bu ?? {}), ...b } as Bullet : { ...(out.bu ?? { type: 'none' }), ...b } as Bullet;
    }
  }
  return out;
}

/** lstStyle-like element (lvl1pPr…lvl9pPr) → levels. */
function parseLevels(el: XNode | undefined, pal: Pal): Levels {
  const out: Levels = [];
  for (let i = 0; i < 9; i++) out.push(parseP(kid(el, `lvl${i + 1}pPr`), pal));
  const def = kid(el, 'defPPr');
  if (def) { const d = parseP(def, pal); for (let i = 0; i < 9; i++) out[i] = mergeP(d, out[i]); }
  return out;
}
const mergeLevels = (...ls: (Levels | undefined)[]): Levels => Array.from({ length: 9 }, (_, i) => mergeP(...ls.map((l) => l?.[i])));

// ───────────────────────── shapes model ─────────────────────────
interface Xf { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean; }
interface Grad { stops: { pos: number; color: string; alpha: number }[]; angle: number; path: boolean; }
type Fill = { kind: 'solid'; color: string; alpha: number } | { kind: 'grad'; grad: Grad } | { kind: 'pic'; img: ImgRef } | null;
interface ImgRef { bytes: Uint8Array; type: 'png' | 'jpg'; crop?: [number, number, number, number]; }

type Obj =
  | { kind: 'shape'; xf: Xf; geom: string; adj: Record<string, number>; path?: XNode; fill: Fill; line: XShape['line']; head?: string; tail?: string; text?: TextBody; textXf?: Xf; styles: Levels; fontColor?: string }
  | { kind: 'pic'; xf: Xf; img: ImgRef; geom: string; adj: Record<string, number>; line: XShape['line'] }
  | { kind: 'table'; xf: Xf; table: Table }
  | { kind: 'chart'; xf: Xf; spec: ChartSpec; theme: Theme };

interface Cell { text: TextBody; fill: Fill; borders: { l?: XShape['line']; r?: XShape['line']; t?: XShape['line']; b?: XShape['line'] }; span: number; rowSpan: number; hidden: boolean; }
interface Table { cols: number[]; rows: { h: number; cells: Cell[] }[]; styles: Levels; }

interface Slide { w: number; h: number; bg: Fill; objs: Obj[]; number: number; }

export type ImageConverter = (bytes: Uint8Array, ext: string) => Promise<Uint8Array | null>; // → PNG
export interface PptxResult { pdf: Uint8Array; slides: number; hiddenSkipped: number; skippedObjects: number; missingGlyphs: number; }
export interface PptxOptions { convertImage?: ImageConverter; includeHidden?: boolean; title?: string; fetchFont?: (url: string) => Promise<Uint8Array | null>; onProgress?: (done: number, total: number) => void; }

// built-in table style used when a table names a style the file doesn't define (PowerPoint's default)
const DEFAULT_TABLE_STYLE = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';

export async function pptxToPdf(input: ArrayBuffer | Uint8Array, opts: PptxOptions = {}): Promise<PptxResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new Error('OLE_FILE');
  const { default: JSZip } = await import('jszip');
  let zip: any;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('NOT_PPTX'); }
  const xmlCache = new Map<string, Promise<XNode | null>>();
  const xml = (path: string | undefined | null): Promise<XNode | null> => {
    if (!path) return Promise.resolve(null);
    let p = xmlCache.get(path);
    if (!p) {
      p = (async () => { const f = zip.file(path) ?? zip.file(decodeURIComponent(path)); if (!f) return null; try { return parseXml(await f.async('string')); } catch { return null; } })();
      xmlCache.set(path, p);
    }
    return p;
  };
  const file = async (path: string): Promise<Uint8Array | null> => { const f = zip.file(path) ?? zip.file(decodeURIComponent(path)); return f ? await f.async('uint8array') : null; };
  const relsCache = new Map<string, Promise<Map<string, { target: string; type: string }>>>();
  const relsOf = (part: string) => {
    let p = relsCache.get(part);
    if (!p) {
      p = (async () => {
        const dir = part.split('/').slice(0, -1).join('/');
        const x = await xml(`${dir ? dir + '/' : ''}_rels/${part.split('/').pop()}.rels`);
        const m = new Map<string, { target: string; type: string }>();
        for (const r of kids(x ?? undefined, 'Relationship')) m.set(r.a.Id, { target: r.a.TargetMode === 'External' ? '' : resolvePath(part, r.a.Target ?? ''), type: r.a.Type ?? '' });
        return m;
      })();
      relsCache.set(part, p);
    }
    return p;
  };
  const relOfType = async (part: string, re: RegExp) => [...(await relsOf(part)).values()].find((r) => re.test(r.type))?.target;

  const root = await relsOf('');
  const presPath = [...root.values()].find((r) => /officeDocument$/.test(r.type))?.target ?? 'ppt/presentation.xml';
  const pres = await xml(presPath);
  if (!pres || pres.n !== 'presentation') throw new Error('NOT_PPTX');
  const presRels = await relsOf(presPath);
  const sz = kid(pres, 'sldSz');
  const W = num(sz?.a.cx, 9144000) / EMU, H = num(sz?.a.cy, 6858000) / EMU;
  const defaultText = kid(pres, 'defaultTextStyle');
  const tableStylesX = await xml(await relOfType(presPath, /\/tableStyles$/));

  let skippedObjects = 0;
  const imgCache = new Map<string, Promise<ImgRef | null>>();
  const loadImg = (path: string): Promise<ImgRef | null> => {
    let p = imgCache.get(path);
    if (!p) {
      p = (async () => {
        let b = await file(path);
        if (!b) return null;
        const ext = (path.split('.').pop() ?? '').toLowerCase();
        const sig = b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : ext;
        if (sig === 'png' || sig === 'jpg' || sig === 'jpeg') return { bytes: b, type: sig === 'png' ? 'png' : 'jpg' };
        if (/^(emf|wmf)$/.test(ext) || !opts.convertImage) return null;
        b = await opts.convertImage(b, ext);
        return b ? { bytes: b, type: 'png' } : null;
      })();
      imgCache.set(path, p);
    }
    return p;
  };

  // ── masters (theme + colour map + text styles), cached ──
  interface Master { path: string; x: XNode; pal: Pal; title: Levels; body: Levels; other: Levels; }
  const masters = new Map<string, Promise<Master>>();
  const masterOf = (path: string) => {
    let m = masters.get(path);
    if (!m) {
      m = (async () => {
        const x = (await xml(path))!;
        const base = themeFrom(await xml(await relOfType(path, /\/theme$/)));
        const map = kid(x, 'clrMap')?.a ?? {};
        const byName = { ...base.byName };
        for (const k of ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) if (map[k] && base.byName[map[k]]) byName[k] = base.byName[map[k]];
        const pal: Pal = { theme: { ...base, byName } };
        const ts = kid(x, 'txStyles');
        return { path, x, pal, title: parseLevels(kid(ts, 'titleStyle'), pal), body: parseLevels(kid(ts, 'bodyStyle'), pal), other: parseLevels(kid(ts, 'otherStyle'), pal) };
      })();
      masters.set(path, m);
    }
    return m;
  };

  /** Placeholder lookup on a layout/master spTree. */
  const phKey = (sp: XNode) => { const ph = find(kid(sp, 'nvSpPr') ?? kid(sp, 'nvPicPr') ?? kid(sp, 'nvGraphicFramePr'), 'ph')[0]; return ph ? { type: ph.a.type ?? 'body', idx: ph.a.idx } : null; };
  const findPh = (tree: XNode | undefined, key: { type: string; idx?: string }): XNode | undefined => {
    if (!tree) return undefined;
    const all = tree.c.filter((c) => c.n === 'sp' || c.n === 'pic' || c.n === 'graphicFrame');
    const norm = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);
    // same idx first, then same type
    if (key.idx !== undefined) { const m = all.find((s) => phKey(s)?.idx === key.idx && (norm(phKey(s)!.type) === norm(key.type) || key.type === 'body' || phKey(s)!.type === 'body')); if (m) return m; }
    return all.find((s) => { const k = phKey(s); return k && norm(k.type) === norm(key.type); });
  };

  const slideIds = kids(kid(pres, 'sldIdLst'), 'sldId');
  const slides: Slide[] = [];
  let hiddenSkipped = 0;
  let number = 0;

  for (const sid of slideIds) {
    const path = presRels.get(sid.a.id)?.target;
    const sx = await xml(path);
    if (!path || !sx) continue;
    number++;
    if (sx.a.show === '0' && !opts.includeHidden) { hiddenSkipped++; continue; }
    const layoutPath = await relOfType(path, /\/slideLayout$/);
    const lx = await xml(layoutPath);
    const masterPath = layoutPath ? await relOfType(layoutPath, /\/slideMaster$/) : undefined;
    if (!layoutPath || !lx || !masterPath) continue;
    const master = await masterOf(masterPath);
    const pal = master.pal;
    const mTree = kid(kid(master.x, 'cSld'), 'spTree'), lTree = kid(kid(lx, 'cSld'), 'spTree'), sTree = kid(kid(sx, 'cSld'), 'spTree');

    const ctx: BuildCtx = { pal, master, lTree, mTree, findPh, phKey, relsOf, xml, loadImg, defaultText, tableStylesX, number, skipped: () => skippedObjects++ };

    const bgOf = async (x: XNode, part: string) => {
      const bg = kid(kid(x, 'cSld'), 'bg');
      if (!bg) return undefined;
      const pr = kid(bg, 'bgPr');
      if (pr) return await fillOfEl(pr, pal, part, ctx);
      const ref = kid(bg, 'bgRef');
      if (ref) { const c = dmlColor(ref.c[0], pal.theme)?.hex; return c ? { kind: 'solid' as const, color: c, alpha: 1 } : null; }
      return undefined;
    };
    const bg = (await bgOf(sx, path)) ?? (await bgOf(lx, layoutPath)) ?? (await bgOf(master.x, masterPath)) ?? { kind: 'solid' as const, color: 'FFFFFF', alpha: 1 };

    const objs: Obj[] = [];
    const showMaster = lx.a.showMasterSp !== '0' && sx.a.showMasterSp !== '0';
    if (showMaster && mTree) await walk(mTree, masterPath, 'master', ctx, objs, identity);
    if (sx.a.showMasterSp !== '0' && lTree) await walk(lTree, layoutPath, 'layout', ctx, objs, identity);
    if (sTree) await walk(sTree, path, 'slide', ctx, objs, identity);
    slides.push({ w: W, h: H, bg, objs, number });
  }
  if (!slides.length) throw new Error(slideIds.length ? 'ALL_HIDDEN' : 'NO_SLIDES');

  // ── draw ──
  const doc = await PDFDocument.create();
  const te = await TextEngine.create(doc, opts.fetchFont);
  const texts: { text: string; style: TextStyle }[] = [{ text: '0123456789•–', style: {} }];
  const addBody = (b: TextBody | undefined, styles: Levels) => b?.paras.forEach((p, pi) => {
    for (const r of p.runs) if (r.text.trim()) texts.push({ text: r.r.caps ? r.text.toUpperCase() : r.text, style: styleOf(r.r) });
    const bu = bulletText(p, b.paras, pi);
    if (bu) texts.push({ text: bu.text, style: { family: familyFor(bu.font), bold: false } });
    void styles;
  });
  for (const s of slides) for (const o of s.objs) {
    if (o.kind === 'shape') addBody(o.text, o.styles);
    else if (o.kind === 'table') for (const r of o.table.rows) for (const c of r.cells) addBody(c.text, o.table.styles);
    else if (o.kind === 'chart') for (const t of chartTexts(o.spec)) texts.push({ text: t, style: { family: 'calibri' } }, { text: t, style: { family: 'calibri', bold: true } });
  }
  await te.prepare(texts);

  const pdfImgs = new Map<Uint8Array, PDFImage | null>();
  const embed = async (r: ImgRef) => {
    if (!pdfImgs.has(r.bytes)) { let im: PDFImage | null = null; try { im = r.type === 'png' ? await doc.embedPng(r.bytes) : await doc.embedJpg(r.bytes); } catch { im = null; skippedObjects++; } pdfImgs.set(r.bytes, im); }
    return pdfImgs.get(r.bytes)!;
  };
  for (const s of slides) {
    if (s.bg?.kind === 'pic') await embed(s.bg.img);
    for (const o of s.objs) { if (o.kind === 'pic') await embed(o.img); else if (o.kind === 'shape' && o.fill?.kind === 'pic') await embed(o.fill.img); }
  }

  let done = 0;
  for (const s of slides) {
    const page = doc.addPage([s.w, s.h]);
    const key = pageKeyer(page);
    const ops: PDFOperator[] = [];
    const gsCache = new Map<number, PDFName>();
    const alphaGs = (a: number) => { const k = Math.round(a * 100) / 100; let n = gsCache.get(k); if (!n) { n = page.node.newExtGState('GS', doc.context.obj({ ca: k, CA: k })); gsCache.set(k, n); } return n; };
    const Y = (y: number, h: number) => s.h - y - h; // top-left → PDF bottom-left
    // background
    ops.push(...fillBox(s.bg, 0, 0, s.w, s.h, null, key, pdfImgs, alphaGs));
    for (const o of s.objs) {
      const xf = o.xf;
      const yb = Y(xf.y, xf.h);
      if (o.kind === 'pic') {
        const img = pdfImgs.get(o.img.bytes);
        if (!img) continue;
        ops.push(pushGraphicsState(), ...rotFlip(xf, yb));
        if (o.geom !== 'rect') ops.push(concatTransformationMatrix(1, 0, 0, 1, xf.x, yb), ...geomPath({ geom: o.geom, adj: o.adj }, xf.w, xf.h), clip(), endPath(), concatTransformationMatrix(1, 0, 0, 1, -xf.x, -yb));
        ops.push(...placeImage(img, o.img.crop, xf.x, yb, xf.w, xf.h, key));
        ops.push(popGraphicsState());
        if (o.line) ops.push(...drawShape(shapeLike(o.geom, o.adj, undefined, null, o.line, xf), xf.x, yb, xf.w, xf.h, te, key));
      } else if (o.kind === 'shape') {
        const plain = o.fill === null || o.fill?.kind === 'solid';
        // fills that drawShape can't do (gradients, pictures, transparency) are drawn first, clipped to the geometry
        if (o.fill && (!plain || (o.fill.kind === 'solid' && o.fill.alpha < 1)) && o.geom !== 'line') {
          ops.push(pushGraphicsState(), ...rotFlip(xf, yb), concatTransformationMatrix(1, 0, 0, 1, xf.x, yb), ...geomPath({ geom: o.geom, adj: o.adj, path: o.path }, xf.w, xf.h), clip(), endPath(),
            ...fillBox(o.fill, 0, 0, xf.w, xf.h, null, key, pdfImgs, alphaGs), popGraphicsState());
        }
        const solid = o.fill?.kind === 'solid' && o.fill.alpha >= 1 ? o.fill.color : null;
        if (solid || o.line) ops.push(...drawShape(shapeLike(o.geom, o.adj, o.path, solid, o.line, xf, o.head, o.tail), xf.x, yb, xf.w, xf.h, te, key));
        if (o.text) {
          const tx = o.textXf ?? xf;
          ops.push(pushGraphicsState(), ...rotFlip({ ...tx, flipH: false, flipV: false }, Y(tx.y, tx.h)), ...drawBody(o.text, tx.x, Y(tx.y, tx.h), tx.w, tx.h, te, key, s.number), popGraphicsState());
        }
      } else if (o.kind === 'table') {
        ops.push(...drawTable(o.table, xf.x, xf.y, s.h, te, key, s.number, alphaGs));
      } else if (o.kind === 'chart') {
        ops.push(...drawChart(o.spec, { x: xf.x, y: yb, w: xf.w, h: xf.h }, te, key, o.theme));
      }
    }
    page.pushOperators(...ops);
    opts.onProgress?.(++done, slides.length);
  }
  doc.setTitle(opts.title ?? '', { showInWindowTitleBar: !!opts.title });
  doc.setProducer('PDFSherpa');
  doc.setCreator('PDFSherpa PowerPoint to PDF');
  const pdf = await doc.save({ useObjectStreams: true });
  return { pdf, slides: slides.length, hiddenSkipped, skippedObjects, missingGlyphs: te.missing };
}

// ───────────────────────── building objects ─────────────────────────
interface BuildCtx {
  pal: Pal; master: { title: Levels; body: Levels; other: Levels }; lTree?: XNode; mTree?: XNode;
  findPh: (tree: XNode | undefined, key: { type: string; idx?: string }) => XNode | undefined;
  phKey: (sp: XNode) => { type: string; idx?: string } | null;
  relsOf: (part: string) => Promise<Map<string, { target: string; type: string }>>;
  xml: (p: string | null | undefined) => Promise<XNode | null>;
  loadImg: (p: string) => Promise<ImgRef | null>;
  defaultText?: XNode; tableStylesX: XNode | null; number: number; skipped: () => void;
}
type Tx = (x: number, y: number, w: number, h: number) => [number, number, number, number];
const identity: Tx = (x, y, w, h) => [x, y, w, h];

function xfOf(xfrm: XNode | undefined, tx: Tx): Xf | null {
  const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
  if (!off || !ext) return null;
  const [x, y, w, h] = tx(num(off.a.x) / EMU, num(off.a.y) / EMU, num(ext.a.cx) / EMU, num(ext.a.cy) / EMU);
  return { x, y, w, h, rot: num(xfrm!.a.rot) / 60000, flipH: xfrm!.a.flipH === '1', flipV: xfrm!.a.flipV === '1' };
}

async function fillOfEl(spPr: XNode | undefined, pal: Pal, part: string, ctx: Pick<BuildCtx, 'relsOf' | 'loadImg'>, phClr?: string): Promise<Fill | undefined> {
  if (!spPr) return undefined;
  if (kid(spPr, 'noFill')) return null;
  const solid = kid(spPr, 'solidFill');
  if (solid) { const c = dmlColor(solid.c[0], pal.theme, phClr); return c ? { kind: 'solid', color: c.hex, alpha: c.alpha } : undefined; }
  const grad = kid(spPr, 'gradFill');
  if (grad) {
    const stops = find(grad, 'gs').map((g) => { const c = dmlColor(g.c[0], pal.theme, phClr); return c ? { pos: num(g.a.pos) / 100000, color: c.hex, alpha: c.alpha } : null; }).filter(Boolean) as Grad['stops'];
    if (!stops.length) return undefined;
    stops.sort((a, b) => a.pos - b.pos);
    const lin = kid(grad, 'lin');
    return { kind: 'grad', grad: { stops, angle: lin ? num(lin.a.ang) / 60000 : 90, path: !!kid(grad, 'path') } };
  }
  const blip = kid(spPr, 'blipFill');
  if (blip) {
    const id = find(blip, 'blip')[0]?.a.embed;
    const target = id ? (await ctx.relsOf(part)).get(id)?.target : undefined;
    const img = target ? await ctx.loadImg(target) : null;
    return img ? { kind: 'pic', img } : undefined;
  }
  const patt = kid(spPr, 'pattFill');
  if (patt) { const c = dmlColor(kid(patt, 'fgClr')?.c[0], pal.theme, phClr); return c ? { kind: 'solid', color: c.hex, alpha: c.alpha } : undefined; }
  return undefined;
}

function bodyOf(txBody: XNode | undefined, levels: Levels, pal: Pal, inherited: XNode[], fontColor?: string): TextBody | undefined {
  if (!txBody) return undefined;
  // bodyPr: slide's own over layout/master placeholder's
  const bps = [txBody, ...inherited].map((t) => kid(t, 'bodyPr')).filter(Boolean) as XNode[];
  const pick = (k: string) => bps.find((b) => b.a[k] !== undefined)?.a[k];
  const af = bps.map((b) => kid(b, 'normAutofit')).find(Boolean);
  const lst = parseLevels(kid(txBody, 'lstStyle'), pal);
  const lv = mergeLevels(levels, lst);
  const paras: Para[] = [];
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const lvl = Math.min(8, num(pPr?.a.lvl));
    const own = parseP(pPr, pal);
    const pp = mergeP(lv[lvl], own);
    if (own.rtl && !own.algn) pp.algn = 'r'; // right-to-left paragraphs start at the right
    const base: RProps = { color: fontColor, ...clean(pp.def) };
    const runs: Run[] = [];
    for (const r of p.c) {
      if (r.n === 'r') runs.push({ text: kid(r, 't')?.t ?? '', r: { ...base, ...clean(parseR(kid(r, 'rPr'), pal)) } });
      else if (r.n === 'fld') runs.push({ text: r.a.type === 'slidenum' ? '\u0000SLIDENUM' : kid(r, 't')?.t ?? '', r: { ...base, ...clean(parseR(kid(r, 'rPr'), pal)) } });
      else if (r.n === 'br') runs.push({ text: '\n', r: { ...base, ...clean(parseR(kid(r, 'rPr'), pal)) } });
    }
    paras.push({ lvl, p: pp, runs, end: { ...base, ...clean(parseR(kid(p, 'endParaRPr'), pal)) } });
  }
  if (!paras.some((p) => p.runs.some((r) => r.text.trim()))) return undefined;
  const ins = (k: string, d: number) => num(pick(k), d) / EMU;
  return {
    paras, anchor: pick('anchor') ?? 't', anchorCtr: pick('anchorCtr') === '1',
    inset: [ins('lIns', 91440), ins('tIns', 45720), ins('rIns', 91440), ins('bIns', 45720)],
    wrap: pick('wrap') !== 'none', vert: pick('vert'),
    fontScale: af ? num(af.a.fontScale, 100000) / 100000 : 1, lnReduce: af ? num(af.a.lnSpcReduction) / 100000 : 0,
  };
}

function styleRefColor(style: XNode | undefined, name: string, pal: Pal) { const r = kid(style, name); return r && num(r.a.idx) > 0 ? dmlColor(r.c[0], pal.theme)?.hex : undefined; }

async function walk(tree: XNode, part: string, layer: 'master' | 'layout' | 'slide', ctx: BuildCtx, out: Obj[], tx: Tx): Promise<void> {
  for (const el of tree.c) {
    if (el.n === 'AlternateContent') {
      const ch = kid(el, 'Choice'), fb = kid(el, 'Fallback');
      const use = ch && !/p14|a14|p15/.test('') ? ch : fb;
      if (use) await walk(use, part, layer, ctx, out, tx);
      continue;
    }
    if (!['sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp'].includes(el.n)) continue;
    const nv = find(el, 'cNvPr')[0];
    if (nv?.a.hidden === '1' || nv?.a.hidden === 'true') continue;
    const ph = ctx.phKey(el);
    // placeholders on masters/layouts are prompts ("Click to add title"), never drawn on slides
    if (ph && layer !== 'slide') continue;
    try {
      if (el.n === 'grpSp') {
        const gx = kid(kid(el, 'grpSpPr'), 'xfrm');
        const off = kid(gx, 'off'), ext = kid(gx, 'ext'), chOff = kid(gx, 'chOff'), chExt = kid(gx, 'chExt');
        if (!off || !ext) { await walk(el, part, layer, ctx, out, tx); continue; }
        const [gx0, gy0, gw, gh] = tx(num(off.a.x) / EMU, num(off.a.y) / EMU, num(ext.a.cx) / EMU, num(ext.a.cy) / EMU);
        const cx0 = num(chOff?.a.x, num(off.a.x)) / EMU, cy0 = num(chOff?.a.y, num(off.a.y)) / EMU;
        const cw = num(chExt?.a.cx, num(ext.a.cx)) / EMU || 1, ch = num(chExt?.a.cy, num(ext.a.cy)) / EMU || 1;
        const sx = gw / cw, sy = gh / ch;
        await walk(el, part, layer, ctx, out, (x, y, w, h) => [gx0 + (x - cx0) * sx, gy0 + (y - cy0) * sy, w * sx, h * sy]);
        continue;
      }
      const lPh = ph ? ctx.findPh(ctx.lTree, ph) : undefined;
      const mPh = ph ? ctx.findPh(ctx.mTree, lPh ? ctx.phKey(lPh) ?? ph : ph) : undefined;
      const spPr = kid(el, 'spPr') ?? kid(el, 'grpSpPr');
      const xfrmEl = el.n === 'graphicFrame' ? kid(el, 'xfrm') : kid(spPr, 'xfrm');
      const xf = xfOf(xfrmEl, tx) ?? xfOf(kid(kid(lPh, 'spPr'), 'xfrm'), tx) ?? xfOf(kid(kid(mPh, 'spPr'), 'xfrm'), tx);
      if (!xf || xf.w < 0 || xf.h < 0) continue;

      if (el.n === 'graphicFrame') {
        const tbl = find(el, 'tbl')[0];
        if (tbl) { out.push({ kind: 'table', xf, table: buildTable(tbl, ctx) }); continue; }
        const chartRef = find(el, 'chart')[0];
        if (chartRef?.a.id) {
          const t = (await ctx.relsOf(part)).get(chartRef.a.id)?.target;
          const cx = await ctx.xml(t);
          const spec = cx ? parseChart(cx, ctx.pal.theme) : null;
          if (spec) out.push({ kind: 'chart', xf, spec, theme: ctx.pal.theme }); else ctx.skipped();
          continue;
        }
        // SmartArt: PowerPoint saves a ready-made drawing of the diagram
        const rels = await ctx.relsOf(part);
        const dm = find(el, 'relIds')[0];
        if (dm) {
          const drawing = [...rels.values()].find((r) => /diagramDrawing$/.test(r.type) && r.target);
          const dx = await ctx.xml(drawing?.target);
          const dTree = dx ? find(dx, 'spTree')[0] : undefined;
          if (dTree && drawing) { await walk(dTree, drawing.target, 'slide', { ...ctx, phKey: () => null }, out, (x, y, w, h) => [xf.x + x, xf.y + y, w, h]); continue; }
        }
        ctx.skipped();
        continue;
      }

      const style = kid(el, 'style');
      if (el.n === 'pic') {
        const blip = find(el, 'blip')[0];
        // prefer an SVG-free raster: the main embed is always PNG/JPEG/EMF
        const id = blip?.a.embed;
        const target = id ? (await ctx.relsOf(part)).get(id)?.target : undefined;
        const img = target ? await ctx.loadImg(target) : null;
        if (!img) { ctx.skipped(); continue; }
        const src = find(kid(el, 'blipFill'), 'srcRect')[0];
        const crop = src ? ([num(src.a.l), num(src.a.t), num(src.a.r), num(src.a.b)].map((v) => v / 100000) as [number, number, number, number]) : undefined;
        const prst = kid(spPr, 'prstGeom');
        const line = lineOf(spPr, ctx.pal.theme, styleRefColor(style, 'lnRef', ctx.pal)) ?? null;
        out.push({ kind: 'pic', xf, img: { ...img, crop: crop?.some((v) => v) ? crop : undefined }, geom: prst?.a.prst ?? 'rect', adj: adjOf(prst), line });
        continue;
      }

      // sp / cxnSp
      const prst = kid(spPr, 'prstGeom');
      const isLine = el.n === 'cxnSp' || /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(prst?.a.prst ?? '');
      const lPr = kid(lPh, 'spPr'), mPr = kid(mPh, 'spPr');
      let fill = await fillOfEl(spPr, ctx.pal, part, ctx);
      if (fill === undefined && lPr) fill = await fillOfEl(lPr, ctx.pal, part, ctx);
      if (fill === undefined && mPr) fill = await fillOfEl(mPr, ctx.pal, part, ctx);
      if (fill === undefined) { const c = isLine ? undefined : styleRefColor(style, 'fillRef', ctx.pal); fill = c ? { kind: 'solid', color: c, alpha: 1 } : null; }
      let line = lineOf(spPr, ctx.pal.theme, styleRefColor(style, 'lnRef', ctx.pal));
      if (line === undefined) { const lc = styleRefColor(style, 'lnRef', ctx.pal); line = lc ? { color: lc, w: isLine ? 0.75 : 1 } : null; }
      const lnEl = kid(spPr, 'ln');
      const fontColor = kid(style, 'fontRef') ? dmlColor(kid(style, 'fontRef')!.c[0], ctx.pal.theme)?.hex : undefined;
      // text styles: master txStyles by placeholder type, then master/layout placeholder lstStyles
      const type = ph?.type;
      const baseLv = !ph ? mergeLevels(parseLevels(ctx.defaultText, ctx.pal), ctx.master.other.map(() => ({}))) : type === 'title' || type === 'ctrTitle' ? ctx.master.title : type === 'body' || type === 'subTitle' || type === 'obj' || ph.idx !== undefined && !['dt', 'ftr', 'sldNum', 'hdr'].includes(type ?? '') ? ctx.master.body : ctx.master.other;
      const levels = mergeLevels(baseLv, parseLevels(kid(kid(mPh, 'txBody'), 'lstStyle'), ctx.pal), parseLevels(kid(kid(lPh, 'txBody'), 'lstStyle'), ctx.pal));
      // footer/date/slide-number placeholders show only when the slide has its own copy (it does when "show" is on)
      const text = bodyOf(kid(el, 'txBody'), levels, ctx.pal, [kid(lPh, 'txBody'), kid(mPh, 'txBody')].filter(Boolean) as XNode[], fontColor);
      const txXfrm = kid(el, 'txXfrm');
      const textXf = txXfrm ? xfOf(txXfrm, tx) ?? undefined : undefined;
      const geom = isLine ? 'line' : prst?.a.prst ?? (kid(spPr, 'custGeom') ? 'custom' : 'rect');
      if (fill === null && !line && !text) continue;
      out.push({ kind: 'shape', xf, geom, adj: adjOf(prst), path: kid(spPr, 'custGeom'), fill, line, head: kid(lnEl, 'headEnd')?.a.type, tail: kid(lnEl, 'tailEnd')?.a.type, text, textXf, styles: levels, fontColor });
    } catch { ctx.skipped(); }
  }
}

function adjOf(prst: XNode | undefined) {
  const adj: Record<string, number> = {};
  for (const g of kids(kid(prst, 'avLst'), 'gd')) { const m = /val\s+(-?\d+)/.exec(g.a.fmla ?? ''); if (m) adj[g.a.name] = +m[1]; }
  return adj;
}

// ───────────────────────── tables ─────────────────────────
interface TStylePart { fill?: string; color?: string; b?: boolean; borders: Partial<Record<'left' | 'right' | 'top' | 'bottom' | 'insideH' | 'insideV', XShape['line']>>; }

function tableStyle(id: string | undefined, ctx: BuildCtx): Record<string, TStylePart> | null {
  const pal = ctx.pal;
  const styles = kids(ctx.tableStylesX ?? undefined, 'tblStyle');
  const st = styles.find((s) => s.a.styleId === id) ?? (id === DEFAULT_TABLE_STYLE || !id ? null : null);
  if (!st) {
    if (!id) return null;
    // PowerPoint's default "Medium Style 2 – Accent 1" when the definition isn't stored
    const acc = pal.theme.byName.accent1 ?? '4472C4';
    const tint = (h: string, t: number) => { const c = hex(h); const m = (v: number) => Math.round((v + (1 - v) * t) * 255).toString(16).padStart(2, '0'); return (m(c[0]) + m(c[1]) + m(c[2])).toUpperCase(); };
    const white = { color: 'FFFFFF', w: 1 };
    return {
      wholeTbl: { fill: tint(acc, 0.8), color: '000000', borders: { left: white, right: white, top: white, bottom: white, insideH: white, insideV: white } },
      band1H: { fill: tint(acc, 0.6), borders: {} }, band1V: { fill: tint(acc, 0.6), borders: {} },
      firstRow: { fill: acc, color: 'FFFFFF', b: true, borders: { bottom: { color: 'FFFFFF', w: 3 } } },
      lastRow: { fill: acc, color: 'FFFFFF', b: true, borders: { top: { color: 'FFFFFF', w: 3 } } },
      firstCol: { fill: acc, color: 'FFFFFF', b: true, borders: {} }, lastCol: { fill: acc, color: 'FFFFFF', b: true, borders: {} },
    };
  }
  const out: Record<string, TStylePart> = {};
  for (const part of st.c) {
    const tcTx = kid(part, 'tcTxStyle'), tcSt = kid(part, 'tcStyle');
    const fillEl = kid(kid(tcSt, 'fill'), 'solidFill');
    const fillRef = kid(tcSt, 'fillRef');
    const fillC = fillEl ? dmlColor(fillEl.c[0], pal.theme)?.hex : fillRef ? dmlColor(fillRef.c[0], pal.theme)?.hex : undefined;
    const txColor = tcTx ? dmlColor(tcTx.c.find((c) => /Clr$/.test(c.n)) ?? kid(tcTx, 'fontRef')?.c[0], pal.theme)?.hex : undefined;
    const borders: TStylePart['borders'] = {};
    for (const b of kids(kid(tcSt, 'tcBdr'))) {
      const ln = kid(b, 'ln');
      const lnRef = kid(b, 'lnRef');
      if (ln) { const l = lineOf({ n: 'x', a: {}, c: [ln], t: '' }, pal.theme); if (l !== undefined) borders[b.n as keyof TStylePart['borders']] = l; }
      else if (lnRef) { const c = dmlColor(lnRef.c[0], pal.theme)?.hex; if (c) borders[b.n as keyof TStylePart['borders']] = { color: c, w: 1 }; }
    }
    out[part.n] = { fill: fillC, color: txColor, b: tcTx?.a.b === 'on' ? true : undefined, borders };
  }
  return out;
}

function buildTable(tbl: XNode, ctx: BuildCtx): Table {
  const pal = ctx.pal;
  const tblPr = kid(tbl, 'tblPr');
  const flags = { firstRow: tblPr?.a.firstRow === '1', lastRow: tblPr?.a.lastRow === '1', firstCol: tblPr?.a.firstCol === '1', lastCol: tblPr?.a.lastCol === '1', bandRow: tblPr?.a.bandRow === '1', bandCol: tblPr?.a.bandCol === '1' };
  const style = tableStyle(kid(tblPr, 'tableStyleId')?.t?.trim(), ctx);
  const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => num(g.a.w) / EMU);
  const trs = kids(tbl, 'tr');
  const levels = mergeLevels(parseLevels(ctx.defaultText, pal), ctx.master.other);
  const rows = trs.map((tr, ri) => {
    const tcs = kids(tr, 'tc');
    const cells: Cell[] = tcs.map((tc, ci) => {
      const tcPr = kid(tc, 'tcPr');
      // style parts that apply to this cell, weakest first
      const parts: TStylePart[] = [];
      if (style) {
        const push = (k: string) => { if (style[k]) parts.push(style[k]); };
        push('wholeTbl');
        if (flags.bandCol && ci % 2 === (flags.firstCol ? 1 : 0)) push('band1V');
        if (flags.bandRow && ri % 2 === (flags.firstRow ? 1 : 0)) push('band1H');
        if (flags.firstCol && ci === 0) push('firstCol');
        if (flags.lastCol && ci === tcs.length - 1) push('lastCol');
        if (flags.lastRow && ri === trs.length - 1) push('lastRow');
        if (flags.firstRow && ri === 0) push('firstRow');
      }
      const st = parts.reduce<TStylePart>((a, p) => ({ fill: p.fill ?? a.fill, color: p.color ?? a.color, b: p.b ?? a.b, borders: { ...a.borders, ...p.borders } }), { borders: {} });
      const nRow = trs.length, nCol = cols.length;
      const sb = st.borders;
      const fromStyle = {
        l: ci === 0 ? sb.left : sb.insideV ?? sb.left, r: ci === nCol - 1 ? sb.right : sb.insideV ?? sb.right,
        t: ri === 0 ? sb.top : sb.insideH ?? sb.top, b: ri === nRow - 1 ? sb.bottom : sb.insideH ?? sb.bottom,
      };
      const own = (n: string) => { const ln = kid(tcPr, n); if (!ln) return undefined; return lineOf({ n: 'x', a: {}, c: [{ ...ln, n: 'ln' }], t: '' }, pal.theme) };
      const fillEl = tcPr ? kid(tcPr, 'noFill') ? null : kid(tcPr, 'solidFill') ? dmlColor(kid(tcPr, 'solidFill')!.c[0], pal.theme) : undefined : undefined;
      const fill: Fill = fillEl === null ? null : fillEl ? { kind: 'solid', color: fillEl.hex, alpha: fillEl.alpha } : st.fill ? { kind: 'solid', color: st.fill, alpha: 1 } : null;
      const body = bodyOf(kid(tc, 'txBody'), levels.map((l) => mergeP(l, { def: { ...(st.color ? { color: st.color } : {}), ...(st.b ? { b: true } : {}) } })), pal, []) ?? { paras: [], anchor: 't', anchorCtr: false, inset: [0, 0, 0, 0], wrap: true, fontScale: 1, lnReduce: 0 };
      body.inset = [num(tcPr?.a.marL, 91440) / EMU, num(tcPr?.a.marT, 45720) / EMU, num(tcPr?.a.marR, 91440) / EMU, num(tcPr?.a.marB, 45720) / EMU];
      body.anchor = tcPr?.a.anchor ?? 't';
      return {
        text: body, fill,
        borders: { l: own('lnL') ?? fromStyle.l, r: own('lnR') ?? fromStyle.r, t: own('lnT') ?? fromStyle.t, b: own('lnB') ?? fromStyle.b },
        span: num(tc.a.gridSpan, 1), rowSpan: num(tc.a.rowSpan, 1), hidden: tc.a.hMerge === '1' || tc.a.vMerge === '1',
      };
    });
    return { h: num(tr.a.h) / EMU, cells };
  });
  return { cols, rows, styles: levels };
}

// ───────────────────────── drawing helpers ─────────────────────────
function shapeLike(geom: string, adj: Record<string, number>, path: XNode | undefined, fill: string | null, line: XShape['line'], xf: Xf, head?: string, tail?: string): XShape {
  return { kind: 'shape', c0: 0, r0: 0, dx0: 0, dy0: 0, c1: 0, r1: 0, dx1: 0, dy1: 0, geom, fill, line, paras: [], vAnchor: 't', rot: xf.rot, flipH: xf.flipH, flipV: xf.flipV, inset: [0, 0, 0, 0], head, tail, textColor: '000000', path, adj };
}

/** Rotation (clockwise, degrees) and flips about the centre of a box whose bottom-left is (xf.x, yb). */
function rotFlip(xf: Xf, yb: number): PDFOperator[] {
  if (!xf.rot && !xf.flipH && !xf.flipV) return [];
  const cx = xf.x + xf.w / 2, cy = yb + xf.h / 2, r = (-xf.rot * Math.PI) / 180;
  return [concatTransformationMatrix(1, 0, 0, 1, cx, cy), concatTransformationMatrix(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0),
    concatTransformationMatrix(xf.flipH ? -1 : 1, 0, 0, xf.flipV ? -1 : 1, 0, 0), concatTransformationMatrix(1, 0, 0, 1, -cx, -cy)];
}

function placeImage(img: PDFImage, crop: ImgRef['crop'], x: number, y: number, w: number, h: number, key: Keyer): PDFOperator[] {
  const name = key.image(img);
  if (!crop) return [pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, x, y), drawObject(name), popGraphicsState()];
  const [l, t, r, b] = crop;
  const fw = w / Math.max(0.01, 1 - l - r), fh = h / Math.max(0.01, 1 - t - b);
  return [pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath(), concatTransformationMatrix(fw, 0, 0, fh, x - l * fw, y - b * fh), drawObject(name), popGraphicsState()];
}

const mixHex = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return A.map((v, i) => v + (B[i] - v) * t) as [number, number, number]; };

/** Paint a fill into a box (PDF coords). Gradients are drawn as fine bands along the gradient angle. */
function fillBox(f: Fill | undefined, x: number, y: number, w: number, h: number, _clip: null, key: Keyer, imgs: Map<Uint8Array, PDFImage | null>, gs: (a: number) => PDFName): PDFOperator[] {
  if (!f) return [];
  if (f.kind === 'solid') return [pushGraphicsState(), ...(f.alpha < 1 ? [setGraphicsState(gs(f.alpha))] : []), setFillingRgbColor(...hex(f.color)), rectangle(x, y, w, h), fill(), popGraphicsState()];
  if (f.kind === 'pic') { const im = imgs.get(f.img.bytes); return im ? placeImage(im, f.img.crop, x, y, w, h, key) : []; }
  const { stops, angle } = f.grad;
  const colorAt = (t: number): [number, number, number] => {
    if (t <= stops[0].pos) return hex(stops[0].color);
    for (let i = 1; i < stops.length; i++) if (t <= stops[i].pos) { const a = stops[i - 1], b = stops[i]; return mixHex(a.color, b.color, (t - a.pos) / Math.max(1e-6, b.pos - a.pos)); }
    return hex(stops[stops.length - 1].color);
  };
  // direction in y-down slide space (DrawingML angles run clockwise from →)
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad), dy = -Math.sin(rad); // PDF y up
  const len = Math.abs(w * dx) + Math.abs(h * dy) || 1;
  const N = 96;
  const o: PDFOperator[] = [pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath()];
  // rotate so bands are perpendicular to the gradient direction
  const cx = x + w / 2, cy = y + h / 2;
  o.push(concatTransformationMatrix(dx, dy, -dy, dx, cx, cy));
  const diag = Math.hypot(w, h);
  for (let i = 0; i < N; i++) {
    const t0 = i / N;
    o.push(setFillingRgbColor(...colorAt((i + 0.5) / N)), rectangle(-len / 2 + t0 * len, -diag, len / N + 0.5, diag * 2), fill());
  }
  o.push(popGraphicsState());
  return o;
}

// ───────────────────────── text layout ─────────────────────────
const styleOf = (r: RProps): TextStyle => ({ family: familyFor(r.font), bold: r.b, italic: r.i });
const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
const roman = (n: number) => { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; };
const alpha = (n: number) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };

/** Wingdings/Symbol bullet code points → Unicode look-alikes. */
const SYMBOL_BULLETS: Record<string, string> = { '§': '▪', 'Ø': '➢', 'ü': '✓', 'q': '❑', 'v': '❖', 'n': '■', 'l': '●', 'Ú': '➢', 'à': '→', 'è': '→', '\uF0A7': '▪', '\uF0D8': '➢', '\uF0FC': '✓', '\uF0B7': '•', '\uF06C': '●' };

function bulletText(p: Para, all: Para[], idx: number): { text: string; font?: string; color?: string; scale: number } | null {
  const bu = p.p.bu;
  if (!bu || bu.type === 'none' || !bu.type) return null;
  if (!p.runs.some((r) => r.text.trim())) return null;
  if (bu.type === 'char') {
    let ch = bu.char ?? '•';
    const font = bu.font ?? '';
    if (/wingdings|symbol|webdings/i.test(font) || SYMBOL_BULLETS[ch] && ch.charCodeAt(0) >= 0xf000) ch = SYMBOL_BULLETS[ch] ?? '•';
    return { text: ch, font: /wingdings|symbol|webdings/i.test(font) ? undefined : font || undefined, color: bu.color, scale: bu.scale ?? 1 };
  }
  // numbering: count previous paragraphs at the same level with numbering, reset by a lower level
  let n = bu.start ?? 1;
  for (let i = idx - 1; i >= 0; i--) {
    const q = all[i];
    if (q.lvl < p.lvl) break;
    if (q.lvl === p.lvl) { if (q.p.bu?.type === 'num' && q.runs.some((r) => r.text.trim())) n++; else if (q.runs.some((r) => r.text.trim())) break; }
  }
  const s = bu.scheme ?? 'arabicPeriod';
  const core = /^roman/.test(s) ? roman(n) : /^alpha/.test(s) ? alpha(n) : String(n);
  const cased = /Uc/.test(s) ? core.toUpperCase() : core;
  const text = /ParenBoth/.test(s) ? `(${cased})` : /ParenR/.test(s) ? `${cased})` : /Plain/.test(s) ? cased : `${cased}.`;
  return { text, color: bu.color, scale: bu.scale ?? 1 };
}

interface Part { text: string; style: TextStyle; size: number; color: string; u: boolean; strike: boolean; rise: number; highlight?: string; w: number; }
interface Line { parts: Part[]; width: number; asc: number; desc: number; size: number; x0: number; avail: number; algn: string; bullet?: Part & { x: number }; spaceBefore: number; lineFactor: [number, 'pt' | 'pct']; rtl: boolean; }

function layoutBody(b: TextBody, width: number, te: TextEngine, slideNo: number): Line[] {
  const [li, , ri] = b.inset;
  const lines: Line[] = [];
  const fs = b.fontScale;
  b.paras.forEach((p, pi) => {
    const pp = p.p;
    const marL = pp.marL ?? 0, indent = pp.indent ?? 0;
    const avail = Math.max(4, width - li - ri);
    const firstSize = ((p.runs.find((r) => r.text.trim())?.r.sz ?? p.end.sz ?? 18) * fs);
    const lnSpc: [number, 'pt' | 'pct'] = pp.lnSpc ? [pp.lnSpc[1] === 'pct' ? pp.lnSpc[0] * (1 - b.lnReduce) : pp.lnSpc[0], pp.lnSpc[1]] : [1 - b.lnReduce, 'pct'];
    const before = pp.spcBef ? (pp.spcBef[1] === 'pt' ? pp.spcBef[0] : pp.spcBef[0] * firstSize * 1.2) : 0;
    const after = pp.spcAft ? (pp.spcAft[1] === 'pt' ? pp.spcAft[0] : pp.spcAft[0] * firstSize * 1.2) : 0;
    const algn = pp.algn ?? (pp.rtl ? 'r' : 'l');
    const bu = bulletText(p, b.paras, pi);
    let line: Line | null = null;
    let first = true;
    const start = (): Line => {
      const x0 = first ? marL + indent : marL;
      const l: Line = { parts: [], width: 0, asc: 0, desc: 0, size: 0, x0, avail: Math.max(4, avail - x0), algn, spaceBefore: first ? before : 0, lineFactor: lnSpc, rtl: !!pp.rtl };
      if (first && bu) {
        const size = firstSize * bu.scale;
        const st: TextStyle = { family: familyFor(bu.font), bold: false };
        const w = te.measure(bu.text, st, size);
        l.bullet = { text: bu.text, style: st, size, color: bu.color ?? p.runs[0]?.r.color ?? '000000', u: false, strike: false, rise: 0, w, x: marL + indent };
        // text starts at marL, or after the bullet when the hanging indent is too small
        l.x0 = Math.max(marL, marL + indent + w + size * 0.3 * (indent >= 0 ? 1 : 0));
        if (indent < 0 && marL + indent + w > marL) l.x0 = marL + indent + w + size * 0.25;
        l.avail = Math.max(4, avail - l.x0);
        l.asc = size * 0.9; l.desc = size * 0.25; l.size = size;
      }
      first = false;
      return l;
    };
    const flush = () => { if (line) lines.push(line); line = null; };
    line = start();
    const empty = !p.runs.some((r) => r.text.length);
    if (empty) {
      const size = (p.end.sz ?? 18) * fs;
      line.asc = size * 0.9; line.desc = size * 0.25; line.size = size;
      flush();
    }
    for (const run of p.runs) {
      const r = run.r;
      const size = (r.sz ?? 18) * fs;
      const style = styleOf(r);
      const color = r.color ?? '000000';
      let text = run.text === '\u0000SLIDENUM' ? String(slideNo) : run.text;
      if (r.caps) text = text.toUpperCase();
      for (const seg of text.split(/(\n)/)) {
        if (seg === '\n') { if (!line!.parts.length) { line!.asc = Math.max(line!.asc, size * 0.9); line!.desc = Math.max(line!.desc, size * 0.25); line!.size = Math.max(line!.size, size); } flush(); line = start(); continue; }
        // words (keep spaces attached); CJK and very long words break between characters
        const words = seg.split(/(?<=\s)/).flatMap((w) => (/[　-鿿가-힯฀-๿]/.test(w) ? [...w] : [w]));
        for (let word of words) {
          if (!word) continue;
          let ww = te.measure(word, style, size);
          const trimmed = te.measure(word.trimEnd(), style, size);
          if (b.wrap && line!.parts.length && line!.width + trimmed > line!.avail + 0.01) { flush(); line = start(); if (/^\s+$/.test(word)) continue; }
          if (b.wrap && !line!.parts.length && trimmed > line!.avail && word.trim().length > 1) {
            // break an over-long word
            let chunk = '';
            for (const ch of [...word]) {
              const cw = te.measure(chunk + ch, style, size);
              if (chunk && cw > line!.avail) { pushPart(line!, chunk, style, size, color, r, te); flush(); line = start(); chunk = ch; } else chunk += ch;
            }
            word = chunk; ww = te.measure(word, style, size);
          }
          pushPart(line!, word, style, size, color, r, te, ww);
        }
      }
    }
    if (line && (line.parts.length || !lines.length || lines[lines.length - 1] !== line)) { if (line.parts.length || !empty) flush(); }
    if (lines.length) (lines[lines.length - 1] as any).after = after;
  });
  return lines;
}

function pushPart(line: Line, text: string, style: TextStyle, size: number, color: string, r: RProps, te: TextEngine, w?: number) {
  const width = w ?? te.measure(text, style, size);
  const last = line.parts[line.parts.length - 1];
  const rise = r.baseline ? r.baseline * size : 0;
  const sz = r.baseline ? size * 0.66 : size;
  if (last && last.style.family === style.family && !!last.style.bold === !!style.bold && !!last.style.italic === !!style.italic && last.size === sz && last.color === color && last.u === !!r.u && last.strike === !!r.strike && last.rise === rise && last.highlight === r.highlight) {
    last.text += text; last.w += width;
  } else line.parts.push({ text, style, size: sz, color, u: !!r.u, strike: !!r.strike, rise, highlight: r.highlight, w: r.baseline ? te.measure(text, style, sz) : width });
  line.width += r.baseline ? te.measure(text, style, sz) : width;
  line.asc = Math.max(line.asc, size * 0.9); line.desc = Math.max(line.desc, size * 0.25); line.size = Math.max(line.size, size);
}

const lineHeight = (l: Line) => (l.lineFactor[1] === 'pt' ? l.lineFactor[0] : (l.asc + l.desc) * 1.0 * l.lineFactor[0] + l.size * 0.07 * l.lineFactor[0]);

function bodyHeight(lines: Line[]) {
  return lines.reduce((t, l, i) => t + (i ? l.spaceBefore : 0) + lineHeight(l) + ((l as any).after && i < lines.length - 1 ? (l as any).after : 0), 0);
}

/** Draw a text body into the box (x, yb = bottom, w, h) in PDF coordinates. */
function drawBody(b: TextBody, x: number, yb: number, w: number, h: number, te: TextEngine, key: Keyer, slideNo: number): PDFOperator[] {
  const lines = layoutBody(b, w, te, slideNo);
  if (!lines.length) return [];
  const [li, ti, ri, bi] = b.inset;
  const total = bodyHeight(lines);
  const innerH = h - ti - bi;
  let top = b.anchor === 'ctr' ? yb + bi + (innerH + total) / 2 : b.anchor === 'b' ? yb + bi + total : yb + h - ti;
  const o: PDFOperator[] = [];
  lines.forEach((l, i) => {
    if (i) top -= l.spaceBefore;
    const lh = lineHeight(l);
    // baseline sits so the ascent fits in the first part of the line box
    const base = top - lh + l.desc + (lh - (l.asc + l.desc)) * 0.15;
    const trimW = l.parts.length ? l.width - (l.parts[l.parts.length - 1].w - te.measure(l.parts[l.parts.length - 1].text.trimEnd(), l.parts[l.parts.length - 1].style, l.parts[l.parts.length - 1].size)) : 0;
    let px: number;
    if (l.rtl) {
      // indents and bullets mirror: they are measured from the right edge
      const right = x + w - ri - l.x0;
      px = l.algn === 'ctr' ? x + li + (l.avail - trimW) / 2 : l.algn === 'l' ? x + li : right - trimW;
    } else px = l.algn === 'ctr' ? x + li + l.x0 + (l.avail - trimW) / 2 : l.algn === 'r' ? x + li + l.x0 + l.avail - trimW : x + li + l.x0;
    if (l.bullet) {
      const sh = te.shape(l.bullet.text, l.bullet.style, l.bullet.size);
      const bx = l.rtl ? (l.algn === 'r' ? x + w - ri - l.bullet.x - sh.width : px + trimW + l.bullet.size * 0.3)
        : l.algn === 'l' || l.algn === 'just' || l.algn === 'dist' ? x + li + l.bullet.x : px - sh.width - l.bullet.size * 0.3;
      o.push(...te.ops(sh, bx, base, { color: hex(l.bullet.color), key }));
    }
    const parts = l.rtl ? [...l.parts].reverse() : l.parts;
    for (const p of parts) {
      const sh = te.shape(p.text, p.style, p.size, l.rtl || undefined);
      const c = hex(p.color);
      if (p.highlight) o.push(pushGraphicsState(), setFillingRgbColor(...hex(p.highlight)), rectangle(px, base - p.size * 0.25 + p.rise, sh.width, p.size * 1.15), fill(), popGraphicsState());
      o.push(...te.ops(sh, px, base + p.rise, { color: c, key }));
      if (p.u || p.strike) {
        o.push(pushGraphicsState(), setStrokingRgbColor(...c), setLineWidth(Math.max(0.5, p.size * 0.05)));
        const ws = te.measure(p.text.trimEnd(), p.style, p.size);
        if (p.u) o.push(moveTo(px, base - p.size * 0.12 + p.rise), lineTo(px + ws, base - p.size * 0.12 + p.rise), stroke());
        if (p.strike) o.push(moveTo(px, base + p.size * 0.3 + p.rise), lineTo(px + ws, base + p.size * 0.3 + p.rise), stroke());
        o.push(popGraphicsState());
      }
      px += sh.width;
    }
    top -= lh + ((l as any).after ?? 0);
  });
  return o;
}

function drawTable(t: Table, x0: number, y0: number, pageH: number, te: TextEngine, key: Keyer, slideNo: number, gs: (a: number) => PDFName): PDFOperator[] {
  const o: PDFOperator[] = [];
  const colX = [0];
  for (const w of t.cols) colX.push(colX[colX.length - 1] + w);
  // row heights grow to fit their text
  const heights = t.rows.map((r) => {
    let h = r.h;
    r.cells.forEach((c, ci) => {
      if (c.hidden || c.rowSpan > 1) return;
      const w = colX[Math.min(t.cols.length, ci + c.span)] - colX[ci];
      const lines = layoutBody(c.text, w, te, slideNo);
      h = Math.max(h, bodyHeight(lines) + c.text.inset[1] + c.text.inset[3]);
    });
    return h;
  });
  const rowY = [0];
  for (const h of heights) rowY.push(rowY[rowY.length - 1] + h);
  const box = (ri: number, ci: number, c: Cell) => {
    const x = x0 + colX[ci], w = colX[Math.min(t.cols.length, ci + c.span)] - colX[ci];
    const top = y0 + rowY[ri], h = rowY[Math.min(t.rows.length, ri + c.rowSpan)] - rowY[ri];
    return { x, w, yb: pageH - top - h, h };
  };
  // fills, then text, then borders on top
  t.rows.forEach((r, ri) => r.cells.forEach((c, ci) => {
    if (c.hidden || ci >= t.cols.length) return;
    const b = box(ri, ci, c);
    if (c.fill?.kind === 'solid') o.push(pushGraphicsState(), ...(c.fill.alpha < 1 ? [setGraphicsState(gs(c.fill.alpha))] : []), setFillingRgbColor(...hex(c.fill.color)), rectangle(b.x, b.yb, b.w, b.h), fill(), popGraphicsState());
    if (c.text.paras.length) o.push(pushGraphicsState(), rectangle(b.x, b.yb, b.w, b.h), clip(), endPath(), ...drawBody(c.text, b.x, b.yb, b.w, b.h, te, key, slideNo), popGraphicsState());
  }));
  t.rows.forEach((r, ri) => r.cells.forEach((c, ci) => {
    if (c.hidden || ci >= t.cols.length) return;
    const b = box(ri, ci, c);
    const edge = (ln: XShape['line'] | undefined, x1: number, y1: number, x2: number, y2: number) => { if (ln && ln.w > 0) o.push(pushGraphicsState(), setStrokingRgbColor(...hex(ln.color)), setLineWidth(ln.w), moveTo(x1, y1), lineTo(x2, y2), stroke(), popGraphicsState()); };
    edge(c.borders.t, b.x, b.yb + b.h, b.x + b.w, b.yb + b.h);
    edge(c.borders.b, b.x, b.yb, b.x + b.w, b.yb);
    edge(c.borders.l, b.x, b.yb, b.x, b.yb + b.h);
    edge(c.borders.r, b.x + b.w, b.yb, b.x + b.w, b.yb + b.h);
  }));
  return o;
}

export type { PDFPage };
