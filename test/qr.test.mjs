// QR encoder + decoder round trips. Run: node test/qr.test.mjs
import { build } from 'esbuild';
import assert from 'node:assert/strict';
await build({ entryPoints: ['src/lib/qr.ts', 'src/lib/qrDecode.ts'], bundle: true, format: 'esm', platform: 'node', outdir: 'test/out/qr', logLevel: 'error' });
const { encodeQr, rsEncode } = await import('../test/out/qr/qr.js');
const { decodeQr } = await import('../test/out/qr/qrDecode.js');
let n = 0; const ok = (m) => console.log(`✓ ${++n} ${m}`);

// Reed–Solomon reference: "HELLO WORLD" 1-Q (thonky.com tutorial)
assert.deepEqual(rsEncode([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236], 13), [168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
ok('Reed–Solomon matches the reference codewords');
const q0 = encodeQr('HELLO WORLD', { ecc: 'Q' });
assert.equal(q0.version, 1);
ok('HELLO WORLD → version 1-Q');
// alignment pattern centres from the specification (Annex E)
const { alignmentCenters, versionBits } = await import('../test/out/qr/qr.js');
assert.deepEqual(alignmentCenters(7), [6, 22, 38]); assert.deepEqual(alignmentCenters(12), [6, 32, 58]); assert.deepEqual(alignmentCenters(14), [6, 26, 46, 66]);
assert.deepEqual(alignmentCenters(28), [6, 26, 50, 74, 98, 122]); assert.deepEqual(alignmentCenters(32), [6, 34, 60, 86, 112, 138]); assert.deepEqual(alignmentCenters(40), [6, 30, 58, 86, 114, 142, 170]);
assert.equal(versionBits(7), 0x07c94); assert.equal(versionBits(40), 0x28c69);
ok('alignment positions and version bits match the specification tables');

/** Render a code to RGBA with a quiet zone, optionally rotated (deg) and with a perspective squeeze. */
function render(q, scale, deg = 0, squeeze = 0, noise = 0) {
  const quiet = 4, N = (q.size + quiet * 2) * scale;
  const W = Math.round(N * 1.5), H = W;
  const img = new Uint8ClampedArray(W * H * 4).fill(255);
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // inverse map: output pixel → code space
    let u = (x - W / 2), v = (y - H / 2);
    const uu = c * u + s * v, vv = -s * u + c * v;
    const k = 1 + squeeze * (vv / N); // true perspective (camera tilted): projective map
    const mx = Math.floor((uu / k + N / 2) / scale) - quiet, my = Math.floor((vv / k + N / 2) / scale) - quiet;
    let dark = mx >= 0 && my >= 0 && mx < q.size && my < q.size && q.modules[my * q.size + mx];
    let val = dark ? 20 : 235;
    if (noise) val += (rnd() - 0.5) * noise;
    const p = (y * W + x) * 4; img[p] = img[p + 1] = img[p + 2] = val;
  }
  return { img, W, H };
}

const cases = [
  ['https://pdfsherpa.com', 'M'], ['0123456789012345', 'L'], ['HELLO WORLD 123', 'H'],
  ['آپ کا شکریہ – Urdu & emoji 🎉', 'Q'], ['WIFI:T:WPA;S:Home Net;P:pa55w0rd;;', 'M'],
  ['x'.repeat(300), 'L'], ['Long text '.repeat(60), 'M'],
];
for (const [text, ecc] of cases) {
  const q = encodeQr(text, { ecc });
  const { img, W, H } = render(q, q.size > 80 ? 3 : 5);
  assert.equal(decodeQr(img, W, H), text, `${ecc} v${q.version}`);
}
ok(`round trip: ${cases.length} codes, versions ${encodeQr(cases[0][0]).version}–${encodeQr(cases[6][0], { ecc: 'M' }).version}, all ECC levels, UTF-8`);

for (const deg of [12, 90, 180, 237]) { const q = encodeQr('Rotated code ' + deg, { ecc: 'M' }); const { img, W, H } = render(q, 6, deg); assert.equal(decodeQr(img, W, H), 'Rotated code ' + deg, `rotation ${deg}`); }
ok('rotated codes (12°, 90°, 180°, 237°)');
{ const q = encodeQr('Perspective test https://example.com/abc', { ecc: 'M' }); const { img, W, H } = render(q, 6, 5, 0.35, 40); assert.equal(decodeQr(img, W, H), 'Perspective test https://example.com/abc'); }
ok('perspective + noise');
{ // damage: flip 6% of modules in the data area of an H code
  const q = encodeQr('Damaged but readable', { ecc: 'H' });
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < q.modules.length; i++) { const x = i % q.size, y = (i / q.size) | 0; if (x > 9 && y > 9 && rnd() < 0.06) q.modules[i] ^= 1; }
  const { img, W, H } = render(q, 6); assert.equal(decodeQr(img, W, H), 'Damaged but readable');
}
ok('error correction repairs damaged modules');
{ const q = encodeQr('inverted'); const { img, W, H } = render(q, 6); for (let i = 0; i < img.length; i += 4) { img[i] = img[i + 1] = img[i + 2] = 255 - img[i]; } assert.equal(decodeQr(img, W, H), 'inverted'); }
ok('light-on-dark (inverted) code');
assert.equal(decodeQr(new Uint8ClampedArray(200 * 200 * 4).fill(255), 200, 200), null);
ok('blank image → null');
console.log(`\nAll ${n} qr tests passed`);
