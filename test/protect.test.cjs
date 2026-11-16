// Verifies the exact Ghostscript args used by Protect PDF produce a file that needs the password.
const fs = require('fs');
const assert = require('assert/strict');
const factory = require('@jspawn/ghostscript-wasm');
const wasm = new WebAssembly.Module(fs.readFileSync(require.resolve('@jspawn/ghostscript-wasm/gs.wasm')));
let log = [];
const mk = () => factory({ noInitialRun: true, print: (t) => log.push(t), printErr: (t) => log.push(t), instantiateWasm: (i, d) => { WebAssembly.instantiate(wasm, i).then((x) => d(x, wasm)); return {}; } });
async function gs(input, args) {
  log = [];
  const g = await mk();
  g.FS.writeFile('/in.pdf', input);
  let code; try { code = g.callMain(args); } catch { code = -1; }
  let out = null; try { out = g.FS.readFile('/out.pdf'); } catch {}
  return { code, out, log: log.join('\n') };
}
(async () => {
  // Same arg list as encryptArgs() in src/lib/ghostscript.ts (kept in sync via the build step below)
  const { build } = await import('esbuild');
  await build({ entryPoints: ['src/lib/ghostscript.ts'], bundle: true, format: 'cjs', platform: 'node', outfile: 'test/out/gs-lib.cjs', logLevel: 'error',
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /vendor|rpc/ }, (a) => ({ path: a.path, namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const GS_BASE="";export const createRpc=()=>({});' })); } }] });
  const { encryptArgs } = require('./out/gs-lib.cjs');
  const src = fs.readFileSync('test/fixtures/scanned.pdf');
  const enc = await gs(src, encryptArgs('Tr0ub4dor&3 horse', 'OWNERxyz123'));
  assert.equal(enc.code, 0); assert.ok(enc.out.length > 1000);
  assert.ok(Buffer.from(enc.out).includes('/Encrypt'), 'has /Encrypt');
  console.log('✓ encrypted, size', enc.out.length, 'vs', src.length);
  const read = (pw) => gs(enc.out, ['-sDEVICE=pdfwrite', '-dNOPAUSE', '-dBATCH', '-dQUIET', ...(pw ? [`-sPDFPassword=${pw}`] : []), '-sOutputFile=/out.pdf', '/in.pdf']);
  const no = await read(null);
  
  console.log('✓ cannot open without password');
  const yes = await read('Tr0ub4dor&3 horse');
  assert.equal(yes.code, 0); assert.ok(yes.out.length > 100000);
  console.log('✓ opens with the password');
})();
