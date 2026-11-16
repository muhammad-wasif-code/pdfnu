// Create encrypted fixtures with Ghostscript WASM: user-password and owner-only.
const fs = require('fs');
const factory = require('@jspawn/ghostscript-wasm');
const wasm = new WebAssembly.Module(fs.readFileSync(require.resolve('@jspawn/ghostscript-wasm/gs.wasm')));
async function run(args, out) {
  const gs = await factory({ noInitialRun: true, print: () => {}, printErr: () => {}, instantiateWasm: (i, d) => { WebAssembly.instantiate(wasm, i).then((x) => d(x, wasm)); return {}; } });
  gs.FS.writeFile('/in.pdf', fs.readFileSync('test/fixtures/small.pdf'));
  gs.callMain(['-sDEVICE=pdfwrite', '-dNOPAUSE', '-dBATCH', '-dQUIET', ...args, '-sOutputFile=/out.pdf', '/in.pdf']);
  fs.writeFileSync(out, gs.FS.readFile('/out.pdf'));
}
(async () => {
  await run(['-sOwnerPassword=owner123', '-sUserPassword=user123', '-dEncryptionR=3', '-dKeyLength=128', '-dPermissions=-3904'], 'test/fixtures/encrypted.pdf');
  await run(['-sOwnerPassword=owner123', '-dEncryptionR=3', '-dKeyLength=128', '-dPermissions=-3904'], 'test/fixtures/owner-only.pdf');
  console.log('encrypted fixtures written');
})();
