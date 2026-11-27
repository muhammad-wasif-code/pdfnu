// GIF encoder and raster→SVG tracer (pure functions). Run: node test/image.test.mjs
import { build } from 'esbuild';
import assert from 'node:assert/strict';
await build({ entryPoints: ['src/lib/gif.ts', 'src/lib/trace.ts'], bundle: true, format: 'esm', platform: 'node', outdir: 'test/out/img', logLevel: 'error' });
const { encodeGif, palette } = await import('../test/out/img/gif.js');
const { traceToSvg } = await import('../test/out/img/trace.js');
let n = 0; const ok = (m) => console.log(`✓ ${++n} ${m}`);

// synthetic image: white with a red disc and a blue square with a hole
const w = 120, h = 80, img = new Uint8ClampedArray(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const p = (y * w + x) * 4;
  let c = [255, 255, 255];
  if ((x - 30) ** 2 + (y - 40) ** 2 < 400) c = [220, 30, 30];
  if (x >= 70 && x < 110 && y >= 20 && y < 60 && !(x >= 85 && x < 95 && y >= 35 && y < 45)) c = [30, 60, 220];
  img.set([...c, 255], p);
}
const pal = palette([img], 8);
assert.ok(pal.length / 3 >= 3);
ok(`median-cut palette (${pal.length / 3} colours)`);

const gif = encodeGif([{ data: img, delay: 500 }, { data: img.map((v, i) => (i % 4 === 3 ? 255 : 255 - v)), delay: 500 }], w, h, { loop: 0, dither: false, transparent: false });
assert.equal(String.fromCharCode(...gif.slice(0, 6)), 'GIF89a');
assert.equal(gif[gif.length - 1], 0x3b);
assert.equal(gif[6] | (gif[7] << 8), w);
assert.ok(Buffer.from(gif).includes(Buffer.from('NETSCAPE2.0')));
ok(`animated GIF structure (${gif.length} bytes, 2 frames, looping)`);

const t = traceToSvg(img, w, h, { colors: 3, mode: 'color', threshold: 128, smooth: false, detail: 80, transparentBg: false });
assert.equal(t.colors, 3);
assert.ok(/<rect[^>]+fill="#f[ef]f[ef]f[ef]"/i.test(t.svg) || /<rect/.test(t.svg), 'background layer');
assert.ok(t.paths >= 3 && t.paths <= 6, `paths ${t.paths}`); // disc, square outer + hole
assert.ok(/fill-rule="evenodd"/.test(t.svg));
ok(`colour trace: ${t.colors} colours, ${t.paths} outlines (holes kept)`);
const bw = traceToSvg(img, w, h, { colors: 2, mode: 'bw', threshold: 128, smooth: true, detail: 60, transparentBg: true });
assert.ok(!/<rect/.test(bw.svg) && /Q/.test(bw.svg));
ok('black & white trace with transparent background and smooth curves');
console.log(`\nAll ${n} image tests passed`);
