// PDF → Word (.docx) on a generated document. Run: node test/docx.test.mjs
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
await build({ entryPoints: ['src/lib/markdown.ts', 'src/lib/docxWrite.ts'], bundle: true, format: 'esm', platform: 'node', outdir: 'test/out', external: ['jszip'], logLevel: 'error' });
const md = await import('../test/out/markdown.js');
const dx = await import('../test/out/docxWrite.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const doc = await PDFDocument.create();
const f = await doc.embedFont(StandardFonts.Helvetica);
let p = doc.addPage([612, 792]); // Letter
let y = 720;
const line = (t, size, x = 50, gap = 1.4) => { p.drawText(t, { x, y, size, font: f }); y -= size * gap; };
line('Annual Report', 24, 50, 1.8);
line('Introduction', 16, 50, 1.6);
line('Smith & Jones <Partners> said "hello" to every-', 11);
line('one on the team.', 11, 50, 2.4);
line('• First point', 11);
line('1. Step one', 11, 50, 2.4);
p = doc.addPage([612, 792]); y = 720;
line('Second page text.', 11);
const pdf = await pdfjs.getDocument({ data: await doc.save(), isEvalSupported: false }).promise;
const blocks = md.toBlocks(await md.readLines(pdf));

const bytes = await dx.blocksToDocx(blocks, { pageWidth: 612, pageHeight: 792, pageBreaks: true, title: 'Report & co' });
const zip = await JSZip.loadAsync(bytes);
for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']) assert.ok(zip.file(part), `missing ${part}`);
const x = await zip.file('word/document.xml').async('string');
assert.match(x, /<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">Annual Report</);
assert.match(x, /<w:pStyle w:val="Heading2"\/>.*Introduction/);
assert.match(x, /Smith &amp; Jones &lt;Partners&gt; said &quot;hello&quot; to everyone on the team\./, 'escaped + hyphen re-joined');
assert.match(x, /<w:numId w:val="1"\/>.*First point/, 'bullet uses Word numbering');
assert.match(x, />1\.<\/w:t><\/w:r><w:r><w:tab\/><\/w:r><w:r><w:t xml:space="preserve">Step one</, 'numbered item keeps its number');
assert.match(x, /<w:pageBreakBefore\/><\/w:pPr><w:r><w:t xml:space="preserve">Second page text\./);
assert.match(x, /<w:pgSz w:w="12240" w:h="15840"\/>/, 'Letter page size in twips');
assert.match(await zip.file('docProps/core.xml').async('string'), /<dc:title>Report &amp; co<\/dc:title>/);

// no page breaks option + RTL + control characters
const x2 = dx.documentXml([{ type: 'p', text: 'a' }, { type: 'page' }, { type: 'p', text: 'اردو\u0001 متن' }], { pageBreaks: false, pageWidth: 842, pageHeight: 595 });
assert.doesNotMatch(x2, /pageBreakBefore/);
assert.match(x2, /<w:bidi\/>.*<w:rtl\/>.*اردو متن/);
assert.match(x2, /w:orient="landscape"/);
// bold / italic runs and centred lines (read with styles)
{
  const d2 = await PDFDocument.create();
  const reg = await d2.embedFont(StandardFonts.Helvetica), bold = await d2.embedFont(StandardFonts.HelveticaBold), it = await d2.embedFont(StandardFonts.HelveticaOblique);
  const pg = d2.addPage([600, 800]);
  const title = 'Jane Doe', tw = reg.widthOfTextAtSize(title, 11);
  pg.drawText(title, { x: 300 - tw / 2, y: 740, size: 11, font: reg });
  pg.drawText('Skills:', { x: 50, y: 700, size: 11, font: bold });
  pg.drawText(' TypeScript and', { x: 50 + bold.widthOfTextAtSize('Skills:', 11), y: 700, size: 11, font: reg });
  pg.drawText(' design', { x: 50 + bold.widthOfTextAtSize('Skills:', 11) + reg.widthOfTextAtSize(' TypeScript and', 11), y: 700, size: 11, font: it });
  const pdf2 = await pdfjs.getDocument({ data: await d2.save(), isEvalSupported: false, standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' }).promise;
  const bl = md.toBlocks(await md.readLines(pdf2, undefined, { styles: true }));
  const x3 = dx.documentXml(bl, {});
  assert.match(x3, /<w:jc w:val="center"\/><\/w:pPr><w:r><w:t xml:space="preserve">Jane Doe/, 'centred line');
  assert.match(x3, /<w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">Skills: ?<\/w:t>/, 'bold run');
  assert.match(x3, /<w:i\/><w:iCs\/><\/w:rPr><w:t xml:space="preserve"> ?design/, 'italic run');
}
console.log('✓ docx: headings, escaping, lists, page breaks, page size, RTL, metadata, bold/italic, centring');
