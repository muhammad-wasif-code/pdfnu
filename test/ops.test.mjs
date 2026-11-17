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

// forms
{
  const { fields, hasXfa } = await ops.formFields(buf('test/fixtures/form.pdf'));
  assert.equal(hasXfa, false);
  const kinds = Object.fromEntries(fields.map((f) => [f.name, f.kind]));
  assert.deepEqual(kinds, { full_name: 'text', 'applicant.email': 'text', address: 'text', agree_terms: 'checkbox', country: 'dropdown', gender: 'radio' });
  assert.ok(fields.every((f) => f.page === 0), 'fields know their page');
  const { bytes, bad } = await ops.fillForm(buf('test/fixtures/form.pdf'), { full_name: 'Ali Khan', 'applicant.email': 'ali@example.com', address: 'House 1\nStreet 2', agree_terms: true, country: 'Pakistan', gender: 'Male' }, false);
  assert.deepEqual(bad, []);
  const re = await ops.formFields(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const vals = Object.fromEntries(re.fields.map((f) => [f.name, f.value]));
  assert.equal(vals.full_name, 'Ali Khan'); assert.equal(vals.agree_terms, true); assert.equal(vals.country, 'Pakistan'); assert.equal(vals.gender, 'Male');
  const urdu = await ops.fillForm(buf('test/fixtures/form.pdf'), { full_name: 'علی' }, false);
  assert.deepEqual(urdu.bad, ['full_name'], 'non-Latin text is reported, not silently mangled');
  const flat = await ops.fillForm(buf('test/fixtures/form.pdf'), { full_name: 'Ali' }, true);
  const ff = await ops.formFields(flat.bytes.buffer.slice(flat.bytes.byteOffset, flat.bytes.byteOffset + flat.bytes.byteLength));
  assert.equal(ff.fields.length, 0, 'flatten removes fields');
  ok('form fields: read, fill, non-Latin report, flatten');
}

// repair (lossless rebuild)
for (const f of ['broken.pdf', 'truncated.pdf']) {
  const r = await ops.rebuild(buf('test/fixtures/' + f));
  assert.equal(r.pages, 3);
  assert.equal((await open(r.bytes)).getPageCount(), 3);
}
ok('rebuild broken startxref + truncated trailer');


// crop (normal + rotated page)
{
  const rot = buf('test/fixtures/rotated.pdf');
  const before = await open(rot.slice(0));
  const sz0 = before.getPages().map((p) => p.getCropBox());
  const out = await ops.cropPdf(rot, before.getPages().map(() => ({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 })));
  const after = await open(out);
  after.getPages().forEach((p, i) => {
    const c = p.getCropBox(), m = p.getMediaBox();
    assert.deepEqual(c, m);
    const r = p.getRotation().angle % 180 !== 0;
    // visual width = 50% of visual width before
    const vw0 = r ? sz0[i].height : sz0[i].width, vw1 = r ? c.height : c.width;
    assert.ok(Math.abs(vw1 - vw0 * 0.5) < 0.5, `page ${i} width ${vw1} vs ${vw0}`);
  });
  const untouched = await open(await ops.cropPdf(small(), [null, { x: 0, y: 0, w: 0.5, h: 1 }]));
  assert.equal(untouched.getPages()[0].getCropBox().width, (await open(small())).getPages()[0].getCropBox().width);
  ok('crop pages (rotation-aware, per page)');
}

// true redaction: redacted page's text is gone from the file, others survive
{
  const { inflateSync } = await import('node:zlib');
  const allText = (u8) => {
    const b = Buffer.from(u8), t = b.toString('latin1'); let m, acc = ''; const re = /stream\r?\n/g;
    while ((m = re.exec(t))) { const st = m.index + m[0].length, en = t.indexOf('endstream', st); const raw = b.subarray(st, en); try { acc += inflateSync(raw).toString('latin1'); } catch { acc += raw.toString('latin1'); } }
    return acc + t;
  };
  const hex = (s) => Buffer.from(s).toString('hex').toUpperCase();
  const orig = allText(new Uint8Array(small()));
  assert.ok(orig.includes(hex('Page 1 line')));
  const jpeg = readFileSync('test/fixtures/signature-photo.jpg');
  const out = await ops.redactPages(small(), [{ index: 0, jpeg: jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength), w: 595, h: 842 }], true);
  const txt = allText(out);
  assert.ok(!txt.includes(hex('Page 1 line')), 'redacted text must not remain');
  assert.ok(txt.includes(hex('Page 2 line')), 'other pages keep text');
  assert.equal((await open(out)).getPageCount(), 3);
  ok('redact: page flattened, original text removed from file');
}

console.log(`\nAll ${n} pdfOps tests passed`);
