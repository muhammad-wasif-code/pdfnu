// Unit tests for src/lib/pdfOps.ts (bundled on the fly with esbuild). Run: node test/ops.test.mjs
import { build } from 'esbuild';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';

mkdirSync('test/out', { recursive: true });
await build({ entryPoints: ['src/lib/pdfOps.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'test/out/pdfOps.mjs', external: ['pdf-lib'], logLevel: 'error' });
const ops = await import('../test/out/pdfOps.mjs');
// multilingual text engine: read fonts from public/vendor (run scripts/copy-vendor.mjs first)
ops.setFontFetcher(async (url) => { const f = 'public' + url; return existsSync(f) ? new Uint8Array(readFileSync(f)) : null; });
// font names (/BaseFont) and raw marker search inside a PDF, including compressed object streams
const has = async (u8, s) => {
  const { PDFName, PDFDict, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const d = await PDFDocument.load(u8, { updateMetadata: false });
  for (const [, obj] of d.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && String(obj.get(PDFName.of('BaseFont')) ?? '').includes(s)) return true;
    if (obj instanceof PDFRawStream) { try { if (Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1').includes(s)) return true; } catch {} }
  }
  return Buffer.from(u8).toString('latin1').includes(s);
};
const buf = (f) => { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const small = () => buf('test/fixtures/small.pdf');
const scanned = () => buf('test/fixtures/scanned.pdf');
const open = (u8) => PDFDocument.load(u8);
let n = 0; const ok = (m) => console.log(`✓ ${++n} ${m}`);

// inspect
assert.deepEqual(await ops.inspect(small()), { pageCount: 3, encrypted: false });
assert.equal((await ops.inspect(buf('test/fixtures/encrypted.pdf'))).encrypted, true);
ok('inspect + encryption detection');

// Adobe-style owner-locked form PDF (opens without a password) — same class iLovePDF accepts
{
  const raw = buf('test/fixtures/block-form-encrypted.pdf');
  assert.equal((await ops.inspect(raw)).encrypted, true);
  const d = await ops.decrypt(raw, '');
  assert.equal(d.status, 'ok');
  const plain = d.bytes.buffer.slice(d.bytes.byteOffset, d.bytes.byteOffset + d.bytes.byteLength);
  assert.equal((await ops.inspect(plain)).encrypted, false);
  const { fields } = await ops.formFields(plain);
  assert.ok(fields.length > 10, 'AcroForm fields survive decrypt');
  assert.ok((await ops.lossless(plain)).length < plain.byteLength * 1.05, 'lossless after decrypt');
}
ok('decrypt owner-restricted Adobe form PDF');

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
const wmUr = await ops.watermark(small(), { kind: 'text', text: 'خفیہ دستاویز', opacity: 0.3, position: 'center', angle: 45, color: '#ff0000' });
assert.equal((await open(wmUr)).getPageCount(), 3);
assert.ok(await has(wmUr, 'NotoNaskhArabic'), 'Urdu watermark embeds the Naskh font');
ok('text watermark: Latin, symbols, Urdu (rotated page)');
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
    { type: 'text', page: 1, x: 0.1, y: 0.8, text: 'میرا نام علی ہے\nमेरा नाम अली है', size: 14, color: '#111827', font: 'helvetica', bold: false },
    { type: 'rect', page: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.1, color: '#ffffff', opacity: 1 },
    { type: 'rect', page: 1, x: 0.1, y: 0.2, w: 0.5, h: 0.03, color: '#facc15', opacity: 0.35 },
    { type: 'image', page: 1, x: 0.6, y: 0.7, w: 0.3, h: 0.15, png },
  ]);
  d = await open(out);
  assert.equal(d.getPageCount(), 2);
  assert.ok(await has(out, 'NotoNaskhArabic') && await has(out, 'NotoSansDevanagari'), 'Urdu + Hindi edit text');
  ok('editPdf text/rect/highlight/image (+ rotated page, symbols, Urdu, Hindi)');
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
  const urdu = await ops.fillForm(buf('test/fixtures/form.pdf'), { full_name: 'علی خان', address: 'मकान 1\nगली 2' }, false);
  assert.deepEqual(urdu.bad, [], 'Urdu and Hindi values are filled');
  assert.ok(await has(urdu.bytes, 'NotoNaskhArabic') && await has(urdu.bytes, 'NotoSansDevanagari'), 'appearances use script fonts');
  const urVals = Object.fromEntries((await ops.formFields(urdu.bytes.buffer.slice(urdu.bytes.byteOffset, urdu.bytes.byteOffset + urdu.bytes.byteLength))).fields.map((f) => [f.name, f.value]));
  assert.equal(urVals.full_name, 'علی خان', 'field value kept as Unicode');
  const urFlat = await ops.fillForm(buf('test/fixtures/form.pdf'), { full_name: 'علی خان' }, true);
  assert.ok(await has(urFlat.bytes, 'NotoNaskhArabic'), 'flattened Urdu keeps its font');
  const flat = await ops.fillForm(buf('test/fixtures/form.pdf'), { full_name: 'Ali' }, true);
  const ff = await ops.formFields(flat.bytes.buffer.slice(flat.bytes.byteOffset, flat.bytes.byteOffset + flat.bytes.byteLength));
  assert.equal(ff.fields.length, 0, 'flatten removes fields');
  ok('form fields: read, fill (Latin, Urdu, Hindi), flatten');
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

// resize page size: what you see on screen is preserved (rotated pages come out with Rotate 0), text stays text
{
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const dirs = async (bytes) => {
    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const res = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const it = (await page.getTextContent()).items.find((i) => i.str.trim());
      const t = pdfjs.Util.transform(vp.transform, it.transform);
      res.push([Math.sign(Math.round(t[0])), Math.sign(Math.round(t[1]))]); // on-screen text direction
    }
    return res;
  };
  const input = buf('test/fixtures/rotated.pdf');
  const before = await dirs(new Uint8Array(input.slice(0)));
  const out = await ops.resizePages(input, { size: 'a4', orientation: 'auto', margin: 0 });
  const d2 = await open(out.slice());
  d2.getPages().forEach((p) => assert.equal(p.getRotation().angle, 0));
  assert.deepEqual(await dirs(out), before, 'on-screen text direction unchanged');
  const letter = await open(await ops.resizePages(small(), { size: 'letter', orientation: 'portrait', margin: 18 }));
  assert.deepEqual([Math.round(letter.getPage(0).getWidth()), Math.round(letter.getPage(0).getHeight())], [612, 792]);
  ok('resize pages (A4/Letter, rotation-aware, text selectable)');
}

// flatten: form fields and an annotation with an appearance stream become page content
{
  const { PDFDocument: PD, PDFName: N, rgb: RGB } = await import('pdf-lib');
  const src = await PD.load(buf('test/fixtures/form.pdf'));
  const page = src.getPage(0);
  const ap = src.context.formXObject([], { BBox: [0, 0, 100, 20] });
  const apRef = src.context.register(ap);
  const annot = src.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [50, 50, 150, 70], AP: { N: apRef } });
  page.node.addAnnot(src.context.register(annot));
  const input = await src.save();
  const r = await ops.flattenPdf(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), { forms: true, annotations: true });
  assert.ok(r.fields > 0, 'had fields'); assert.equal(r.annots, 1);
  const f2 = await open(r.bytes);
  assert.equal(f2.getForm().getFields().length, 0, 'no fields left');
  assert.ok(!f2.getPage(0).node.Annots(), 'annotations removed from page');
  ok('flatten forms + annotations');
}

// header & footer tokens
{
  const out = await ops.headerFooter(small(), { header: ['[file]', '', 'Confidential'], footer: ['', 'Page [page] of [pages]', '[date]'], fontSize: 9, color: '#333333', start: 1, skipFirst: false, fileName: 'report.pdf', date: '2026-11-19' });
  const { inflateSync } = await import('node:zlib');
  const b = Buffer.from(out), t = b.toString('latin1'); let m, acc = ''; const re = /stream\r?\n/g;
  while ((m = re.exec(t))) { const st = m.index + m[0].length, en = t.indexOf('endstream', st); try { acc += inflateSync(b.subarray(st, en)).toString('latin1'); } catch {} }
  const hex = (x) => Buffer.from(x).toString('hex').toUpperCase();
  for (const want of ['Page 2 of 3', 'Confidential', 'report.pdf', '2026-11-19']) assert.ok(acc.includes(hex(want)), want);
  const ur = await ops.headerFooter(small(), { header: ['رپورٹ [page]', '', ''], footer: ['', 'पृष्ठ [page] / [pages]', ''], fontSize: 9, color: '#333333', start: 1, skipFirst: false, fileName: 'r.pdf', date: '' });
  assert.ok(await has(ur, 'NotoNaskhArabic') && await has(ur, 'NotoSansDevanagari'), 'Urdu + Hindi header/footer fonts');
  ok('header & footer with [page]/[pages]/[date]/[file], Urdu and Hindi');
}

// searchable PDF: invisible OCR text is extractable and sits over its box
{
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const jpeg = readFileSync('test/fixtures/signature-photo.jpg');
  const out = await ops.searchablePdf([{ jpeg: jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength), w: 300, h: 200, imgW: 600, imgH: 400,
    words: [{ text: 'Invoice', x0: 40, y0: 40, x1: 200, y1: 80 }, { text: 'Total', x0: 40, y0: 300, x1: 140, y1: 340 }] }]);
  const doc = await pdfjs.getDocument({ data: out, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const items = (await page.getTextContent()).items.filter((i) => i.str.trim());
  assert.deepEqual(items.map((i) => i.str), ['Invoice', 'Total']);
  const inv = items[0];
  assert.ok(Math.abs(inv.transform[4] - 20) < 1, 'x at box left (40px → 20pt)');
  assert.ok(Math.abs(inv.width - 80) < 3, `width matches box (${inv.width})`);
  const ur = await ops.searchablePdf([{ jpeg: jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength), w: 300, h: 200, imgW: 600, imgH: 400,
    words: [{ text: 'رسید', x0: 300, y0: 40, x1: 500, y1: 80 }, { text: 'कुल', x0: 40, y0: 300, x1: 140, y1: 340 }] }]);
  assert.ok(await has(ur, 'NotoNaskhArabic') && await has(ur, 'NotoSansDevanagari') && await has(ur, '/ActualText'), 'Urdu/Hindi invisible layer');
  ok('searchable PDF: invisible text layer over words (English, Urdu, Hindi)');
}


// alternate merge: fronts + backs (backs reversed), and single-file mode
{
  const fronts = await PDFDocument.create(); for (let i = 0; i < 3; i++) fronts.addPage([100 + i, 100]);
  const backs = await PDFDocument.create(); for (let i = 0; i < 3; i++) backs.addPage([200 + i, 100]);
  const fb = await fronts.save(), bb = await backs.save();
  let r = await open(await ops.alternateMerge(fb.buffer.slice(0), bb.buffer.slice(0), true));
  assert.deepEqual(r.getPages().map((p) => p.getWidth()), [100, 202, 101, 201, 102, 200]);
  r = await open(await ops.alternateMerge(fb.buffer.slice(0), bb.buffer.slice(0), false));
  assert.deepEqual(r.getPages().map((p) => p.getWidth()), [100, 200, 101, 201, 102, 202]);
  const one = await PDFDocument.create(); for (let i = 0; i < 4; i++) one.addPage([10 + i, 100]);
  r = await open(await ops.alternateMerge((await one.save()).buffer.slice(0), null, true));
  assert.deepEqual(r.getPages().map((p) => p.getWidth()), [10, 13, 11, 12]);
  ok('alternate merge (two files, reversed backs, single file)');
}

// insert blank pages
{
  const src = await PDFDocument.create(); src.addPage([600, 400]); src.addPage([300, 500]);
  const { bytes, added } = await ops.insertBlankPages((await src.save()).buffer.slice(0), [{ after: -1, count: 1 }, { after: 0, count: 2 }], 'match');
  const r = await open(bytes);
  assert.equal(added, 3);
  assert.deepEqual(r.getPages().map((p) => [p.getWidth(), p.getHeight()]), [[600, 400], [600, 400], [600, 400], [600, 400], [300, 500]]);
  const a4 = await open((await ops.insertBlankPages((await src.save()).buffer.slice(0), [{ after: 1, count: 1 }], 'a4')).bytes);
  assert.equal(Math.round(a4.getPage(2).getHeight()), 842);
  ok('insert blank pages (match size, A4)');
}

// metadata read / write / clear
{
  const m0 = await ops.readMetadata(small());
  const edited = await ops.writeMetadata(small(), { title: 'Quarterly report', author: 'A. Writer', subject: 'Sales', keywords: 'sales, q3', creator: '', producer: 'PDFSherpa', created: '2024-05-01T10:00:00.000Z', modified: null });
  const m1 = await ops.readMetadata(edited.buffer.slice(edited.byteOffset, edited.byteOffset + edited.byteLength));
  assert.equal(m1.title, 'Quarterly report'); assert.equal(m1.author, 'A. Writer'); assert.equal(m1.keywords, 'sales q3');
  assert.equal(m1.creator, ''); assert.equal(m1.created, '2024-05-01T10:00:00.000Z'); assert.equal(m1.modified, null); assert.equal(m1.hasXmp, false);
  assert.ok(typeof m0.title === 'string');
  ok('metadata edit + clear');
}

// stamps, placed images, annotations
{
  const st = await open(await ops.stampPdf(buf('test/fixtures/rotated.pdf'), [{ page: 0, cx: 0.5, cy: 0.3, w: 0.4, text: 'APPROVED', sub: '27 Nov 2026', color: '#16a34a', angle: -12, opacity: 0.9, shape: 'round' }, { page: 1, cx: 0.5, cy: 0.5, w: 0.3, text: 'منظور', sub: '', color: '#dc2626', angle: 0, opacity: 1, shape: 'oval' }]));
  assert.ok(st.getPageCount() >= 2);
  const png = buf('test/fixtures/image.png');
  const pi = await open(await ops.placeImages(small(), [{ pages: [0, 1, 2], x: 0.8, y: 0.02, w: 0.15, h: 0.05, png, opacity: 0.5 }]));
  assert.equal(pi.getPageCount(), 3);
  const an = await open(await ops.annotatePdf(small(), [
    { kind: 'highlight', page: 0, color: '#facc15', quads: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.02 }], note: 'check this' },
    { kind: 'underline', page: 0, color: '#2563eb', quads: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }] },
    { kind: 'strike', page: 0, color: '#dc2626', quads: [{ x: 0.1, y: 0.25, w: 0.3, h: 0.02 }] },
    { kind: 'ink', page: 1, color: '#dc2626', width: 2, paths: [[[0.1, 0.1], [0.2, 0.15], [0.3, 0.1]]] },
    { kind: 'square', page: 1, color: '#2563eb', width: 2, x: 0.4, y: 0.4, w: 0.2, h: 0.1 },
    { kind: 'circle', page: 1, color: '#2563eb', width: 2, x: 0.4, y: 0.6, w: 0.2, h: 0.1 },
    { kind: 'arrow', page: 1, color: '#111827', width: 2, x1: 0.1, y1: 0.8, x2: 0.4, y2: 0.7 },
    { kind: 'text', page: 2, color: '#111827', size: 12, x: 0.1, y: 0.1, w: 0.4, h: 0.1, text: 'Hello\nآپ کا شکریہ' },
    { kind: 'note', page: 2, color: '#facc15', x: 0.8, y: 0.1, text: 'Please sign here' },
  ], 'Reviewer'));
  const subs = an.getPages().flatMap((p) => { const a = p.node.Annots(); return a ? a.asArray().map((r) => String(an.context.lookup(r).get(PDFName.of('Subtype')))) : []; });
  assert.deepEqual(subs, ['/Highlight', '/Underline', '/StrikeOut', '/Ink', '/Square', '/Circle', '/Line', '/FreeText', '/Text']);
  ok('stamps, image placement on every page, 9 annotation types');
}


// N-up, booklet
{
  const r = await open(await ops.nUp(scanned(), { perSheet: 4, sheet: 'a4', orientation: 'auto', order: 'across', margin: 18, gap: 8, border: true }));
  assert.equal(r.getPageCount(), 1);
  const r2 = await open(await ops.nUp(small(), { perSheet: 2, sheet: 'a4', orientation: 'auto', order: 'across', margin: 18, gap: 8, border: false }));
  assert.equal(r2.getPageCount(), 2); assert.ok(r2.getPage(0).getWidth() > r2.getPage(0).getHeight(), '2-up is landscape');
  assert.deepEqual(ops.bookletOrder(8), [[7, 0], [1, 6], [5, 2], [3, 4]]);
  assert.deepEqual(ops.bookletOrder(5), [[-1, 0], [1, -1], [-1, 2], [3, 4]]);
  assert.deepEqual(ops.bookletOrder(4, true), [[0, 3], [2, 1]]);
  const b = await open(await ops.booklet(buf('test/fixtures/rotated.pdf'), { sheet: 'a4', rtl: false, margin: 10, creep: 0 }));
  assert.equal(b.getPageCount() % 2, 0);
  ok('N-up 4/2 per sheet, booklet order (LTR, RTL, padding)');
}

// split by size
{
  const parts = await ops.splitBySize(scanned(), 3_000_000);
  assert.ok(parts.length >= 2);
  assert.equal(parts.reduce((t, p) => t + (p.last - p.first + 1), 0), 4);
  for (const p of parts) assert.ok(p.bytes.length <= 3_000_000 || (p.first === p.last && p.tooBig));
  ok(`split by size: ${parts.length} parts under 3 MB`);
}

// bookmarks
{
  const out = await ops.writeBookmarks(small(), [{ title: 'Intro', page: 0, level: 0 }, { title: 'Détails – ٹیسٹ', page: 1, level: 1 }, { title: 'End', page: 2, level: 0 }], 2);
  const d2 = await open(out);
  const outl = d2.catalog.lookup(PDFName.of('Outlines'));
  assert.equal(outl.lookup(PDFName.of('Count')).asNumber(), 3);
  const first = outl.lookup(PDFName.of('First'));
  assert.equal(first.lookup(PDFName.of('Title')).decodeText(), 'Intro');
  assert.equal(first.lookup(PDFName.of('First')).lookup(PDFName.of('Title')).decodeText(), 'Détails – ٹیسٹ');
  const none = await open(await ops.writeBookmarks(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), [], 1));
  assert.equal(none.catalog.get(PDFName.of('Outlines')), undefined);
  ok('bookmarks: nested outline, unicode titles, clear');
}

// colours, annotations, content rotation
{
  for (const u8 of [await ops.invertColors(small(), null), await ops.pageBackground(small(), '#fef3c7', 'multiply', [0]), await ops.pageBackground(small(), '#fef3c7', 'behind', null), await ops.rotateContent(scanned(), [1.5, null, -2, 0])]) {
    assert.ok((await open(u8)).getPageCount() >= 3);
  }
  const inv = await open(await ops.invertColors(small(), null));
  const gsDict = inv.getPage(0).node.Resources().lookup(PDFName.of('ExtGState'));
  assert.ok(gsDict.values().some((v) => String(inv.context.lookup(v).get(PDFName.of('BM'))) === '/Difference'), 'difference blend layer');
  const annotated = await ops.annotatePdf(small(), [
    { kind: 'highlight', page: 0, color: '#facc15', quads: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.02 }] },
    { kind: 'ink', page: 1, color: '#dc2626', width: 2, paths: [[[0.1, 0.1], [0.2, 0.15]]] },
    { kind: 'note', page: 2, color: '#facc15', x: 0.8, y: 0.1, text: 'hi' },
  ], '');
  const ab = annotated.buffer.slice(annotated.byteOffset, annotated.byteOffset + annotated.byteLength);
  const sum = await ops.annotationSummary(ab);
  assert.equal(sum.comments, 2); assert.equal(sum.drawings, 1);
  const { bytes, removed } = await ops.removeAnnotations(ab, ['comments']);
  assert.equal(removed, 2);
  const left = await ops.annotationSummary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(left.comments, 0); assert.equal(left.drawings, 1);
  const form = await ops.removeAnnotations(buf('test/fixtures/form.pdf'), ['forms']);
  assert.ok(form.removed > 0); assert.equal((await open(form.bytes)).catalog.get(PDFName.of('AcroForm')), undefined);
  ok('invert, paper colour, content rotation, annotation summary/removal (comments, forms)');
}

// skew detection (synthetic page with lines tilted 2.5°)
{
  await build({ entryPoints: ['src/lib/deskew.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'test/out/deskew.mjs', logLevel: 'error' });
  const { detectSkew } = await import('../test/out/deskew.mjs');
  const w = 800, h = 1000, g = new Uint8Array(w * h).fill(245);
  const t = Math.tan((2.5 * Math.PI) / 180);
  for (let line = 0; line < 30; line++) for (let x = 60; x < 740; x++) { if ((x >> 3) % 4 === 3) continue; const y0 = Math.round(80 + line * 28 + x * t); for (let dy = 0; dy < 8; dy++) if (y0 + dy < h) g[(y0 + dy) * w + x] = 20; }
  const a = detectSkew(g, w, h);
  assert.ok(Math.abs(a - 2.5) < 0.15, `detected ${a}`);
  assert.equal(detectSkew(new Uint8Array(w * h).fill(250), w, h), null);
  ok(`skew detection (${a}°), blank page → null`);
}


// links
{
  const { bytes, added } = await ops.addLinks(buf('test/fixtures/rotated.pdf'), [{ page: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.05, url: 'pdfsherpa.com' }, { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.05, toPage: 0 }, { page: 0, x: 0, y: 0, w: 0.1, h: 0.1, url: 'a@b.co' }, { page: 0, x: 0, y: 0, w: 0.1, h: 0.1 }]);
  assert.equal(added, 3);
  const d2 = await open(bytes);
  const a0 = d2.getPage(0).node.Annots().asArray().map((r) => d2.context.lookup(r));
  assert.equal(a0[0].lookup(PDFName.of('A')).lookup(PDFName.of('URI')).decodeText(), 'https://pdfsherpa.com');
  assert.equal(a0[1].lookup(PDFName.of('A')).lookup(PDFName.of('URI')).decodeText(), 'mailto:a@b.co');
  assert.ok(d2.getPage(1).node.Annots().size() === 1);
  ok('links: web, e-mail, jump to page; empty link skipped');
}


// overlay, split halves, poster
{
  const ov = await open(await ops.overlayPdf(small(), buf('test/fixtures/invoice.pdf'), { layer: 'under', pages: 'all', repeat: 'first', opacity: 1, fit: 'stretch' }));
  assert.equal(ov.getPageCount(), 3);
  const ov2 = await open(await ops.overlayPdf(buf('test/fixtures/rotated.pdf'), small(), { layer: 'over', pages: 'first', repeat: 'cycle', opacity: 0.5, fit: 'fit' }));
  assert.equal(ov2.getPageCount(), 2);
  const land = await PDFDocument.create(); land.addPage([842, 595]); land.addPage([595, 842]);
  const halves = await open(await ops.splitHalves((await land.save()).buffer.slice(0), { direction: 'auto', rtl: false, skipFirst: false, skipLast: false }));
  assert.equal(halves.getPageCount(), 4);
  assert.deepEqual(halves.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]), [[421, 595], [421, 595], [595, 421], [595, 421]]);
  const rtl = await open(await ops.splitHalves((await land.save()).buffer.slice(0), { direction: 'vertical', rtl: true, skipFirst: false, skipLast: true }));
  assert.equal(Math.round(rtl.getPage(0).getCropBox().x), 421); assert.equal(rtl.getPageCount(), 3);
  const poster = await ops.posterPdf(small(), { page: 0, sheet: 'a4', across: 2, landscape: false, overlap: 20, marks: true });
  assert.ok(poster.sheets >= 4 && poster.down >= 2);
  assert.equal((await open(poster.bytes)).getPageCount(), poster.sheets);
  ok(`overlay under/over, split halves (auto, RTL, keep last), poster ${poster.sheets} sheets ≈ ${poster.sizeCm.map((v) => v.toFixed(0)).join('×')} cm`);
}

console.log(`\nAll ${n} pdfOps tests passed`);
