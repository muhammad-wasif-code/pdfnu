// Tests for src/lib/pptxToPdf.ts. Run: node test/pptx.test.mjs  (fixture: node test/make-pptx-fixture.mjs)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

mkdirSync('test/out', { recursive: true });
await build({ entryPoints: ['src/lib/pptxToPdf.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'test/out/pptxToPdf.mjs', external: ['pdf-lib', 'jszip', '@pdf-lib/fontkit', 'regenerator-runtime'], logLevel: 'error', define: { 'import.meta.env': '{}' } });
const { pptxToPdf } = await import('../test/out/pptxToPdf.mjs');
const fetchFont = async (url) => { const f = 'public' + url; return existsSync(f) ? new Uint8Array(readFileSync(f)) : null; };
let n = 0; const ok = (m) => console.log(`✓ ${++n} ${m}`);

const src = readFileSync('test/fixtures/sample.pptx');
const res = await pptxToPdf(src, { fetchFont, title: 'sample' });
writeFileSync('test/out/sample-pptx.pdf', res.pdf);
const d = await PDFDocument.load(res.pdf);
assert.equal(res.slides, 4); assert.equal(res.hiddenSkipped, 1); assert.equal(d.getPageCount(), 4);
assert.equal(Math.round(d.getPage(0).getWidth()), 960); assert.equal(Math.round(d.getPage(0).getHeight()), 540);
assert.equal(res.missingGlyphs, 0);
ok(`4 slides (hidden skipped), 16:9 page size, ${res.skippedObjects} skipped objects`);
const all = await pptxToPdf(src, { fetchFont, includeHidden: true });
assert.equal(all.slides, 5); ok('hidden slides included on request');
await assert.rejects(() => pptxToPdf(readFileSync('test/fixtures/sample.docx'), { fetchFont }), /NOT_PPTX/); ok('rejects non-PowerPoint files');
console.log(`\nAll ${n} pptx tests passed`);
