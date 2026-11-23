/** Build a minimal, valid .docx (Office Open XML) from structural blocks. jszip is lazy-loaded. */
import type { Block } from './markdown';

export interface DocxOptions {
  /** Page size in PDF points (1/72 in). Defaults to A4. */
  pageWidth?: number;
  pageHeight?: number;
  /** Start a new Word page wherever the PDF had one. */
  pageBreaks?: boolean;
  title?: string;
}

// Characters that are not allowed in XML 1.0 (control chars, lone surrogates, U+FFFE/FFFF).
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

export const xmlEscape = (s: string) =>
  s.replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const run = (text: string, rtl: boolean, b = false, i = false) => {
  const pr = (b ? '<w:b/><w:bCs/>' : '') + (i ? '<w:i/><w:iCs/>' : '') + (rtl ? '<w:rtl/>' : '');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
};

function paragraph(b: Exclude<Block, { type: 'page' }>, pageBreakBefore: boolean): string {
  const rtl = RTL.test(b.text);
  const props: string[] = [];
  if (b.type === 'h') props.push(`<w:pStyle w:val="Heading${b.level}"/>`);
  if (b.type === 'li') {
    props.push('<w:pStyle w:val="ListParagraph"/>');
    if (b.marker === null) props.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    else props.push('<w:ind w:left="720" w:hanging="360"/>');
  }
  if (pageBreakBefore) props.push('<w:pageBreakBefore/>');
  if (rtl) props.push('<w:bidi/>');
  if ('center' in b && b.center) props.push('<w:jc w:val="center"/>');
  const marker = b.type === 'li' && b.marker !== null ? run(b.marker, rtl) + '<w:r><w:tab/></w:r>' : '';
  const styled = 'runs' in b && b.runs?.length ? b.runs : null;
  const runs = marker + (styled
    ? styled.map((r) => run(r.text, rtl, r.b && b.type !== 'h', r.i)).join('')
    : b.text.split('\t').map((t, i) => (i ? '<w:r><w:tab/></w:r>' : '') + (t ? run(t, rtl) : '')).join(''));
  return `<w:p>${props.length ? `<w:pPr>${props.join('')}</w:pPr>` : ''}${runs}</w:p>`;
}

export function documentXml(blocks: Block[], opts: DocxOptions = {}): string {
  const w = Math.round((opts.pageWidth ?? 595.28) * 20);
  const h = Math.round((opts.pageHeight ?? 841.89) * 20);
  const body: string[] = [];
  let breakNext = false;
  for (const b of blocks) {
    if (b.type === 'page') { if (opts.pageBreaks && body.length) breakNext = true; continue; }
    body.push(paragraph(b, breakNext));
    breakNext = false;
  }
  if (!body.length) body.push('<w:p/>');
  const orient = w > h ? ' w:orient="landscape"' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"${orient}/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const heading = (n: number, size: number, before: number) =>
  `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, 36, 360)}${heading(2, 30, 280)}${heading(3, 26, 240)}${heading(4, 24, 200)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style></w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;

const core = (title: string) => {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>PDFSherpa</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
};

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function blocksToDocx(blocks: Block[], opts: DocxOptions = {}): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const parts: [string, string][] = [
    ['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', ROOT_RELS], ['word/_rels/document.xml.rels', DOC_RELS],
    ['word/document.xml', documentXml(blocks, opts)], ['word/styles.xml', STYLES], ['word/numbering.xml', NUMBERING], ['docProps/core.xml', core(opts.title ?? '')],
  ];
  for (const [name, xml] of parts) zip.file(name, xml, { createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: DOCX_MIME });
}
