// Realistic test files, written the way Excel and typical PDF generators write them.
// Run: node test/make-real-fixtures.mjs  → test/fixtures/{sales-report,invoice}.xlsx, {bank-statement,invoice}.pdf
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ───────── tiny PNG encoder (logo) ─────────
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b, a] = pixel(x, y); raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4); } }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
// a "logo": blue rounded badge with a white ring and an orange bar
const LOGO = png(240, 80, (x, y) => {
  const inBadge = x < 80 && (x - 40) ** 2 + (y - 40) ** 2 < 38 ** 2;
  const ring = inBadge && Math.abs(Math.hypot(x - 40, y - 40) - 22) < 5;
  if (ring) return [255, 255, 255, 255];
  if (inBadge) return [31, 78, 121, 255];
  if (x > 95 && x < 235 && y > 22 && y < 36) return [237, 125, 49, 255];
  if (x > 95 && x < 200 && y > 46 && y < 58) return [31, 78, 121, 255];
  return [0, 0, 0, 0];
});

// ───────── SpreadsheetML helpers ─────────
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" mc:Ignorable="x14ac"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

class Book {
  constructor() { this.sst = []; this.sstMap = new Map(); this.sheets = []; this.parts = new Map(); this.ctypes = []; this.charts = 0; this.drawings = 0; this.media = 0; this.names = []; }
  s(t) { if (!this.sstMap.has(t)) { this.sstMap.set(t, this.sst.length); this.sst.push(`<si><t xml:space="preserve">${esc(t)}</t></si>`); } return this.sstMap.get(t); }
  rich(runs) { const x = `<si>${runs.map(([t, pr]) => `<r>${pr ? `<rPr>${pr}</rPr>` : ''}<t xml:space="preserve">${esc(t)}</t></r>`).join('')}</si>`; this.sst.push(x); return this.sst.length - 1; }
  file(p, x, type) { this.parts.set(p, x); if (type) this.ctypes.push(`<Override PartName="/${p}" ContentType="${type}"/>`); }
  chart(xml) { const n = ++this.charts; this.file(`xl/charts/chart${n}.xml`, xml, 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'); return `../charts/chart${n}.xml`; }
  drawing(anchors, rels) {
    const n = ++this.drawings;
    this.file(`xl/drawings/drawing${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors.join('')}</xdr:wsDr>`, 'application/vnd.openxmlformats-officedocument.drawing+xml');
    this.file(`xl/drawings/_rels/drawing${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`);
    return `../drawings/drawing${n}.xml`;
  }
  image(bytes) { const n = ++this.media; this.parts.set(`xl/media/image${n}.png`, bytes); return `../media/image${n}.png`; }
  sheet(name, xml, rels = [], state, chartsheet = false) { this.sheets.push({ name, xml, rels, state, chartsheet }); }
  async save(path, styles) {
    const z = new JSZip();
    const ws = this.sheets.map((s, i) => {
      const p = s.chartsheet ? `xl/chartsheets/sheet${i + 1}.xml` : `xl/worksheets/sheet${i + 1}.xml`;
      z.file(p, s.xml);
      this.ctypes.push(`<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${s.chartsheet ? 'chartsheet' : 'worksheet'}+xml"/>`);
      if (s.rels.length) z.file(p.replace(/([^/]+)$/, '_rels/$1.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${s.rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`);
      return { ...s, p };
    });
    for (const [p, x] of this.parts) z.file(p, x);
    z.file('xl/theme/theme1.xml', THEME); this.ctypes.push('<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>');
    z.file('xl/styles.xml', styles); this.ctypes.push('<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>');
    z.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.sst.length}" uniqueCount="${this.sst.length}">${this.sst.join('')}</sst>`);
    this.ctypes.push('<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>');
    z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ${NS}><fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27328"/><workbookPr defaultThemeVersion="166925"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews><sheets>${ws.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`).join('')}</sheets>${this.names.length ? `<definedNames>${this.names.join('')}</definedNames>` : ''}<calcPr calcId="191029"/></workbook>`);
    this.ctypes.push('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>');
    z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ws.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/${s.chartsheet ? 'chartsheet' : 'worksheet'}" Target="${s.p.replace('xl/', '')}"/>`).join('')}<Relationship Id="rId${ws.length + 1}" Type="${REL}/theme" Target="theme/theme1.xml"/><Relationship Id="rId${ws.length + 2}" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId${ws.length + 3}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
    z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    z.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application><AppVersion>16.0300</AppVersion></Properties>');
    z.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Finance</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2024-04-02T09:00:00Z</dcterms:created></cp:coreProperties>');
    this.ctypes.push('<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>');
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${this.ctypes.join('')}</Types>`);
    writeFileSync(path, await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
  }
}

// chart XML (Excel 2016 flavour)
const C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const strCache = (vals) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
const numCache = (vals, fmt = 'General') => `<c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
const rich = (t, sz = 1400) => `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="0"/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx>`;
function series(i, s, { cache = true, fill, line, marker, labels } = {}) {
  const color = fill ? `<c:spPr><a:solidFill><a:schemeClr val="accent${(i % 6) + 1}"/></a:solidFill></c:spPr>` : line ? `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:schemeClr val="accent${(i % 6) + 1}"/></a:solidFill><a:round/></a:ln></c:spPr>` : '';
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${s.nameRef}</c:f>${strCache([s.name])}</c:strRef></c:tx>${color}${marker ?? ''}${labels ? '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>' : ''}<c:cat><c:strRef><c:f>${s.catRef}</c:f>${cache ? strCache(s.cats) : ''}</c:strRef></c:cat><c:val><c:numRef><c:f>${s.valRef}</c:f>${cache ? numCache(s.vals, s.fmt) : ''}</c:numRef></c:val><c:smooth val="0"/></c:ser>`;
}
const axes = (catTitle, valTitle, fmt = 'General') => `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${catTitle ? `<c:title>${rich(catTitle, 1000)}<c:overlay val="0"/></c:title>` : ''}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/>${valTitle ? `<c:title>${rich(valTitle, 1000)}<c:overlay val="0"/></c:title>` : ''}<c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
const chartDoc = (title, plot, legend = 'b') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ${C}><c:roundedCorners val="0"/><c:chart>${title ? `<c:title>${rich(title)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>'}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend ? `<c:legend><c:legendPos val="${legend}"/><c:overlay val="0"/></c:legend>` : ''}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:ln w="9525"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
const anchor = (c0, r0, c1, r1, body) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>${body}<xdr:clientData/></xdr:twoCellAnchor>`;
const chartFrame = (id, rid, name) => `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${name}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
const pic = (id, rid) => `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1143000" cy="381000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;

// ───────── styles shared by both workbooks ─────────
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet ${NS}><numFmts count="5"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="166" formatCode="dd\\-mmm\\-yyyy"/><numFmt numFmtId="167" formatCode="0.0%"/><numFmt numFmtId="168" formatCode="&quot;Rs&quot;\\ #,##0.00"/></numFmts>
<fonts count="9"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="18"/><color theme="0"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="11"/><color theme="0"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><sz val="9"/><color rgb="FF7F7F7F"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="20"/><color theme="4" tint="-0.249977111117893"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="14"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><i/><sz val="10"/><color theme="1" tint="0.34998626667073579"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="-0.499984740745262"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor theme="4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="0.79998168889431442"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor theme="0" tint="-4.9989318521683403E-2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="5"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color theme="0" tint="-0.249977111117893"/></left><right style="thin"><color theme="0" tint="-0.249977111117893"/></right><top style="thin"><color theme="0" tint="-0.249977111117893"/></top><bottom style="thin"><color theme="0" tint="-0.249977111117893"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom><diagonal/></border><border diagonalDown="1"><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal style="thin"><color auto="1"/></diagonal></border><border><left/><right/><top/><bottom style="medium"><color theme="4"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="24">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="164" fontId="3" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="6" fillId="0" borderId="4" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" textRotation="90"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="168" fontId="8" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="3" fontId="6" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="167" fontId="6" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" readingOrder="2"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="3"><dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf><dxf><font><b/><color rgb="FF006100"/></font><fill><patternFill><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf><dxf><fill><patternFill><bgColor theme="0" tint="-4.9989318521683403E-2"/></patternFill></fill></dxf></dxfs>
</styleSheet>`;
// style ids
const S = { title: 1, head: 2, money: 3, cell: 4, total: 5, pct: 6, date: 7, cents: 8, note: 9, big: 10, h2: 11, rot: 12, diag: 13, rs: 14, rsTotal: 15, ital: 16, boldR: 17, headLight: 18, kpi: 19, kpiPct: 20, kpiTxt: 21, wrapCell: 22, rtlCell: 23 };

const sheetXml = ({ cols, rows, merges = [], cf = '', extra = '', view = '', drawing, pageSetup = '<pageSetup paperSize="9" orientation="portrait"/>', margins = '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>', hf = '', breaks = '', pr = '', print = '' }) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${NS}>${pr}<dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"${view}/></sheetViews><sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows.join('')}</sheetData>${extra}${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}${cf}${print}${margins}${pageSetup}${hf}${breaks}${drawing ? `<drawing r:id="${drawing}"/>` : ''}</worksheet>`;
const cell = (ref, { s, v, t, f, si, ref: fref } = {}) => `<c r="${ref}"${s ? ` s="${s}"` : ''}${t ? ` t="${t}"` : ''}>${f !== undefined ? `<f${si !== undefined ? ` t="shared"${fref ? ` ref="${fref}"` : ''} si="${si}"` : ''}>${esc(f)}</f>` : si !== undefined ? `<f t="shared" si="${si}"/>` : ''}${v !== undefined ? `<v>${v}</v>` : ''}</c>`;
const row = (r, cells, ht) => `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.join('')}</row>`;

// ═════════ 1. sales-report.xlsx ═════════
{
  const b = new Book();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const regions = ['North', 'South', 'East', 'West'];
  const data = months.map((_, i) => regions.map((_, j) => Math.round(18000 + 9000 * Math.sin(i / 2 + j) + i * 900 + j * 1500)));
  const totals = data.map((r) => r.reduce((a, c) => a + c, 0));
  const regionTotals = regions.map((_, j) => data.reduce((a, r) => a + r[j], 0));

  // Data sheet: cached totals in F (shared formula), growth in G and labels in H WITHOUT cached values
  const dRows = [row(1, ['Month', ...regions, 'Total', 'Growth', 'Trend'].map((h, i) => cell(`${col(i)}1`, { s: S.head, t: 's', v: b.s(h) })), 30)];
  months.forEach((m, i) => {
    const r = i + 2;
    const cs = [cell(`A${r}`, { s: S.cell, t: 's', v: b.s(m) }), ...data[i].map((v, j) => cell(`${col(j + 1)}${r}`, { s: S.money, v }))];
    cs.push(i === 0 ? cell(`F${r}`, { s: S.money, f: 'SUM(B2:E2)', si: 0, ref: 'F2:F13', v: totals[i] }) : cell(`F${r}`, { s: S.money, si: 0, v: totals[i] }));
    if (i === 0) cs.push(cell(`G${r}`, { s: S.pct }));
    else cs.push(i === 1 ? cell(`G${r}`, { s: S.pct, f: '(F3-F2)/F2', si: 1, ref: 'G3:G13' }) : cell(`G${r}`, { s: S.pct, si: 1 }));
    cs.push(cell(`H${r}`, { s: S.cell, f: `IF(F${r}>AVERAGE($F$2:$F$13),"Above average","Below average")`, t: 'str' }));
    dRows.push(row(r, cs));
  });
  dRows.push(row(14, [cell('A14', { s: S.total, t: 's', v: b.s('Total') }), ...regions.map((_, j) => cell(`${col(j + 1)}14`, { s: S.total, f: `SUM(${col(j + 1)}2:${col(j + 1)}13)`, v: regionTotals[j] })), cell('F14', { s: S.total, f: 'SUM(F2:F13)', v: totals.reduce((a, c) => a + c, 0) })]));
  dRows.push(row(15, [cell('A15', { s: S.cell, t: 's', v: b.s('Average') }), ...regions.map((_, j) => cell(`${col(j + 1)}15`, { s: S.money, f: `AVERAGE(${col(j + 1)}2:${col(j + 1)}13)` })), cell('F15', { s: S.money, f: 'ROUND(AVERAGE(F2:F13),0)' })]));
  dRows.push(row(16, [cell('A16', { s: S.cell, t: 's', v: b.s('Best month') }), cell('B16', { s: S.cell, t: 'str', f: 'INDEX(A2:A13,MATCH(MAX(F2:F13),F2:F13,0))' })]));
  const cf = `<conditionalFormatting sqref="B2:E13"><cfRule type="colorScale" priority="3"><colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/><color rgb="FFF8696B"/><color rgb="FFFFEB84"/><color rgb="FF63BE7B"/></colorScale></cfRule></conditionalFormatting><conditionalFormatting sqref="F2:F13"><cfRule type="dataBar" priority="2"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting><conditionalFormatting sqref="G3:G13"><cfRule type="iconSet" priority="1"><iconSet iconSet="3Arrows"><cfvo type="percent" val="0"/><cfvo type="num" val="-0.02"/><cfvo type="num" val="0.02"/></iconSet></cfRule></conditionalFormatting><conditionalFormatting sqref="H2:H13"><cfRule type="containsText" dxfId="1" priority="4" operator="containsText" text="Above"><formula>NOT(ISERROR(SEARCH("Above",H2)))</formula></cfRule></conditionalFormatting>`;
  const chartPlot = (type, extra, ser, ax = true) => `<c:${type}>${extra}${ser}${ax ? '<c:axId val="1"/><c:axId val="2"/>' : ''}</c:${type}>${ax ? axes(undefined, undefined, '"$"#,##0') : ''}`;
  const ser = (j, o) => series(j, { name: regions[j], nameRef: `Data!$${col(j + 1)}$1`, cats: months, catRef: 'Data!$A$2:$A$13', vals: data.map((r) => r[j]), valRef: `Data!$${col(j + 1)}$2:$${col(j + 1)}$13`, fmt: '"$"#,##0' }, o);
  const col1 = b.chart(chartDoc('Monthly sales by region', chartPlot('barChart', '<c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>', regions.map((_, j) => ser(j, { fill: true })).join('') + '<c:gapWidth val="219"/><c:overlap val="-27"/>')));
  const pie1 = b.chart(chartDoc('Share by region', `<c:pieChart><c:varyColors val="1"/>${series(0, { name: 'Total', nameRef: 'Data!$A$14', cats: regions, catRef: 'Data!$B$1:$E$1', vals: regionTotals, valRef: 'Data!$B$14:$E$14' }).replace('<c:smooth val="0"/>', '').replace('<c:cat>', '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls><c:cat>')}<c:firstSliceAng val="0"/></c:pieChart>`, 'r'));
  const line1 = b.chart(chartDoc('Total sales', chartPlot('lineChart', '<c:grouping val="standard"/><c:varyColors val="0"/>', series(0, { name: 'Total', nameRef: 'Data!$F$1', cats: months, catRef: 'Data!$A$2:$A$13', vals: totals, valRef: 'Data!$F$2:$F$13', fmt: '"$"#,##0' }, { line: true, marker: '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>' }) + '<c:marker val="1"/>'), null));
  // stacked bar chart with NO cache (values must be read from the cells)
  const stack1 = b.chart(chartDoc('Quarterly mix (stacked)', chartPlot('barChart', '<c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>', regions.map((_, j) => ser(j, { fill: true, cache: false })).join('') + '<c:gapWidth val="60"/><c:overlap val="100"/>')));
  const logo = b.image(LOGO);
  const shapes = [
    anchor(0, 1, 2, 3, pic(2, 'rId1')),
    anchor(0, 6, 8, 22, chartFrame(3, 'rId2', 'Chart 1')),
    anchor(0, 23, 4, 38, chartFrame(4, 'rId3', 'Chart 2')),
    anchor(4, 23, 8, 38, chartFrame(5, 'rId4', 'Chart 3')),
    anchor(0, 39, 8, 56, chartFrame(6, 'rId5', 'Chart 4')),
    // text box with rich text
    `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>57</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>62</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="7" name="TextBox 1"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFF2CC"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="BF9000"/></a:solidFill></a:ln></xdr:spPr><xdr:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="t"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>Note from Finance: </a:t></a:r><a:r><a:rPr lang="en-US" sz="1100"/><a:t>December includes the holiday campaign. Figures are unaudited and may change after the year-end close.</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`,
    // rounded rectangle with theme style (filled accent1, white text) + an arrow
    `<xdr:twoCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:colOff>76200</xdr:colOff><xdr:row>57</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>60</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="8" name="Rounded Rectangle 1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></xdr:spPr><xdr:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></xdr:style><xdr:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>Target met ✓</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`,
    `<xdr:twoCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:colOff>76200</xdr:colOff><xdr:row>60</xdr:row><xdr:rowOff>95250</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>62</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="9" name="Right Arrow 1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent6"/></a:solidFill><a:ln><a:noFill/></a:ln></xdr:spPr></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`,
  ];
  const dash = b.drawing(shapes, [['rId1', 'image', logo], ['rId2', 'chart', col1], ['rId3', 'chart', pie1], ['rId4', 'chart', line1], ['rId5', 'chart', stack1]]);
  const dRowsDash = [
    row(1, [cell('A1', { s: S.title, t: 's', v: b.s('Quarterly Sales Report 2024') }), ...'BCDEFGH'.split('').map((c) => cell(`${c}1`, { s: S.title }))], 36),
    row(2, [cell('C2', { s: S.note, t: 's', v: b.s('Prepared by Finance · confidential') })]),
    row(4, ['Total sales', 'Average month', 'Best region', 'Months up'].map((t, i) => cell(`${col(i * 2)}4`, { s: S.headLight, t: 's', v: b.s(t) }))),
    row(5, [cell('A5', { s: S.kpi, f: 'Data!F14', v: totals.reduce((a, c) => a + c, 0) }), cell('C5', { s: S.kpi, f: 'Data!F15' }), cell('E5', { s: S.kpiTxt, t: 'str', f: 'INDEX(Data!B1:E1,MATCH(MAX(Data!B14:E14),Data!B14:E14,0))' }), cell('G5', { s: S.kpi, f: 'COUNTIF(Data!G3:G13,">0")' })], 24),
  ];
  b.sheet('Dashboard', sheetXml({ cols: '<col min="1" max="8" width="13.7109375" customWidth="1"/>', rows: dRowsDash, merges: ['A1:H1', 'A4:B4', 'C4:D4', 'E4:F4', 'G4:H4', 'A5:B5', 'C5:D5', 'E5:F5', 'G5:H5'], drawing: 'rId1', view: ' showGridLines="0" tabSelected="1"', pageSetup: '<pageSetup paperSize="9" orientation="portrait"/>', hf: '<headerFooter><oddFooter>&amp;L&amp;F&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter>', print: '<printOptions horizontalCentered="1"/>' }), [['rId1', 'drawing', dash]]);
  b.sheet('Data', sheetXml({ cols: '<col min="1" max="1" width="12.7109375" customWidth="1"/><col min="2" max="7" width="12.7109375" customWidth="1"/><col min="8" max="8" width="16.7109375" customWidth="1"/>', rows: dRows, cf, view: '', extra: '<autoFilter ref="A1:H13"/>', pageSetup: '<pageSetup paperSize="9" orientation="landscape"/>' }));

  // Transactions: 1500 rows, print titles, header/footer, manual break
  const names = ['Ali Traders', 'Bright Foods Ltd', 'City Pharmacy', 'Delta Logistics', 'Evergreen Textiles', 'Fatima & Sons', 'Global Imports', 'Hilltop Bakery'];
  const status = ['Paid', 'Paid', 'Pending', 'Paid', 'Overdue'];
  const tRows = [row(1, ['Date', 'Invoice', 'Customer', 'Region', 'Amount', 'Status'].map((h, i) => cell(`${col(i)}1`, { s: S.head, t: 's', v: b.s(h) })))];
  for (let i = 0; i < 1500; i++) {
    const r = i + 2;
    tRows.push(row(r, [cell(`A${r}`, { s: S.date, v: 45292 + Math.floor(i / 4.2) }), cell(`B${r}`, { s: S.cell, t: 's', v: b.s(`INV-${String(i + 1).padStart(5, '0')}`) }), cell(`C${r}`, { s: S.cell, t: 's', v: b.s(names[i % names.length]) }), cell(`D${r}`, { s: S.cell, t: 's', v: b.s(regions[(i * 7) % 4]) }), cell(`E${r}`, { s: S.cents, v: Math.round((150 + ((i * 7919) % 9850)) * 100 + (i % 100)) / 100 }), cell(`F${r}`, { s: S.cell, t: 's', v: b.s(status[i % status.length]) })]));
  }
  tRows.push(row(1502, [cell('D1502', { s: S.boldR, t: 's', v: b.s('Grand total') }), cell('E1502', { s: S.total, f: 'SUM(E2:E1501)' })]));
  b.names.push('<definedName name="_xlnm._FilterDatabase" localSheetId="2" hidden="1">Transactions!$A$1:$F$1501</definedName>', '<definedName name="_xlnm.Print_Titles" localSheetId="2">Transactions!$1:$1</definedName>');
  b.sheet('Transactions', sheetXml({
    cols: '<col min="1" max="1" width="13.7109375" customWidth="1"/><col min="2" max="2" width="12" customWidth="1"/><col min="3" max="3" width="22" customWidth="1"/><col min="4" max="4" width="10" customWidth="1"/><col min="5" max="5" width="13" customWidth="1"/><col min="6" max="6" width="10" customWidth="1"/>',
    rows: tRows, cf: '<conditionalFormatting sqref="F2:F1501"><cfRule type="containsText" dxfId="0" priority="1" operator="containsText" text="Overdue"><formula>NOT(ISERROR(SEARCH("Overdue",F2)))</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="A2:F1501"><cfRule type="expression" dxfId="2" priority="2"><formula>MOD(ROW(),2)=0</formula></cfRule></conditionalFormatting>',
    view: '', extra: '<autoFilter ref="A1:F1501"/>', pageSetup: '<pageSetup paperSize="9" orientation="portrait"/>',
    hf: '<headerFooter><oddHeader>&amp;L&amp;"Calibri,Bold"Transactions 2024&amp;R&amp;D</oddHeader><oddFooter>&amp;CPage &amp;P of &amp;N</oddFooter></headerFooter>',
    breaks: '<rowBreaks count="1" manualBreakCount="1"><brk id="101" max="16383" man="1"/></rowBreaks>',
  }));

  // chart sheet
  const trend = b.chart(chartDoc('Sales trend 2024', chartPlot('areaChart', '<c:grouping val="stacked"/><c:varyColors val="0"/>', regions.map((_, j) => ser(j, { fill: true })).join(''))));
  const tDraw = b.drawing([`<xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="9293679" cy="6066692"/>${chartFrame(2, 'rId1', 'Chart 1')}<xdr:clientData/></xdr:absoluteAnchor>`], [['rId1', 'chart', trend]]);
  b.sheet('Trend', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<chartsheet ${NS}><sheetPr/><sheetViews><sheetView zoomScale="98" workbookViewId="0" zoomToFit="1"/></sheetViews><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape"/><drawing r:id="rId1"/></chartsheet>`, [['rId1', 'drawing', tDraw]], undefined, true);

  // Urdu, right-to-left
  const ur = [['نام', 'شہر', 'رقم (روپے)', 'حیثیت'], ['احمد علی', 'لاہور', 125000, 'ادا شدہ'], ['فاطمہ خان', 'کراچی', 98500.5, 'زیر التواء'], ['محمد عمر', 'اسلام آباد', 230750, 'ادا شدہ'], ['عائشہ بی بی', 'ملتان', 45200, 'باقی']];
  const uRows = ur.map((r, i) => row(i + 1, r.map((v, j) => (typeof v === 'number' ? cell(`${col(j)}${i + 1}`, { s: S.rs, v }) : cell(`${col(j)}${i + 1}`, { s: i === 0 ? S.head : S.rtlCell, t: 's', v: b.s(v) })))));
  uRows.push(row(6, [cell('B6', { s: S.boldR, t: 's', v: b.s('کل') }), cell('C6', { s: S.rsTotal, f: 'SUM(C2:C5)' })]));
  b.sheet('رپورٹ', sheetXml({ cols: '<col min="1" max="4" width="18" customWidth="1"/>', rows: uRows, view: ' rightToLeft="1"' }));
  b.sheet('Lookup', sheetXml({ rows: [row(1, [cell('A1', { t: 's', v: b.s('internal') })])] }), [], 'hidden');
  await b.save('test/fixtures/sales-report.xlsx', STYLES);
}

// ═════════ 2. invoice.xlsx ═════════
{
  const b = new Book();
  const items = [['Website design (5 pages, responsive, includes two rounds of revisions)', 1, 85000], ['Logo and brand guide', 1, 35000], ['Hosting, 12 months', 12, 1500], ['Content writing per page', 5, 4000], ['SEO setup', 1, 15000]];
  const rows = [
    row(1, [cell('C1', { s: S.big, t: 's', v: b.s('INVOICE') })], 30),
    row(2, [cell('C2', { s: S.note, t: 's', v: b.s('Pixel Works (Pvt) Ltd · 12 Mall Road, Lahore · hello@pixelworks.pk') })]),
    row(4, [cell('A4', { s: S.h2, t: 's', v: b.s('Bill to') }), cell('B4', { s: S.h2 }), cell('D4', { s: S.h2, t: 's', v: b.s('Invoice no.') }), cell('E4', { s: S.h2, t: 's', v: b.s('PW-2024-0193') })]),
    row(5, [cell('A5', { t: 's', v: b.s('Bright Foods Ltd') }), cell('D5', { t: 's', v: b.s('Date') }), cell('E5', { s: S.date, v: 45387 })]),
    row(6, [cell('A6', { t: 's', v: b.s('45-B Gulberg III, Lahore') }), cell('D6', { t: 's', v: b.s('Due') }), cell('E6', { s: S.date, f: 'E5+30' })]),
    row(8, [cell('A8', { s: S.rot, t: 's', v: b.s('#') }), ...['Description', 'Qty', 'Rate', 'Amount'].map((h, i) => cell(`${col(i + 1)}8`, { s: S.head, t: 's', v: b.s(h) }))], 30),
  ];
  items.forEach((it, i) => { const r = 9 + i; rows.push(row(r, [cell(`A${r}`, { s: S.cell, v: i + 1 }), cell(`B${r}`, { s: S.wrapCell, t: 's', v: b.s(it[0]) }), cell(`C${r}`, { s: S.cell, v: it[1] }), cell(`D${r}`, { s: S.rs, v: it[2] }), cell(`E${r}`, { s: S.rs, f: `C${r}*D${r}` })])); });
  rows.push(row(14, [cell('A14', { s: S.diag }), cell('B14', { s: S.cell }), cell('C14', { s: S.cell }), cell('D14', { s: S.boldR, t: 's', v: b.s('Subtotal') }), cell('E14', { s: S.rs, f: 'SUM(E9:E13)' })]));
  rows.push(row(15, [cell('D15', { s: S.boldR, t: 's', v: b.s('Sales tax 16%') }), cell('E15', { s: S.rs, f: 'ROUND(E14*16%,2)' })]));
  rows.push(row(16, [cell('D16', { s: S.boldR, t: 's', v: b.s('Total due') }), cell('E16', { s: S.rsTotal, f: 'E14+E15' })]));
  rows.push(row(17, [cell('D17', { s: S.ital, t: 'str', f: '"("&TEXT(E16,"#,##0")&" rupees)"' })]));
  const thanks = b.rich([['Thank you for your business! ', '<b/><sz val="12"/><color rgb="FF1F4E79"/><rFont val="Calibri"/>'], ['Please pay by bank transfer to Meezan Bank, account 0123-4567890. ', '<sz val="11"/><rFont val="Calibri"/>'], ['Late payments incur a 2% monthly charge.', '<i/><sz val="11"/><color rgb="FFC00000"/><rFont val="Calibri"/>']]);
  rows.push(row(19, [cell('A19', { s: S.ital, t: 's', v: thanks })], 48));
  const logo = b.image(LOGO);
  const dr = b.drawing([`<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1371600" cy="457200"/>${pic(2, 'rId1')}<xdr:clientData/></xdr:oneCellAnchor>`], [['rId1', 'image', logo]]);
  b.names.push('<definedName name="_xlnm.Print_Area" localSheetId="0">Invoice!$A$1:$E$19</definedName>', '<definedName name="TaxRate">0.16</definedName>');
  b.sheet('Invoice', sheetXml({ pr: '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>', cols: '<col min="1" max="1" width="5.7109375" customWidth="1"/><col min="2" max="2" width="42.7109375" customWidth="1"/><col min="3" max="3" width="7.7109375" customWidth="1"/><col min="4" max="5" width="16.7109375" customWidth="1"/>', rows, merges: ['A19:E19'], drawing: 'rId1', view: ' showGridLines="0"', pageSetup: '<pageSetup paperSize="9" fitToHeight="1" orientation="portrait"/>', print: '<printOptions horizontalCentered="1"/>' }), [['rId1', 'drawing', dr]]);
  await b.save('test/fixtures/invoice.xlsx', STYLES);
}

// ═════════ 3. bank-statement.pdf (3 pages) ═════════
{
  const d = await PDFDocument.create();
  const reg = await d.embedFont(StandardFonts.Helvetica), bold = await d.embedFont(StandardFonts.HelveticaBold);
  const logo = await d.embedPng(LOGO);
  const tx = [];
  let bal = 250000;
  const descs = ['ATM withdrawal Gulberg branch', 'POS purchase Al-Fatah Store', 'Salary credit Pixel Works (Pvt) Ltd for the month of March 2024', 'Electricity bill LESCO ref 0412233', 'IBFT to Ahmed Ali, Meezan Bank, account ending 7781 (rent)', 'Mobile top-up Jazz', 'Online purchase Daraz.pk order 556677', 'Fuel PSO Main Boulevard', 'Cheque deposit 004512', 'Bank charges'];
  for (let i = 0; i < 70; i++) {
    const credit = i % 9 === 2 || i % 13 === 8;
    const amt = credit ? 85000 + (i % 5) * 1500 : 500 + ((i * 3779) % 24000) + (i % 4) * 0.25;
    bal += credit ? amt : -amt;
    tx.push([`${String(1 + Math.floor(i / 2.4)).padStart(2, '0')}/03/2024`, descs[i % descs.length], credit ? '' : amt.toLocaleString('en-US', { minimumFractionDigits: 2 }), credit ? amt.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '', bal.toLocaleString('en-US', { minimumFractionDigits: 2 })]);
  }
  const cols = [40, 105, 330, 410, 490, 555]; // column lefts + right edge
  const pages = [];
  let i = 0;
  while (i < tx.length) {
    const p = d.addPage([595, 842]);
    pages.push(p);
    let y = 800;
    if (pages.length === 1) {
      p.drawImage(logo, { x: 40, y: 770, width: 108, height: 36 });
      p.drawText('Meezan Digital Bank', { x: 160, y: 790, size: 16, font: bold, color: rgb(0.12, 0.31, 0.47) });
      p.drawText('Statement of Account · March 2024', { x: 160, y: 774, size: 10, font: reg, color: rgb(0.4, 0.4, 0.4) });
      y = 740;
      for (const [k, v] of [['Account title', 'Muhammad A. Khan'], ['Account number', '0123-4567890'], ['Currency', 'PKR']]) { p.drawText(k, { x: 40, y, size: 9, font: bold }); p.drawText(v, { x: 140, y, size: 9, font: reg }); y -= 13; }
      y -= 12;
    }
    // header row: dark fill, white bold text
    p.drawRectangle({ x: 40, y: y - 5, width: 515, height: 18, color: rgb(0.12, 0.31, 0.47) });
    ['Date', 'Description'].forEach((t, k) => p.drawText(t, { x: cols[k] + 3, y, size: 9, font: bold, color: rgb(1, 1, 1) }));
    ['Debit', 'Credit', 'Balance'].forEach((t, k) => { const xr = cols[k + 3] - 4; p.drawText(t, { x: xr - bold.widthOfTextAtSize(t, 9), y, size: 9, font: bold, color: rgb(1, 1, 1) }); });
    y -= 18;
    let n = 0;
    while (i < tx.length && y > 80) {
      const r = tx[i];
      // descriptions wider than the column wrap onto a second line
      const words = r[1].split(' '); const lines = [''];
      for (const w of words) { const t = (lines[lines.length - 1] + ' ' + w).trim(); if (reg.widthOfTextAtSize(t, 9) > 215 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = t; }
      const h = 11 * lines.length + 5;
      if (n % 2 === 1) p.drawRectangle({ x: 40, y: y - h + 9, width: 515, height: h, color: rgb(0.94, 0.96, 0.98) });
      p.drawText(r[0], { x: cols[0] + 3, y, size: 9, font: reg });
      lines.forEach((l, k) => p.drawText(l, { x: cols[1] + 3, y: y - k * 11, size: 9, font: reg }));
      [r[2], r[3], r[4]].forEach((t, k) => { if (!t) return; const xr = cols[k + 3] - 4; p.drawText(t, { x: xr - reg.widthOfTextAtSize(t, 9), y, size: 9, font: reg, color: k === 0 ? rgb(0.75, 0, 0) : rgb(0, 0, 0) }); });
      p.drawLine({ start: { x: 40, y: y - h + 9 }, end: { x: 555, y: y - h + 9 }, thickness: 0.4, color: rgb(0.75, 0.78, 0.82) });
      y -= h; i++; n++;
    }
    if (i >= tx.length) {
      y -= 4;
      p.drawLine({ start: { x: 330, y: y + 11 }, end: { x: 555, y: y + 11 }, thickness: 1, color: rgb(0, 0, 0) });
      p.drawText('Closing balance', { x: cols[1] + 3, y, size: 9, font: bold });
      const t = tx[tx.length - 1][4]; p.drawText(t, { x: 551 - bold.widthOfTextAtSize(t, 9), y, size: 9, font: bold });
    }
  }
  pages.forEach((p, k) => p.drawText(`Page ${k + 1} of ${pages.length}`, { x: 270, y: 40, size: 8, font: reg, color: rgb(0.5, 0.5, 0.5) }));
  writeFileSync('test/fixtures/bank-statement.pdf', await d.save());
}

// ═════════ 4. invoice.pdf (grid table, two-column header) ═════════
{
  const d = await PDFDocument.create();
  const reg = await d.embedFont(StandardFonts.Helvetica), bold = await d.embedFont(StandardFonts.HelveticaBold);
  const p = d.addPage([612, 792]);
  p.drawImage(await d.embedPng(LOGO), { x: 50, y: 712, width: 120, height: 40 });
  p.drawText('INVOICE', { x: 430, y: 728, size: 24, font: bold, color: rgb(0.18, 0.33, 0.59) });
  let y = 680;
  p.drawText('From', { x: 50, y, size: 10, font: bold }); p.drawText('Bill to', { x: 320, y, size: 10, font: bold });
  const from = ['Pixel Works (Pvt) Ltd', '12 Mall Road', 'Lahore 54000'], to = ['Bright Foods Ltd', '45-B Gulberg III', 'Lahore'];
  for (let k = 0; k < 3; k++) { y -= 13; p.drawText(from[k], { x: 50, y, size: 10, font: reg }); p.drawText(to[k], { x: 320, y, size: 10, font: reg }); }
  y -= 30;
  const head = ['Item', 'Description', 'Qty', 'Unit price', 'Amount'];
  const xs = [50, 100, 330, 380, 470, 562];
  const rows = [['1', 'Website design', '1', '85,000.00', '85,000.00'], ['2', 'Logo and brand guide', '1', '35,000.00', '35,000.00'], ['3', 'Hosting (months)', '12', '1,500.00', '18,000.00'], ['4', 'Content writing', '5', '4,000.00', '20,000.00']];
  const drawRow = (cells, f, fillC) => {
    if (fillC) p.drawRectangle({ x: xs[0], y: y - 6, width: xs[5] - xs[0], height: 20, color: fillC });
    cells.forEach((t, k) => {
      p.drawRectangle({ x: xs[k], y: y - 6, width: xs[k + 1] - xs[k], height: 20, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.6 });
      const w = f.widthOfTextAtSize(t, 10);
      const x = k >= 2 ? xs[k + 1] - 5 - w : k === 0 ? xs[k] + (xs[k + 1] - xs[k] - w) / 2 : xs[k] + 5;
      p.drawText(t, { x, y, size: 10, font: f });
    });
    y -= 20;
  };
  drawRow(head, bold, rgb(0.85, 0.89, 0.95));
  for (const r of rows) drawRow(r, reg);
  y -= 10;
  for (const [k, v, f] of [['Subtotal', '158,000.00', reg], ['Tax (16%)', '25,280.00', reg], ['Total', 'Rs 183,280.00', bold]]) { p.drawText(k, { x: 400, y, size: 10, font: f }); p.drawText(v, { x: 557 - f.widthOfTextAtSize(v, 10), y, size: 10, font: f }); y -= 15; }
  y -= 20;
  p.drawText('Payment terms: 30 days. Please quote the invoice number with your payment.', { x: 50, y, size: 9, font: reg, color: rgb(0.35, 0.35, 0.35) });
  writeFileSync('test/fixtures/invoice.pdf', await d.save());
}
console.log('fixtures written');
