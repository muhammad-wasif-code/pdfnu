// Metadata reading and lossless removal. Run: node test/exif.test.mjs
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
await build({ entryPoints: ['src/lib/exif.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'test/out/exif.mjs', logLevel: 'error' });
const { readMeta, stripMeta } = await import('../test/out/exif.mjs');
let n = 0; const ok = (m) => console.log(`✓ ${++n} ${m}`);

const jpg = new Uint8Array(readFileSync('test/fixtures/photo-exif6.jpg'));
const m = readMeta(jpg);
assert.equal(m.format, 'jpeg'); assert.equal(m.hasExif, true); assert.equal(m.orientation, 6);
ok(`JPEG: EXIF read (orientation ${m.orientation}, ${m.fields.length} fields)`);
const s = stripMeta(jpg, true);
const m2 = readMeta(s);
assert.equal(m2.orientation, 6, 'orientation kept'); assert.equal(m2.fields.length, 0); assert.equal(m2.gps, null);
// image data (from SOS on) is byte-identical: nothing re-compressed
const sos = (b) => { for (let i = 2; i < b.length - 1; i++) if (b[i] === 0xff && b[i + 1] === 0xda) return Buffer.from(b.subarray(i)); };
assert.ok(sos(jpg).equals(sos(s)), 'scan data unchanged');
ok('JPEG stripped losslessly, orientation kept');

// PNG with a text chunk and a time chunk
const png = new Uint8Array(readFileSync('test/fixtures/image.png'));
const crc = (bytes) => { let c, crc = 0xffffffff; for (const b of bytes) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc([...t, ...data])); return Buffer.concat([len, t, Buffer.from(data), c]); };
const withText = Buffer.concat([Buffer.from(png.subarray(0, 33)), chunk('tEXt', Buffer.from('Author\0Secret Person', 'latin1')), chunk('tIME', Buffer.from([7, 234, 11, 27, 10, 0, 0])), Buffer.from(png.subarray(33))]);
const pm = readMeta(new Uint8Array(withText));
assert.ok(pm.fields.some(([k, v]) => k === 'Author' && v === 'Secret Person'));
const ps = stripMeta(new Uint8Array(withText), true);
assert.equal(readMeta(ps).fields.length, 0); assert.equal(ps.length, png.length);
ok('PNG text and time chunks removed');
// DPI
await build({ entryPoints: ['src/lib/dpi.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'test/out/dpi.mjs', logLevel: 'error' });
const { readDpi, setDpi } = await import('../test/out/dpi.mjs');
for (const [name, bytes] of [['jpeg', jpg], ['png', png]]) {
  const out = setDpi(bytes, 300);
  assert.equal(readDpi(out), 300, name);
  assert.equal(readDpi(setDpi(out, 96)), 96, name + ' twice');
}
// pixels untouched: JPEG scan data identical
assert.ok(sos(jpg).equals(sos(setDpi(jpg, 300))));
ok('DPI set on JPEG (JFIF added/updated, EXIF resolution) and PNG (pHYs), pixels unchanged');
console.log(`\nAll ${n} exif tests passed`);
