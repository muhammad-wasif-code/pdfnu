/** Build a valid .xlsx workbook (SpreadsheetML) from rows of cells, with styles, row heights and pictures. jszip is lazy-loaded. */
import { xmlEscape } from './docxWrite';
import { colName } from './xlsxRead';
import { formatNumber } from './numFmt';

export interface WCell {
  v: string | number;
  /** Excel number format for numbers, e.g. '#,##0.00' */ fmt?: string;
  b?: boolean; i?: boolean; sz?: number; /** RRGGBB */ color?: string; fill?: string;
  border?: { t?: string; b?: string; l?: string; r?: string }; align?: 'left' | 'right' | 'center';
}
/** A PNG or JPEG placed at a cell, offsets and size in pt. */
export interface WImage { bytes: Uint8Array; row: number; col: number; dx: number; dy: number; w: number; h: number; }
export interface WSheet {
  name: string; rows: (WCell | null | undefined)[][];
  /** widths in characters */ widths?: number[]; /** row heights in pt */ heights?: (number | undefined)[];
  images?: WImage[]; rtl?: boolean;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Sheet names: no []:*?/\, at most 31 characters, unique (case-insensitive). */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n, i) => {
    const base = n.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base, k = 2;
    while (used.has(name.toLowerCase())) { const suf = ` (${k++})`; name = base.slice(0, 31 - suf.length) + suf; }
    used.add(name.toLowerCase());
    return name;
  });
}

const textWidth = (s: string) => [...s].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);

export function autoWidths(rows: (WCell | null | undefined)[][]): number[] {
  const w: number[] = [];
  for (const r of rows) r.forEach((c, i) => {
    if (!c || c.v === '') return;
    const s = typeof c.v === 'number' ? formatNumber(c.v, c.fmt ?? 'General').text : c.v;
    let longest = Math.max(...s.split('\n').map(textWidth)) * (c.b ? 1.1 : 1) * ((c.sz ?? 11) / 11);
    // text with an empty cell on its right spills over in Excel, so it needn't widen its column
    const next = r[i + 1];
    if (typeof c.v === 'string' && (!next || next.v === '')) longest = Math.min(longest, 12);
    w[i] = Math.max(w[i] ?? 0, longest);
  });
  return Array.from({ length: w.length }, (_, i) => Math.min(60, Math.max(8.43, (w[i] ?? 0) + 2)));
}

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;
const EMU = 12700;

export async function writeXlsx(sheets: WSheet[], opts: { title?: string } = {}): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const names = sheetNames(sheets.map((s) => s.name));

  // shared strings
  const sst: string[] = [];
  const sstIdx = new Map<string, number>();
  let sstCount = 0;
  const str = (s: string) => { sstCount++; let i = sstIdx.get(s); if (i === undefined) { i = sst.length; sst.push(s); sstIdx.set(s, i); } return i; };

  // style registries
  const reg = <T,>(first: string) => { const list = [first]; const idx = new Map<string, number>([[first, 0]]); return { list, get: (xml: string) => { let i = idx.get(xml); if (i === undefined) { i = list.length; list.push(xml); idx.set(xml, i); } return i; } }; };
  const fonts = reg('<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>');
  const fills = reg('<fill><patternFill patternType="none"/></fill>');
  fills.get('<fill><patternFill patternType="gray125"/></fill>');
  const borders = reg('<border><left/><right/><top/><bottom/><diagonal/></border>');
  const xfs = reg('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
  const fmtIds = new Map<string, number>();
  const BUILTIN: Record<string, number> = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 };
  const rgb = (h: string) => `FF${h.toUpperCase()}`;
  const styleFor = (c: WCell) => {
    let fmt = 0;
    if (typeof c.v === 'number' && c.fmt) {
      fmt = BUILTIN[c.fmt] ?? fmtIds.get(c.fmt) ?? 0;
      if (!fmt && c.fmt !== 'General') { fmt = 164 + fmtIds.size; fmtIds.set(c.fmt, fmt); }
    }
    const font = c.b || c.i || c.sz || c.color
      ? fonts.get(`<font>${c.b ? '<b/>' : ''}${c.i ? '<i/>' : ''}<sz val="${c.sz ?? 11}"/>${c.color ? `<color rgb="${rgb(c.color)}"/>` : '<color theme="1"/>'}<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>`) : 0;
    const fill = c.fill ? fills.get(`<fill><patternFill patternType="solid"><fgColor rgb="${rgb(c.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const e = (n: string, col?: string) => (col ? `<${n} style="thin"><color rgb="${rgb(col)}"/></${n}>` : `<${n}/>`);
    const border = c.border && (c.border.l || c.border.r || c.border.t || c.border.b) ? borders.get(`<border>${e('left', c.border.l)}${e('right', c.border.r)}${e('top', c.border.t)}${e('bottom', c.border.b)}<diagonal/></border>`) : 0;
    const wrap = typeof c.v === 'string' && c.v.includes('\n');
    const align = c.align || wrap ? `<alignment${c.align ? ` horizontal="${c.align}"` : ''}${wrap ? ' wrapText="1"' : ''}/>` : '';
    if (!fmt && !font && !fill && !border && !align) return 0;
    return xfs.get(`<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${fmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${align ? ` applyAlignment="1">${align}</xf>` : '/>'}`);
  };

  const ctypes: string[] = [];
  let mediaN = 0, drawingN = 0;
  sheets.forEach((sh, si) => {
    const rowsXml: string[] = [];
    const nRows = Math.max(sh.rows.length, sh.heights?.length ?? 0);
    for (let ri = 0; ri < nRows; ri++) {
      const row = sh.rows[ri] ?? [];
      const cells: string[] = [];
      row.forEach((c, ci) => {
        if (!c || (typeof c.v === 'number' && !isFinite(c.v))) return;
        const s = styleFor(c);
        if (c.v === '' && !s) return;
        const r = `${colName(ci)}${ri + 1}`;
        const sa = s ? ` s="${s}"` : '';
        if (c.v === '') cells.push(`<c r="${r}"${sa}/>`);
        else if (typeof c.v === 'number') cells.push(`<c r="${r}"${sa}><v>${c.v}</v></c>`);
        else cells.push(`<c r="${r}"${sa} t="s"><v>${str(c.v)}</v></c>`);
      });
      const h = sh.heights?.[ri];
      const ht = h ? ` ht="${Math.round(h * 4) / 4}" customHeight="1"` : '';
      if (cells.length || ht) rowsXml.push(`<row r="${ri + 1}"${ht}>${cells.join('')}</row>`);
    }
    const widths = sh.widths ?? autoWidths(sh.rows);
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.round(w * 100) / 100}" customWidth="1"/>`).join('')}</cols>` : '';
    const view = `<sheetViews><sheetView workbookViewId="0"${sh.rtl ? ' rightToLeft="1"' : ''}${si === 0 ? ' tabSelected="1"' : ''}/></sheetViews>`;
    let drawing = '';
    if (sh.images?.length) {
      drawingN++;
      const anchors: string[] = [], rels: string[] = [];
      sh.images.forEach((im, k) => {
        mediaN++;
        const ext = isJpeg(im.bytes) ? 'jpeg' : 'png';
        zip.file(`xl/media/image${mediaN}.${ext}`, im.bytes);
        rels.push(`<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${mediaN}.${ext}"/>`);
        anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>${Math.round(im.dx * EMU)}</xdr:colOff><xdr:row>${im.row}</xdr:row><xdr:rowOff>${Math.round(im.dy * EMU)}</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(im.w * EMU)}" cy="${Math.round(im.h * EMU)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="Picture ${k + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${k + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(im.w * EMU)}" cy="${Math.round(im.h * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
      });
      zip.file(`xl/drawings/drawing${drawingN}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join('')}</xdr:wsDr>`);
      zip.file(`xl/drawings/_rels/drawing${drawingN}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
      zip.file(`xl/worksheets/_rels/sheet${si + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingN}.xml"/></Relationships>`);
      ctypes.push(`<Override PartName="/xl/drawings/drawing${drawingN}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      drawing = '<drawing r:id="rId1"/>';
    }
    zip.file(`xl/worksheets/sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml.join('')}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${drawing}</worksheet>`);
  });

  const numFmts = fmtIds.size ? `<numFmts count="${fmtIds.size}">${[...fmtIds].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlEscape(code)}"/>`).join('')}</numFmts>` : '';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts}<fonts count="${fonts.list.length}">${fonts.list.join('')}</fonts><fills count="${fills.list.length}">${fills.list.join('')}</fills><borders count="${borders.list.length}">${borders.list.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.list.length}">${xfs.list.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const sheetList = names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const parts: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${ctypes.join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheetList}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sstCount}" uniqueCount="${sst.length}">${sst.map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`).join('')}</sst>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(opts.title ?? '')}</dc:title><dc:creator>PDFSherpa</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`],
  ];
  for (const [name, xml] of parts) zip.file(name, xml, { createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: XLSX_MIME });
}
