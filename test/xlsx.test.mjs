// Excel ⇄ PDF: number formats, workbook reading, Excel → PDF layout, PDF → Excel tables.
// Run after `node scripts/copy-vendor.mjs` (fonts): node test/xlsx.test.mjs
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
await build({
  entryPoints: ['src/lib/numFmt.ts', 'src/lib/xlsxRead.ts', 'src/lib/xlsxWrite.ts', 'src/lib/xlsxToPdf.ts', 'src/lib/pdfToTable.ts', 'src/lib/pdfGraphics.ts', 'src/lib/xml.ts', 'src/lib/formula.ts'],
  bundle: true, format: 'esm', platform: 'node', outdir: 'test/out/xlsx', outExtension: { '.js': '.mjs' },
  external: ['jszip', 'pdf-lib', '@pdf-lib/fontkit', 'regenerator-runtime'], logLevel: 'error',
});
const nf = await import('../test/out/xlsx/numFmt.mjs');
const rd = await import('../test/out/xlsx/xlsxRead.mjs');
const wr = await import('../test/out/xlsx/xlsxWrite.mjs');
const x2p = await import('../test/out/xlsx/xlsxToPdf.mjs');
const tb = await import('../test/out/xlsx/pdfToTable.mjs');
const { parseXml } = await import('../test/out/xlsx/xml.mjs');
const fx = await import('../test/out/xlsx/formula.mjs');
const gx = await import('../test/out/xlsx/pdfGraphics.mjs');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const fetchFont = async (url) => { const f = 'public' + url; return existsSync(f) ? new Uint8Array(readFileSync(f)) : null; };
let n = 0; const ok = (m) => console.log(`✓ ${++n} ${m}`);

// ── xml
const x = parseXml('<?xml version="1.0"?><a:root xmlns:a="x"><b r:id="r1" v=\'1 &amp; 2\'/><!-- c --><t>x &lt; y &#x41;<![CDATA[<z>]]></t></a:root>');
assert.equal(x.n, 'root'); assert.equal(x.c[0].a.id, 'r1'); assert.equal(x.c[0].a.v, '1 & 2'); assert.equal(x.c[1].t, 'x < y A<z>');
ok('xml parser: prefixes, entities, comments, CDATA');

// ── number formats
const f = (v, fmt) => nf.formatNumber(v, fmt).text;
assert.equal(f(1234.5, 'General'), '1234.5');
assert.equal(f(0.1 + 0.2, 'General'), '0.3');
assert.equal(f(123456789012, 'General'), '1.23457E+11');
assert.equal(f(1234.5, '#,##0.00'), '1,234.50');
assert.equal(f(-1234.5, '#,##0.00;(#,##0.00)'), '(1,234.50)');
assert.equal(f(-5, '#,##0;[Red]-#,##0'), '-5');
assert.equal(nf.formatNumber(-5, '#,##0;[Red]-#,##0').color, 'FF0000');
assert.equal(f(0.256, '0.0%'), '25.6%');
assert.equal(f(1500, '"$"#,##0.00'), '$1,500.00');
assert.equal(f(1500, '[$€-407] #,##0'), '€ 1,500');
assert.equal(f(7, '000'), '007');
assert.equal(f(12345, '0.00E+00'), '1.23E+04');
assert.equal(f(1500000, '#,##0,,"M"'), '2M');
assert.equal(f(0, '#,##0;-#,##0;"-"'), '-');
assert.equal(f(45292, 'm/d/yyyy'), '1/1/2024');
assert.equal(f(45292, 'dd-mmm-yyyy'), '01-Jan-2024');
assert.equal(f(45292, 'dddd, mmmm d'), 'Monday, January 1');
assert.equal(f(45292.75, 'h:mm AM/PM'), '6:00 PM');
assert.equal(f(45292.5, 'yyyy-mm-dd hh:mm:ss'), '2024-01-01 12:00:00');
assert.equal(f(1.5, '[h]:mm'), '36:00');
assert.equal(f(45292, 'd.m.yyyy'), '1.1.2024');
assert.equal(nf.formatText('abc', '"Name: "@'), 'Name: abc');
ok('number formats: decimals, thousands, %, currency, scaling, dates, times');

// ── a styled workbook made by hand
const W = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const zip = new JSZip();
zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>');
zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
zip.file('xl/workbook.xml', `<workbook ${W}><workbookPr/><sheets><sheet name="Invoice" sheetId="1" r:id="rId1"/><sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/><sheet name="اردو" sheetId="3" r:id="rId3"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Invoice!$A$1:$D$40</definedName></definedNames></workbook>`);
zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
zip.file('xl/styles.xml', `<styleSheet ${W}><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="10"/><color theme="4"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="-0.25"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color auto="1"/></left><right style="thin"/><top style="medium"/><bottom style="double"><color rgb="FFFF0000"/></bottom></border></borders><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1"/><xf numFmtId="14" fontId="2" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`);
zip.file('xl/sharedStrings.xml', `<sst ${W}><si><t>Invoice &amp; Receipt</t></si><si><r><t>Item</t></r><r><rPr><b/></rPr><t> name</t></r><rPh><t>ignored</t></rPh></si><si><t>A long description that wraps onto several lines inside its cell</t></si><si><t>This text overflows into the empty cells on its right</t></si><si><t>یہ اردو متن ہے</t></si></sst>`);
zip.file('xl/worksheets/sheet1.xml', `<worksheet ${W}><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="12"/><col min="3" max="3" hidden="1" width="9"/></cols><sheetData>
<row r="1" ht="24" customHeight="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1"/><c r="D1" s="1"/></row>
<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="2"><v>1234.5</v></c><c r="C2"><v>999</v></c><c r="D2" s="3"><v>45292</v></c></row>
<row r="3"><c r="A3" s="4" t="s"><v>2</v></c><c r="B3" t="b"><v>1</v></c><c r="D3" t="e"><v>#DIV/0!</v></c></row>
<row r="4"><c r="A4" t="s"><v>3</v></c></row>
<row r="5"><c r="A5"><f>SUM(B2)</f></c><c r="B5" t="str"><f>"x"</f><v>calc</v></c><c r="D5" t="inlineStr"><is><t>inline_x000D_</t></is></c></row>
</sheetData><mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells><pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="1" orientation="portrait"/><headerFooter><oddFooter>&amp;LPDFSherpa&amp;CPage &amp;P of &amp;N&amp;R&amp;A</oddFooter></headerFooter></worksheet>`);
zip.file('xl/worksheets/sheet2.xml', `<worksheet ${W}><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`);
let big = '';
for (let r = 2; r <= 121; r++) big += `<row r="${r}">${Array.from({ length: 14 }, (_, c) => `<c r="${rd.colName(c)}${r}"><v>${r * 100 + c}</v></c>`).join('')}</row>`;
zip.file('xl/worksheets/sheet3.xml', `<worksheet ${W}><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetData><row r="1"><c r="A1" t="s"><v>4</v></c></row>${big}</sheetData></worksheet>`);
const book = await zip.generateAsync({ type: 'uint8array' });
mkdirSync('test/out', { recursive: true });
writeFileSync('test/out/book.xlsx', book);

const wb = await rd.readXlsx(book);
assert.equal(wb.sheets.length, 3);
const [inv, secret, urdu] = wb.sheets;
assert.equal(inv.name, 'Invoice'); assert.ok(secret.hidden); assert.ok(urdu.rtl);
const cell = (s, ref) => { const p = /^([A-Z]+)(\d+)$/.exec(ref); return s.cells.get(+p[2] - 1)?.get(rd.colIndex(p[1])); };
assert.equal(cell(inv, 'A1').text, 'Invoice & Receipt');
assert.equal(cell(inv, 'A1').style.font.color, 'FFFFFF');
assert.equal(cell(inv, 'A1').style.fill, '2F5597', 'theme accent1 darkened 25%');
assert.equal(cell(inv, 'A2').text, 'Item name', 'rich text runs joined, phonetic skipped');
assert.equal(cell(inv, 'B2').text, '$1,234.50');
assert.equal(cell(inv, 'D2').text, '1/1/2024');
assert.equal(cell(inv, 'D2').style.font.color, '4472C4');
assert.equal(cell(inv, 'B3').text, 'TRUE'); assert.equal(cell(inv, 'D3').text, '#DIV/0!');
assert.equal(cell(inv, 'B5').text, 'calc'); assert.equal(cell(inv, 'D5').text, 'inline\r');
assert.equal(wb.formulasWithoutValue, 0); assert.equal(cell(inv, 'A5').text, '1234.5', 'formula without a saved result is calculated');
assert.equal(cell(inv, 'B1').text, '', 'styled empty cell kept for its fill/border');
assert.deepEqual(inv.merges[0], { r0: 0, c0: 0, r1: 0, c1: 3 });
assert.ok(inv.hiddenCols.has(2)); assert.equal(inv.colW[0], 105); assert.equal(inv.paper, 1);
assert.deepEqual(inv.printArea, { r0: 0, c0: 0, r1: 39, c1: 3 });
assert.match(inv.footer, /Page &P of &N/);
assert.equal(cell(inv, 'A2').style.border.l, undefined);
assert.equal(cell(inv, 'B2').style.border.b.color, 'FF0000');
ok('reads an .xlsx: shared/rich/inline strings, styles, theme colours, merges, hidden parts, print setup');

await assert.rejects(rd.readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])), /OLE_FILE/);
await assert.rejects(rd.readXlsx(new TextEncoder().encode('hello')), /NOT_XLSX/);
ok('old .xls / encrypted and non-Excel files are rejected clearly');

// ── Excel → PDF
const res = await x2p.xlsxToPdf(wb, { fetchFont, fileName: 'book.xlsx', title: 'Book' });
assert.equal(res.sheets, 2, 'hidden sheet skipped');
const out = await pdfjs.getDocument({ data: res.pdf.slice(), isEvalSupported: false }).promise;
const pageText = async (i) => (await (await out.getPage(i)).getTextContent()).items.map((t) => t.str).join(' ');
const p1 = await pageText(1);
assert.match(p1, /Item\s+name/, 'rich text runs');
for (const s of ['Invoice & Receipt', '$1,234.50', '1/1/2024', 'TRUE', '#DIV/0!', 'overflows', 'Page 1 of', 'Invoice']) assert.ok(p1.includes(s), `page 1 has “${s}”: ${p1}`);
assert.ok(!p1.includes('999') && !/(^| )#+( |$)/.test(p1), 'hidden column not printed');
const pg1 = await out.getPage(1);
assert.deepEqual([pg1.view[2], pg1.view[3]], [612, 792], 'Letter from the sheet’s paper size');
assert.ok(res.pages >= 3, `wide RTL sheet spreads over pages or fits: ${res.pages}`);
const lastText = await pageText(2);
assert.ok(lastText.includes('یہ اردو متن ہے') || lastText.includes('اردو'), 'Urdu text drawn');
mkdirSync('test/out', { recursive: true });
writeFileSync('test/out/xlsx-to-pdf.pdf', res.pdf);
// fit options
const actual = await x2p.xlsxToPdf(wb, { fetchFont, sheets: [2], fit: 'actual', orientation: 'portrait', paper: 'a4' });
const onePage = await x2p.xlsxToPdf(wb, { fetchFont, sheets: [2], fit: 'page' });
assert.ok(actual.pages > 2, `actual size splits columns and rows: ${actual.pages}`);
assert.equal(onePage.pages, 1);
await assert.rejects(x2p.xlsxToPdf({ sheets: [{ ...secret, maxR: -1, cells: new Map() }], date1904: false }, { fetchFont, sheets: [0] }), /EMPTY/);
ok(`Excel → PDF: text, formats, merges, hidden columns, footer codes, Urdu, fit modes (${res.pages} pages)`);

// CSV
const csv = rd.csvToWorkbook('Name;Amount;Code\n"Smith; John";1200.5;007\n"Multi\nline";-3;x\n');
assert.equal(cell(csv.sheets[0], 'A2').text, 'Smith; John');
assert.equal(cell(csv.sheets[0], 'B2').kind, 'n'); assert.equal(cell(csv.sheets[0], 'C2').kind, 's', 'leading zeros stay text');
assert.equal(cell(csv.sheets[0], 'A3').text, 'Multi\nline');
const csvPdf = await x2p.xlsxToPdf(csv, { fetchFont });
assert.equal(csvPdf.pages, 1);
ok('CSV: delimiter detection, quotes, numbers, to PDF');

// ── PDF → Excel
assert.deepEqual(tb.parseNumber('1,234.50'), { v: 1234.5, fmt: '#,##0.00' });
assert.deepEqual(tb.parseNumber('(75.00)'), { v: -75, fmt: '0.00;(0.00)' });
assert.deepEqual(tb.parseNumber('12.5%'), { v: 0.125, fmt: '0.0%' });
assert.deepEqual(tb.parseNumber('$9.99'), { v: 9.99, fmt: '"$"0.00' });
assert.deepEqual(tb.parseNumber('Rs. 1,500'), { v: 1500, fmt: '"Rs. "#,##0' });
assert.deepEqual(tb.parseNumber('42'), { v: 42, fmt: 'General' });
assert.deepEqual(tb.parseNumber('-3'), { v: -3, fmt: 'General' });
assert.deepEqual(tb.parseNumber('250.00-'), { v: -250, fmt: '0.00' });
for (const s of ['00123', '4111 1111 1111 1111', '12/05/2024', 'Total', '1.234,56', '1234567890123456', '+92 300 1234567']) assert.equal(tb.parseNumber(s), null, s);
ok('PDF → Excel number detection (keeps IDs, dates and card numbers as text)');

const pd = await PDFDocument.create();
const reg = await pd.embedFont(StandardFonts.Helvetica), bold = await pd.embedFont(StandardFonts.HelveticaBold);
const pg = pd.addPage([595, 842]);
let y = 780;
pg.drawText('Bank Statement - March 2024', { x: 50, y, size: 16, font: bold }); y -= 30;
pg.drawText('Account holder: A. Khan, Karachi', { x: 50, y, size: 10, font: reg }); y -= 26;
const cols = [50, 120, 330, 420, 505];
const right = (t, x, f = reg) => pg.drawText(t, { x: x - f.widthOfTextAtSize(t, 10), y, size: 10, font: f });
['Date', 'Description'].forEach((t, i) => pg.drawText(t, { x: cols[i], y, size: 10, font: bold }));
right('Debit', 400, bold); right('Credit', 480, bold); right('Balance', 560, bold); y -= 16;
const tx = [['01/03/2024', 'Opening balance', '', '', '10,000.00'], ['02/03/2024', 'Grocery store purchase card 1234', '2,350.75', '', '7,649.25'], ['05/03/2024', 'Salary', '', '85,000.00', '92,649.25'], ['09/03/2024', 'Electricity bill', '4,120.00', '', '88,529.25'], ['15/03/2024', 'Transfer to savings', '(10,000.00)', '', '78,529.25']];
for (const r of tx) { pg.drawText(r[0], { x: cols[0], y, size: 10, font: reg }); pg.drawText(r[1], { x: cols[1], y, size: 10, font: reg }); if (r[2]) right(r[2], 400); if (r[3]) right(r[3], 480); right(r[4], 560); y -= 16; }
y -= 10; pg.drawText('Closing balance', { x: cols[1], y, size: 10, font: bold }); right('78,529.25', 560, bold);
pg.drawLine({ start: { x: 50, y: 100 }, end: { x: 545, y: 100 }, color: rgb(0, 0, 0) });
const stmt = await pd.save();
writeFileSync('test/out/statement.pdf', stmt);
const src = await pdfjs.getDocument({ data: stmt.slice(), isEvalSupported: false }).promise;
const page = await src.getPage(1);
await page.getOperatorList();
const items = tb.itemsFromTextContent(await page.getTextContent(), page.getViewport({ scale: 1 }), (fn) => /bold/i.test(page.commonObjs.get(fn)?.name ?? ''));
const t = tb.pageTable(items);
const texts = t.rows.map((r) => r.map((c) => c.text));
assert.equal(texts[0][0], 'Bank Statement - March 2024');
assert.equal(texts[1][0], 'Account holder: A. Khan, Karachi');
assert.deepEqual(texts[2], ['Date', 'Description', 'Debit', 'Credit', 'Balance']);
assert.deepEqual(texts[4], ['02/03/2024', 'Grocery store purchase card 1234', '2,350.75', '', '7,649.25']);
assert.deepEqual(texts[5], ['05/03/2024', 'Salary', '', '85,000.00', '92,649.25']);
assert.deepEqual(texts[8], ['', 'Closing balance', '', '', '78,529.25']);
assert.ok(t.rows[2][0].bold && !t.rows[4][0].bold, 'bold header detected');
const cells = tb.toCells(t.rows, true, t.bodySize);
assert.equal(cells[4][2].v, 2350.75); assert.equal(cells[4][2].fmt, '#,##0.00'); assert.equal(cells[4][2].sz, undefined, 'body text stays 11 pt'); assert.ok(cells[0][0].sz > 14, 'title is bigger');
assert.equal(cells[7][2].v, -10000);
assert.equal(cells[4][0].v, '02/03/2024', 'dates stay text');
const xbytes = await wr.writeXlsx([{ name: 'Page 1', rows: cells }, { name: 'Page 1', rows: [[{ v: 'x' }]] }, { name: 'Bad:/Name*?', rows: [] }], { title: 'Statement' });
const back = await rd.readXlsx(xbytes);
assert.deepEqual(back.sheets.map((s) => s.name), ['Page 1', 'Page 1 (2)', 'Bad  Name']);
assert.equal(cell(back.sheets[0], 'C5').text, '2,350.75');
assert.equal(cell(back.sheets[0], 'C8').text, '(10,000.00)');
assert.equal(cell(back.sheets[0], 'A3').style.font.b, true);
assert.equal(cell(back.sheets[0], 'B5').text, 'Grocery store purchase card 1234');
assert.ok(back.sheets[0].colW[1] > back.sheets[0].colW[0], 'columns sized to content');
const z2 = await JSZip.loadAsync(xbytes);
for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'docProps/core.xml']) assert.ok(z2.file(part), part);
writeFileSync('test/out/pdf-to-excel.xlsx', xbytes);
ok('PDF → Excel: statement table with right-aligned numbers, bold header, totals row; valid .xlsx round trip');

// right-to-left table
const ur = tb.pageTable([
  { x0: 400, x1: 450, y: 100, size: 10, str: 'نام' }, { x0: 200, x1: 240, y: 100, size: 10, str: 'رقم' },
  { x0: 400, x1: 460, y: 115, size: 10, str: 'احمد' }, { x0: 200, x1: 230, y: 115, size: 10, str: '500' },
]);
assert.ok(ur.rtl); assert.deepEqual(ur.rows.map((r) => r.map((c) => c.text)), [['نام', 'رقم'], ['احمد', '500']]);
ok('right-to-left tables keep reading order');
// ── formula engine
{
  const cells = { 'A1': 10, 'A2': 20, 'A3': 30, 'B1': 'apple', 'B2': 'banana', 'B3': 'cherry', 'C1': true, 'D1': null };
  const other = { 'A1': 5 };
  const ctx = {
    cell: (sh, r, c) => { const k = `${String.fromCharCode(65 + c)}${r + 1}`; const src = sh && sh.toLowerCase() === 'my sheet' ? other : cells; return src[k] ?? null; },
    bounds: () => ({ maxR: 2, maxC: 3 }), name: (n) => (n.toLowerCase() === 'rate' ? '0.5' : undefined), here: { r: 4, c: 0 },
  };
  const e = (f) => { const v = fx.evaluate(f, ctx); return v instanceof fx.FErr ? v.code : Array.isArray(v) ? v : v; };
  assert.equal(e('=1+2*3^2'), 19); assert.equal(e('=-2^2'), 4); assert.equal(e('=(1+2)*3'), 9); assert.equal(e('=10%'), 0.1);
  assert.equal(e('=SUM(A1:A3)'), 60); assert.equal(e('=SUM(A:A)'), 60); assert.equal(e('=AVERAGE(A1:A3)'), 20); assert.equal(e("='My Sheet'!A1*2"), 10);
  assert.equal(e('=A1&" items"'), '10 items'); assert.equal(e('=IF(A2>15,"big","small")'), 'big'); assert.equal(e('=A1/0'), '#DIV/0!');
  assert.equal(e('=IFERROR(A1/0,"n/a")'), 'n/a'); assert.equal(e('=VLOOKUP(20,A1:B3,2,FALSE)'), 'banana'); assert.equal(e('=INDEX(B1:B3,MATCH(30,A1:A3,0))'), 'cherry');
  assert.equal(e('=COUNTIF(A1:A3,">15")'), 2); assert.equal(e('=SUMIF(B1:B3,"b*",A1:A3)'), 20); assert.equal(e('=SUMPRODUCT(A1:A3,A1:A3)'), 1400);
  assert.equal(e('=ROUND(2.345,2)'), 2.35); assert.equal(e('=TEXT(1234.5,"#,##0.00")'), '1,234.50'); assert.equal(e('=UPPER(LEFT(B2,3))'), 'BAN');
  assert.equal(e('=DATE(2024,1,1)'), 45292); assert.equal(e('=YEAR(45292)+MONTH(45292)'), 2025); assert.equal(e('=EOMONTH(45292,1)'), 45351);
  assert.equal(e('=rate*A1'), 5); assert.equal(e('=AND(C1,A1>5)'), true); assert.equal(e('=ISBLANK(D1)'), true); assert.equal(e('=ROW()'), 5);
  assert.equal(e('=PMT(0.01,12,-1000)').toFixed(2), '88.85'); assert.equal(e('=MAX(A1:A3)-MIN(A1:A3)'), 20); assert.equal(e('=XLOOKUP("cherry",B1:B3,A1:A3)'), 30);
  assert.equal(e('=FOOBAR(1)'), '#NAME?'); assert.ok(fx.evaluate('=FOOBAR(1)', ctx).unsupported);
  assert.equal(fx.shiftFormula('SUM(A1:B2)+$C$1+C$2+$D3+Sheet2!E5', 2, 1), 'SUM(B3:C4)+$C$1+D$2+$D5+Sheet2!F7');
  assert.equal(fx.shiftFormula('SUM(A:A)+LOG10(B1)', 1, 1), 'SUM(B:B)+LOG10(C2)');
  ok('formula engine: operators, ~90 functions, cross-sheet refs, names, shared-formula shifting');
}

// ── realistic workbook (written like Excel: charts, chart sheet, shapes, logo, CF, shared formulas, print titles)
{
  const book = await rd.readXlsx(readFileSync('test/fixtures/sales-report.xlsx'), { today: new Date('2024-04-10') });
  const [dash, data, tr, trend, urdu, lookup] = book.sheets;
  assert.deepEqual(book.sheets.map((s) => s.name), ['Dashboard', 'Data', 'Transactions', 'Trend', 'رپورٹ', 'Lookup']);
  assert.ok(lookup.hidden && urdu.rtl && !dash.showGrid);
  assert.equal(book.formulasWithoutValue, 0, 'every formula was calculated or had a saved result');
  assert.equal(cell(data, 'F3').text, '$100,121', 'shared formula, saved result');
  assert.equal(cell(data, 'G3').text, '2.1%', 'shared formula without a saved result is calculated');
  assert.equal(cell(data, 'G4').text, '-1.7%');
  assert.match(cell(data, 'H2').text, /Below average/); assert.equal(cell(data, 'B16').text, 'Dec');
  assert.equal(cell(data, 'B15').text, '$23,113');
  assert.equal(cell(dash, 'E5').text, 'West', 'INDEX/MATCH across sheets');
  assert.equal(cell(dash, 'G5').text, '6', 'COUNTIF across sheets');
  assert.equal(cell(tr, 'E1502').text, '$7,596,943');
  // conditional formatting
  assert.ok(cell(data, 'B2').cf?.fill && cell(data, 'B2').cf.fill !== cell(data, 'C2').cf.fill, 'colour scale');
  assert.ok(cell(data, 'F13').cf?.bar?.frac > cell(data, 'F7').cf.bar.frac, 'data bars');
  assert.equal(cell(data, 'G3').cf?.icon?.set, '3Arrows'); assert.equal(cell(data, 'G3').cf.icon.idx, 2); assert.equal(cell(data, 'G4').cf.icon.idx, 1); assert.equal(cell(data, 'G6').cf.icon.idx, 0);
  assert.equal(cell(data, 'H3').cf?.fill, 'C6EFCE', 'contains-text rule');
  assert.equal(cell(tr, 'F6').cf?.fill, 'FFC7CE', 'Overdue highlighted');
  assert.ok(cell(tr, 'A4').cf?.fill && !cell(tr, 'A3').cf?.fill, 'MOD(ROW(),2)=0 bands even rows');
  // drawings
  const kinds = dash.objects.map((o) => o.kind);
  assert.deepEqual(kinds, ['pic', 'chart', 'chart', 'chart', 'chart', 'shape', 'shape', 'shape']);
  const charts = dash.objects.filter((o) => o.kind === 'chart');
  assert.equal(charts[0].spec.groups[0].type, 'bar'); assert.equal(charts[0].spec.groups[0].series.length, 4); assert.equal(charts[0].spec.title, 'Monthly sales by region');
  assert.equal(charts[1].spec.groups[0].type, 'pie'); assert.ok(charts[1].spec.groups[0].series[0].labels.pct);
  assert.equal(charts[3].spec.groups[0].grouping, 'stacked'); assert.equal(charts[3].spec.groups[0].series[2].vals[11], 39342, 'chart without cache reads the cells');
  assert.equal(charts[3].spec.groups[0].series[0].cats[0], 'Jan');
  const tb1 = dash.objects[5]; assert.equal(tb1.paras[0].runs[0].text, 'Note from Finance: '); assert.ok(tb1.paras[0].runs[0].b); assert.equal(tb1.fill, 'FFF2CC');
  assert.equal(dash.objects[6].geom, 'roundRect'); assert.equal(dash.objects[6].fill, '4472C4', 'theme style fill'); assert.equal(dash.objects[6].textColor, 'FFFFFF');
  assert.equal(dash.objects[7].geom, 'rightArrow');
  assert.ok(trend.chartPage && trend.chartPage.spec.groups[0].type === 'area');
  assert.deepEqual(tr.repeatRows, [0, 0]); assert.ok(tr.rowBreaks.has(101));
  const res = await x2p.xlsxToPdf(book, { fetchFont, fileName: 'sales-report.xlsx' });
  assert.equal(res.pages, 44); assert.equal(res.sheets, 5); assert.equal(res.skippedObjects, 0);
  const out = await pdfjs.getDocument({ data: res.pdf.slice(), isEvalSupported: false }).promise;
  const txt = async (i) => (await (await out.getPage(i)).getTextContent()).items.map((t) => t.str).join(' ');
  const p1 = await txt(1);
  for (const s of ['Quarterly Sales Report 2024', '1,200,884', '100,074', 'West', 'Monthly sales by region', 'Share by region', 'Total sales', '$140,000', '27%', 'Note from Finance:', 'Target met', 'Page 1 of 2']) assert.ok(p1.includes(s), `dashboard has “${s}”`);
  const p3 = await txt(3);
  for (const s of ['Above average', '2.1%', '$1,200,884', 'Dec']) assert.ok(p3.includes(s), `data sheet has “${s}”`);
  assert.match(await txt(5), /^Date\s+Invoice\s+Customer\s+Region\s+Amount\s+Status/, 'title row repeated on the next page');
  assert.match(await txt(7), /INV-00101/, 'manual page break');
  assert.ok((await txt(7)).indexOf('INV-00101') < (await txt(7)).indexOf('INV-00102'));
  assert.match(await txt(42), /Grand total\s+\$7,596,943/);
  const p43 = await out.getPage(43); assert.ok(p43.view[2] > p43.view[3], 'chart sheet is landscape');
  assert.match(await txt(43), /Sales trend 2024/);
  writeFileSync('test/out/sales-report.pdf', res.pdf);
  ok(`realistic workbook: formulas calculated, conditional formats, 5 charts + chart sheet, shapes, print titles, page breaks (${res.pages} pages)`);

  const inv = await rd.readXlsx(readFileSync('test/fixtures/invoice.xlsx'));
  const s0 = inv.sheets[0];
  assert.equal(cell(s0, 'E9').text, 'Rs 85,000.00'); assert.equal(cell(s0, 'E14').text, 'Rs 173,000.00'); assert.equal(cell(s0, 'E16').text, 'Rs 200,680.00');
  assert.equal(cell(s0, 'D17').text, '(200,680 rupees)'); assert.equal(cell(s0, 'E6').text, '05-May-2024');
  assert.equal(cell(s0, 'A19').runs.length, 3); assert.ok(cell(s0, 'A19').runs[0].font.b); assert.equal(cell(s0, 'A19').runs[2].font.color, 'C00000');
  assert.ok(cell(s0, 'A14').style.border.down); assert.equal(cell(s0, 'A8').style.rot, 90);
  const ir = await x2p.xlsxToPdf(inv, { fetchFont });
  assert.equal(ir.pages, 1);
  const it = (await (await (await pdfjs.getDocument({ data: ir.pdf.slice(), isEvalSupported: false }).promise).getPage(1)).getTextContent()).items.map((t) => t.str).join(' ');
  for (const s of ['INVOICE', 'Rs 85,000.00', 'Rs 173,000.00', 'Rs 27,680.00', 'Rs 200,680.00', '(200,680 rupees)', 'Thank you for your business!', 'Late payments']) assert.ok(it.includes(s), `invoice has “${s}”`);
  ok('invoice workbook: calculated totals, rich text, rotated and diagonal cells, print area, logo');
}

// ── realistic PDFs → Excel
const toTable = async (file) => {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n); const vp = page.getViewport({ scale: 1 });
    const g = gx.pageGraphics(await page.getOperatorList(), pdfjs.OPS, vp);
    const style = (fn) => { const nm = String(page.commonObjs.has(fn) ? page.commonObjs.get(fn)?.name ?? '' : ''); return { b: /bold/i.test(nm), i: /oblique|italic/i.test(nm) }; };
    const tc = await page.getTextContent();
    const list = tc.items.filter((i) => typeof i.str === 'string');
    pages.push(tb.pageTable(tb.itemsFromTextContent(tc, vp, style, gx.colorsForItems(list, g.textColors)), g, { w: vp.width, h: vp.height }));
  }
  return pages;
};
{
  const pages = await toTable('test/fixtures/bank-statement.pdf');
  const fake = new Map(pages.flatMap((p, i) => p.images.map((im) => [`${i}|${im.id}`, { bytes: new Uint8Array([137, 80, 78, 71]), w: 1, h: 1 }])));
  const st = tb.stackPages(pages, true, fake, (p, id) => `${p}|${id}`);
  const rows = st.rows.map((r) => r.map((c) => c?.v ?? ''));
  const head = rows.findIndex((r) => r[0] === 'Date');
  assert.deepEqual(rows[head], ['Date', 'Description', 'Debit', 'Credit', 'Balance']);
  assert.ok(st.rows[head].every((c) => c.fill === '1F4F78' && c.color === 'FFFFFF' && c.b), 'header fill, white bold text');
  const txRows = st.rows.filter((r) => /^\d\d\/03\/2024$/.test(r[0]?.v ?? ''));
  assert.equal(txRows.length, 70, 'every transaction, across pages');
  const salary = txRows.find((r) => /^Salary/.test(r[1].v));
  assert.equal(salary[1].v, 'Salary credit Pixel Works (Pvt) Ltd for the month of March 2024', 'wrapped description joined');
  assert.equal(typeof txRows[0][2].v, 'number'); assert.equal(txRows[0][2].color, 'BF0000', 'red debits');
  assert.equal(txRows[1][0].fill, 'F0F5FA', 'alternate row shading'); assert.ok(txRows[0][0].border?.b, 'row rules become borders');
  assert.ok(rows.some((r) => r[1] === 'Closing balance' && typeof r[4] === 'number'));
  assert.ok(rows.some((r) => r.includes('Page 2 of 2')), 'nothing on the page is dropped');
  assert.equal(st.images.length, 1, 'logo placed');
  assert.ok(st.rows.find((r) => r[1]?.v === 'Meezan Digital Bank')[1].sz > 15, 'title size kept');
  const x = await wr.writeXlsx([{ name: 'Statement', ...st }]);
  const back = await rd.readXlsx(x);
  assert.equal(back.sheets[0].objects.filter((o) => o.kind === 'pic').length, 1);
  assert.equal(cell(back.sheets[0], `A${head + 1}`).style.fill, '1F4F78');
  ok('bank statement PDF → Excel: 70 rows over 2 pages, joined wrapped lines, fills, colours, borders, sizes, logo');

  const [ip] = await toTable('test/fixtures/invoice.pdf');
  const r = ip.rows.map((x) => x.map((c) => c.text));
  const h = r.findIndex((x) => x[0] === 'Item');
  assert.deepEqual(r[h], ['Item', 'Description', 'Qty', 'Unit price', 'Amount'], 'ruled table columns');
  assert.deepEqual(r[h + 3], ['3', 'Hosting (months)', '12', '1,500.00', '18,000.00']);
  assert.deepEqual(r.find((x) => x[0] === 'Pixel Works (Pvt) Ltd')?.slice(0, 2), ['Pixel Works (Pvt) Ltd', 'Bright Foods Ltd'], 'two address blocks side by side');
  assert.ok(['l', 'r', 'b'].every((k) => ip.rows[h + 1][2].border?.[k]), 'grid borders on every cell');
  assert.equal(ip.rows[h][0].fill, 'D9E3F2'); assert.equal(ip.rows[h + 1][0].align, 'center');
  assert.ok(r.some((x) => x.includes('Rs 183,280.00')));
  ok('invoice PDF → Excel: ruled grid, header shading, centred numbers, side-by-side address blocks');
}
console.log('xlsx tests passed');

