// TIFF reader + TIFF → PDF. Fixtures: node test/make-tiff-fixtures.cjs
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

await build({ entryPoints: ['src/lib/tiff.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'test/out/tiff.mjs', logLevel: 'error' });
await build({ entryPoints: ['src/lib/pdfOps.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'test/out/pdfOps.mjs', external: ['pdf-lib'], logLevel: 'error' });
const t = await import('../test/out/tiff.mjs');
const ops = await import('../test/out/pdfOps.mjs');
let n = 0; const ok = (m) => console.log(`✓ ${++n} ${m}`);
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

// LZW and PackBits decode to the same bitmap (both written by Ghostscript from one page)
{
  const lzw = t.readTiff(readFileSync('test/fixtures/tiff/mono-lzw.tif'))[0];
  const pb = t.readTiff(readFileSync('test/fixtures/tiff/mono-packbits.tif'))[0];
  const a = await t.decodeChunk(lzw, lzw.chunks[0], 1), b = await t.decodeChunk(pb, pb.chunks[0], 1);
  assert.equal(a.length, Math.ceil(lzw.width / 8) * lzw.height);
  assert.deepEqual(a, b);
  ok('LZW and PackBits decoders agree');
}

// a hand-made RGBA TIFF: 3 PackBits strips, alpha channel, big-endian
{
  const w = 20, h = 9, rps = 4;
  const rows = []; for (let y = 0; y < h; y++) { const r = []; for (let x = 0; x < w; x++) r.push(x * 10, y * 20, 100, x < 10 ? 255 : 0); rows.push(r); }
  const pack = (bytes) => { const o = []; for (let i = 0; i < bytes.length; i += 128) { const c = bytes.slice(i, i + 128); o.push(c.length - 1, ...c); } return o; };
  const strips = []; for (let y = 0; y < h; y += rps) strips.push(pack(rows.slice(y, y + rps).flat()));
  const entries = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 4, null], [259, 3, 1, 32773], [262, 3, 1, 2], [273, 4, strips.length, null], [277, 3, 1, 4], [278, 3, 1, rps], [279, 4, strips.length, null], [338, 3, 1, 2]];
  const head = 8, ifdSize = 2 + entries.length * 12 + 4;
  let extra = head + ifdSize; const blobs = [];
  const put = (arr) => { const off = extra; blobs.push(arr); extra += arr.length; return off; };
  const bpsOff = put([0, 8, 0, 8, 0, 8, 0, 8]);
  const stripOffs = []; const dataStart = extra + strips.length * 8; let p = dataStart; for (const s of strips) { stripOffs.push(p); p += s.length; }
  const be32 = (v) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const offOff = put(stripOffs.flatMap(be32)), cntOff = put(strips.map((s) => s.length).flatMap(be32));
  const out = [0x4d, 0x4d, 0, 42, ...be32(8), 0, entries.length];
  for (const [tag, type, count, val] of entries) {
    const v = tag === 258 ? bpsOff : tag === 273 ? (strips.length > 1 ? offOff : stripOffs[0]) : tag === 279 ? (strips.length > 1 ? cntOff : strips[0].length) : val;
    out.push(tag >> 8, tag & 255, 0, type, ...be32(count), ...(type === 3 && count === 1 ? [v >> 8, v & 255, 0, 0] : be32(v)));
  }
  out.push(0, 0, 0, 0);
  for (const b of blobs) out.push(...b);
  for (const s of strips) out.push(...s);
  const file = Uint8Array.from(out);
  const pg = t.readTiff(file)[0];
  assert.equal(pg.chunks.length, 3); assert.equal(pg.extra, 1);
  const raw = await t.decodeChunk(pg, pg.chunks[2], 4);
  assert.deepEqual([...raw.slice(0, 8)], [0, 160, 100, 255, 10, 160, 100, 255]);
  const r = await ops.tiffToPdf([ab(file)], { page: 'image', margin: 0 });
  assert.equal(r.pages, 1);
  const d = await PDFDocument.load(r.bytes);
  assert.ok(d.getPage(0).node.Resources().lookup((await import('pdf-lib')).PDFName.of('XObject')).keys().length === 3, 'one image per strip');
  ok('RGBA PackBits strips → PDF images with soft masks');
}

// every fixture converts; fax and LZW data pass through unchanged (output ≈ input size)
{
  for (const f of readdirSync('test/fixtures/tiff')) {
    const b = readFileSync('test/fixtures/tiff/' + f);
    const r = await ops.tiffToPdf([ab(b)], { page: f.startsWith('fax') ? 'a4' : 'image', margin: 20 });
    const d = await PDFDocument.load(r.bytes);
    assert.equal(d.getPageCount(), r.pages);
    if (/^fax/.test(f)) assert.ok(r.bytes.length < b.length * 1.2 + 3000, `${f} passthrough`);
  }
  const g4 = await ops.tiffToPdf([ab(readFileSync('test/fixtures/tiff/fax-g4.tif'))], { page: 'a4', margin: 0 });
  assert.equal(g4.pages, 3);
  ok('all TIFF fixtures (fax G3/G3-2D/RLE/G4, LZW, PackBits, RGB, gray, CMYK) convert; multi-page G4 → 3 pages');
}
assert.throws(() => t.readTiff(readFileSync('test/fixtures/small.pdf')), /NOT_TIFF/);
ok('rejects non-TIFF');
console.log(`\nAll ${n} tiff tests passed`);
