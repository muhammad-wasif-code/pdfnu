// Builds test/fixtures/sample.docx: a Word-style package that exercises styles, numbering, tables,
// images, sections, headers/footers with page fields, a text box and non-Latin text.
// Run: node test/make-docx-fixture.mjs
import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'node:fs';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const t = (s, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${s}</w:t></w:r>`;
const p = (runs, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
const cell = (content, w, extra = '') => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${extra}</w:tcPr>${content}</w:tc>`;
const img = (id, cx, cy) => `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

const body = [
  p(t('Annual Report 2026'), '<w:pStyle w:val="Title"/>'),
  p(t('1. Introduction'), '<w:pStyle w:val="Heading1"/>'),
  p(t('This paragraph has ') + t('bold', '<w:b/>') + t(', ') + t('italic', '<w:i/>') + t(', ') + t('underlined', '<w:u w:val="single"/>') + t(', ') + t('red', '<w:color w:val="C00000"/>') + t(', ') + t('highlighted', '<w:highlight w:val="yellow"/>') + t(' and ') + t('struck', '<w:strike/>') + t(' text, E=mc') + t('2', '<w:vertAlign w:val="superscript"/>') + t(' and H') + t('2', '<w:vertAlign w:val="subscript"/>') + t('O. Accents: café, naïve, Straße, Ελληνικά, Русский.')),
  p(t(lorem + ' ' + lorem), '<w:jc w:val="both"/>'),
  p(t('Centered line'), '<w:jc w:val="center"/>'),
  p(t('Right aligned line'), '<w:jc w:val="right"/>'),
  p(t('Name:') + '<w:r><w:tab/></w:r>' + t('Jane Doe')),
  p(t('First item'), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
  p(t('Second item'), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
  p(t('Nested item'), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>'),
  p(t('Third item'), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
  p(t('Bullet one'), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
  p(t('Bullet two that is long enough to wrap onto a second line so the hanging indent can be checked in the output PDF file.'), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
  p(t('2. Figures'), '<w:pStyle w:val="Heading1"/>'),
  p(img('rIdImg', 1828800, 914400) + t(' A 2 × 1 inch image in line.')),
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
    <w:tr>${cell(p(t('Region', '<w:b/>')), 3000, '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>')}${cell(p(t('Q1', '<w:b/>')), 3000, '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>')}${cell(p(t('Q2', '<w:b/>')), 3000, '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>')}</w:tr>
    <w:tr>${cell(p(t('North (merged down)')), 3000, '<w:vMerge w:val="restart"/>')}${cell(p(t('120')), 3000)}${cell(p(t('140')), 3000)}</w:tr>
    <w:tr>${cell(p(''), 3000, '<w:vMerge/>')}${cell(p(t('Spans two columns')), 6000, '<w:gridSpan w:val="2"/>')}</w:tr>
  </w:tbl>`,
  p(t('Text box below:')),
  p(`<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:extent cx="1828800" cy="457200"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx><w:txbxContent>${p(t('Inside a text box'))}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict>${p(t('FALLBACK SHOULD NOT APPEAR'))}</w:pict></mc:Fallback></mc:AlternateContent></w:r>`),
  p(t('Urdu: اردو متن')),
  p(t('یہ ایک اردو پیراگراف ہے جو دائیں سے بائیں لکھا جاتا ہے۔ اس میں Microsoft Word اور 2026 جیسے الفاظ بھی ہیں۔', '<w:rtl/><w:sz w:val="22"/><w:szCs w:val="28"/>'), '<w:bidi/>'),
  p(t('यह हिन्दी में लिखा गया एक वाक्य है।', '<w:szCs w:val="24"/>')),
  p(t('中文：你好，世界。日本語のテキスト。')),
  p(t('Times New Roman paragraph for metric checks.', '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>')),
  p(t('Software Engineer, Acme Ltd', '<w:b/>') + '<w:r><w:tab/></w:r>' + t('2022 – 2025'), '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9026"/></w:tabs>'),
  p(t('Centered tab:') + '<w:r><w:tab/></w:r>' + t('middle'), '<w:tabs><w:tab w:val="center" w:pos="4513"/></w:tabs>'),
  p('<w:r><w:br w:type="page"/></w:r>'),
  p(t('3. After the page break'), '<w:pStyle w:val="Heading1"/>'),
  ...Array.from({ length: 30 }, (_, i) => p(t(`Paragraph ${i + 1}. ${lorem}`))),
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr>${cell(Array.from({ length: 25 }, (_, i) => p(t(`Long cell line ${i + 1}. ${lorem}`))).join(''), 9000)}</w:tr></w:tbl>`,
  p(t('Landscape section follows.'), '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'),
  p(t('This page is landscape A4.'), '<w:pStyle w:val="Heading2"/>'),
  p(t(lorem)),
].join('');

const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:sz w:val="56"/><w:color w:val="1F3864"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="32"/><w:color w:val="2F5496"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/><w:rPr><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W}>${p(t('PDFSherpa test document', '<w:color w:val="808080"/>'), '<w:jc w:val="right"/>')}</w:hdr>`;
const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W}>${p(t('Page ') + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' + t(' of ') + '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>9</w:t></w:r></w:fldSimple>', '<w:jc w:val="center"/>')}</w:ftr>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`);
zip.file('word/document.xml', doc);
zip.file('word/styles.xml', styles);
zip.file('word/numbering.xml', numbering);
zip.file('word/header1.xml', header);
zip.file('word/footer1.xml', footer);
zip.file('word/media/image1.png', readFileSync('test/fixtures/image.png'));
writeFileSync('test/fixtures/sample.docx', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('wrote test/fixtures/sample.docx');
