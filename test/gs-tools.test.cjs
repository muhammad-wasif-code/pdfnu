// Verifies Ghostscript args for Grayscale PDF and Unlock PDF (built from src/lib/ghostscript.ts).
const fs = require('fs');
const assert = require('assert/strict');
const { run, maxDiff } = require('./gs-gray-try.cjs');
(async () => {
  const { build } = await import('esbuild');
  await build({ entryPoints: ['src/lib/ghostscript.ts'], bundle: true, format: 'cjs', platform: 'node', outfile: 'test/out/gs-lib.cjs', logLevel: 'error',
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /vendor|rpc/ }, (a) => ({ path: a.path, namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const GS_BASE="";export const createRpc=()=>({});' })); } }] });
  const lib = require('./out/gs-lib.cjs');
  const color = fs.readFileSync('test/fixtures/color.pdf');
  assert.ok((await maxDiff(color)) > 50, 'fixture has colour');
  const g = await run(color, lib.grayscaleArgs());
  assert.equal(g.c, 0); assert.equal(await maxDiff(g.o), 0);
  console.log('✓ grayscale removes all colour');

  const enc = fs.readFileSync('test/fixtures/encrypted.pdf');
  const good = await run(enc, lib.decryptArgs('user123'));
  assert.equal(good.c, 0); assert.ok(!Buffer.from(good.o).includes('/Encrypt'), 'output not encrypted');
  console.log('✓ unlock with correct password → unencrypted PDF');
  const bad = await run(enc, lib.decryptArgs('wrong'));
  assert.ok(!bad.o || bad.o.length < 5000, 'wrong password yields no pages');
  console.log('✓ wrong password does not produce a document');

  const a = await run(color, lib.pdfaArgs());
  assert.equal(a.c, 0);
  const t = Buffer.from(a.o).toString('latin1');
  assert.ok(/GTS_PDFA1/.test(t), 'output intent');
  assert.ok(/pdfaid:part[^0-9]{0,4}2/.test(t), 'PDF/A-2 identification in XMP');
  assert.ok(/ICCBased|\/N 3/.test(t), 'ICC profile embedded');
  console.log('✓ PDF/A-2b: output intent, XMP id and ICC profile present');
})();
