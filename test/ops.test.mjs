// Unit tests for src/lib/pdfOps.ts (bundled on the fly with esbuild). Run: node test/ops.test.mjs
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

mkdirSync('test/out', { recursive: true });
await build({ entryPoints: ['src/lib/pdfOps.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'test/out/pdfOps.mjs', external: ['pdf-lib'], logLevel: 'error' });
const ops = await import('../test/out/pdfOps.mjs');
const buf = (f) => { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const small = () => buf('test/fixtures/small.pdf');
const scanned = () => buf('test/fixtures/scanned.pdf');
const open = (u8) => PDFDocument.load(u8);
let n = 0; const ok = (m) => console.log(`✓ ${++n} ${m}`);

// inspect
assert.deepEqual(await ops.inspect(small()), { pageCount: 3, encrypted: false });
assert.equal((await ops.inspect(buf('test/fixtures/encrypted.pdf'))).encrypted, true);
ok('inspect + encryption detection');

// merge
let d = await open(await ops.merge([small(), scanned()]));
assert.equal(d.getPageCount(), 7); ok('merge 3+4 pages');

// extract groups
const groups = await ops.extractGroups(scanned(), [[0, 1], [3]]);
assert.equal(groups.length, 2);
assert.equal((await open(groups[0])).getPageCount(), 2);
assert.equal((await open(groups[1])).getPageCount(), 1); ok('split into groups');

// rearrange: reverse + rotate + delete
d = await open(await ops.rearrange(small(), [{ src: 2, rotate: 90 }, { src: 0, rotate: 270 }]));
assert.equal(d.getPageCount(), 2);
assert.deepEqual(d.getPages().map((p) => p.getRotation().angle), [90, 270]); ok('rearrange/rotate/delete');

// watermark text (all positions incl. tile) + rotated page
const rotated = await ops.rearrange(small(), [{ src: 0, rotate: 90 }]);
for (const position of ['center', 'top-left', 'bottom-right', 'tile']) {
  const out = await ops.watermark(rotated.buffer.slice(0), { kind: 'text', text: 'CONFIDENTIAL ✓ ünï', opacity: 0.3, position, angle: 45, color: '#ff0000' });
  assert.equal((await open(out)).getPageCount(), 1);
}
ok('text watermark (non-WinAnsi chars sanitized, rotated page)');
const png = readFileSync('test/fixtures/image.png');
d = await open(await ops.watermark(small(), { kind: 'image', image: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), imageType: 'png', imageScale: 0.3, opacity: 0.5, position: 'bottom-right', angle: 0 }));
assert.equal(d.getPageCount(), 3); ok('image watermark');

// page numbers
d = await open(await ops.pageNumbers(small(), { position: 'bottom-center', format: 'page-n-of-total', start: 1, fontSize: 11, skipFirst: true }));
assert.equal(d.getPageCount(), 3); ok('page numbers');

// images to pdf
const jpg = readFileSync('test/fixtures/photo-exif6.jpg');
d = await open(await ops.imagesToPdf([{ data: jpg.buffer.slice(jpg.byteOffset, jpg.byteOffset + jpg.byteLength), type: 'jpg', width: 1600, height: 1200 }], { pageSize: 'a4', orientation: 'auto', margin: 18 }));
const [w, h] = [d.getPage(0).getWidth(), d.getPage(0).getHeight()];
assert.ok(w > h, 'landscape image → landscape A4'); ok('images to pdf (auto orientation)');

// stamp (signatures) on normal + rotated page
{
  const sharp = (await import('sharp')).default;
  const pngBuf = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from('<svg width="300" height="100"><path d="M10 80 C 80 10, 150 90, 290 20" stroke="#1d4ed8" stroke-width="8" fill="none"/></svg>') }]).png().toBuffer();
  const png = pngBuf.buffer.slice(pngBuf.byteOffset, pngBuf.byteOffset + pngBuf.byteLength);
  const rot = buf('test/fixtures/rotated.pdf');
  d = await open(await ops.stamp(rot, [{ page: 0, x: 0.6, y: 0.8, w: 0.3, h: 0.1, png }, { page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.07, png }]));
  assert.equal(d.getPageCount(), 2);
  ok('stamp signatures (rotated + normal page, shared image)');
}

// editPdf: text (incl. multi-line + non-WinAnsi), rect, highlight, image on normal + rotated pages
{
  const sizes = await ops.pageSizes(buf('test/fixtures/rotated.pdf'));
  assert.ok(sizes[0].w > sizes[0].h, 'rotated page reports landscape visual size');
  const pngB = readFileSync('test/fixtures/image.png');
  const png = pngB.buffer.slice(pngB.byteOffset, pngB.byteOffset + pngB.byteLength);
  const out = await ops.editPdf(buf('test/fixtures/rotated.pdf'), [
    { type: 'text', page: 0, x: 0.1, y: 0.1, text: 'Hello PDFSherpa\nSecond line ✓', size: 18, color: '#1d4ed8', font: 'helvetica', bold: true },
    { type: 'text', page: 1, x: 0.5, y: 0.5, text: 'Times text', size: 12, color: '#111827', font: 'times', bold: false },
    { type: 'rect', page: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.1, color: '#ffffff', opacity: 1 },
    { type: 'rect', page: 1, x: 0.1, y: 0.2, w: 0.5, h: 0.03, color: '#facc15', opacity: 0.35 },
    { type: 'image', page: 1, x: 0.6, y: 0.7, w: 0.3, h: 0.15, png },
  ]);
  d = await open(out);
  assert.equal(d.getPageCount(), 2);
  ok('editPdf text/rect/highlight/image (+ rotated page, sanitized glyphs)');
}

console.log(`\nAll ${n} pdfOps tests passed`);
