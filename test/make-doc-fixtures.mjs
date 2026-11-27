// Builds sample.odt, sample.epub, sample.md, sample.txt, sample.csv and sample.svg in test/fixtures.
import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'node:fs';
const png = readFileSync('test/fixtures/image.png');

// ── ODT ──
{
  const z = new JSZip();
  z.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  z.file('META-INF/manifest.xml', '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
  z.file('meta.xml', '<?xml version="1.0"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><office:meta><dc:title>Project Report</dc:title></office:meta></office:document-meta>');
  z.file('Pictures/logo.png', png);
  z.file('styles.xml', `<?xml version="1.0"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:styles>
<style:style style:name="Heading_20_1" style:family="paragraph"><style:text-properties fo:font-size="18pt" fo:font-weight="bold" fo:color="#1f3864"/></style:style>
<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"/></text:list-style>
<text:list-style style:name="L2"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style>
</office:styles></office:document-styles>`);
  z.file('content.xml', `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0">
<office:automatic-styles>
<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic" fo:color="#c00000"/></style:style>
<style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>
<style:style style:name="P2" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style>
<style:style style:name="C1" style:family="table-cell"><style:table-cell-properties fo:background-color="#dbeafe" fo:border="0.5pt solid #000000"/></style:style>
<style:style style:name="C2" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #000000"/></style:style>
</office:automatic-styles>
<office:body><office:text>
<text:h text:style-name="Heading_20_1" text:outline-level="1">Project Report</text:h>
<text:p text:style-name="P1">Centred line with <text:span text:style-name="T1">bold</text:span> and <text:span text:style-name="T2">red italic</text:span> words.</text:p>
<text:p>Visit <text:a xlink:href="https://pdfsherpa.com">our site</text:a>.<text:s text:c="3"/>Spaces and a<text:line-break/>line break. Urdu: اردو متن</text:p>
<text:list text:style-name="L1"><text:list-item><text:p>First bullet</text:p></text:list-item><text:list-item><text:p>Second bullet</text:p></text:list-item></text:list>
<text:list text:style-name="L2"><text:list-item><text:p>Step one</text:p></text:list-item><text:list-item><text:p>Step two</text:p></text:list-item></text:list>
<table:table><table:table-row><table:table-cell table:style-name="C1"><text:p>Item</text:p></table:table-cell><table:table-cell table:style-name="C1"><text:p>Qty</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell table:style-name="C2"><text:p>Widget</text:p></table:table-cell><table:table-cell table:style-name="C2"><text:p>3</text:p></table:table-cell></table:table-row></table:table>
<text:p><draw:frame svg:width="4cm" svg:height="3cm"><draw:image xlink:href="Pictures/logo.png"/></draw:frame></text:p>
<text:p text:style-name="P2">Second page text.</text:p>
</office:text></office:body></office:document-content>`);
  writeFileSync('test/fixtures/sample.odt', await z.generateAsync({ type: 'nodebuffer', mimeType: 'application/vnd.oasis.opendocument.text' }));
}

// ── EPUB 3 ──
{
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>A Small Book</dc:title><dc:language>en</dc:language></metadata>
<manifest><item id="css" href="styles/book.css" media-type="text/css"/><item id="cover" href="images/cover.png" media-type="image/png"/><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
  z.file('OEBPS/styles/book.css', 'h1{color:#7c2d12;text-align:center} p{text-indent:1.5em;margin:0} .first{text-indent:0}');
  z.file('OEBPS/images/cover.png', png);
  z.file('OEBPS/nav.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><nav><ol><li><a href="text/ch1.xhtml">One</a></li></ol></nav></body></html>');
  const ch = (t, body) => `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${t}</title><link rel="stylesheet" href="../styles/book.css" type="text/css"/></head><body>${body}</body></html>`;
  z.file('OEBPS/text/ch1.xhtml', ch('One', `<h1>Chapter One</h1><p><img src="../images/cover.png" alt="cover" style="width:50%"/></p><p class="first">It was a bright cold day in April.</p>${'<p>The clocks were striking thirteen, and the story went on for a while to fill the page with text.</p>'.repeat(12)}`));
  z.file('OEBPS/text/ch2.xhtml', ch('Two', `<h1>Chapter Two</h1><p class="first">The second chapter starts on a new page. <a href="https://example.com">A link</a>.</p>`));
  writeFileSync('test/fixtures/sample.epub', await z.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' }));
}

writeFileSync('test/fixtures/sample.md', `# Release notes\n\nVersion **2.0** brings *many* improvements. See [the site](https://pdfsherpa.com).\n\n## Features\n\n- Faster PDF tools\n- New converters\n  - Markdown to PDF\n- [x] Tested\n\n| Tool | Status |\n|------|:------:|\n| Merge | ✅ |\n| Split | ✅ |\n\n> Privacy first: files never leave your device.\n\n\`\`\`js\nconst pdf = await convert(file);\n\`\`\`\n`);
writeFileSync('test/fixtures/sample.txt', 'MEETING NOTES\n=============\n\nDate: 27 Nov 2026\nAttendees: A, B, C\n\n1. Budget approved.\n2. Launch next week.\n\n    Indented line kept as is.\nاردو: آج کی میٹنگ\n\fPage two after a form feed.\n' + 'A long line that should wrap at the page edge because it is much longer than the width of an A4 page in a monospace font of 11 points. '.repeat(2) + '\n');
writeFileSync('test/fixtures/sample.csv', 'Date,Description,Category,Amount\n' + Array.from({ length: 120 }, (_, i) => `2026-0${(i % 9) + 1}-${String((i % 27) + 1).padStart(2, '0')},"Item ${i + 1}, with comma",${['Food', 'Travel', 'Office'][i % 3]},${(i * 13.37).toFixed(2)}`).join('\n') + '\n');
writeFileSync('test/fixtures/sample.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
<rect x="10" y="10" width="380" height="280" rx="20" fill="url(#g)"/>
<circle cx="100" cy="120" r="50" fill="#facc15" stroke="#111827" stroke-width="4"/>
<path d="M200 60 L260 160 L140 160 Z" fill="#16a34a" opacity="0.8"/>
<g transform="translate(280 80) rotate(20)"><rect width="80" height="60" fill="#dc2626"/></g>
<polyline points="40,250 100,200 160,240 220,190" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
<text x="200" y="270" font-family="Arial" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="middle">PDFSherpa SVG</text>
</svg>`);
console.log('ok');
