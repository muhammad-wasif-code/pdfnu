// Smoke test: run Ghostscript WASM pdfwrite on a fixture. Usage: node test/gs-smoke.cjs in.pdf /ebook
const fs = require('fs');
const factory = require('@jspawn/ghostscript-wasm');
const wasm = new WebAssembly.Module(fs.readFileSync(require.resolve('@jspawn/ghostscript-wasm/gs.wasm')));
(async () => {
  const [, , inp, preset = '/ebook', ...extra] = process.argv;
  const gs = await factory({
    noInitialRun: true, print: () => {}, printErr: (s) => console.error('gs:', s),
    instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then((i) => done(i, wasm)); return {}; },
  });
  gs.FS.writeFile('/in.pdf', fs.readFileSync(inp));
  const t = Date.now();
  const code = gs.callMain(['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=${preset}`, '-dNOPAUSE', '-dQUIET', '-dBATCH', '-sOutputFile=/out.pdf', ...extra, '/in.pdf']);
  const out = gs.FS.readFile('/out.pdf');
  fs.writeFileSync('test/out/gs' + preset.replace('/', '-') + '.pdf', out);
  console.log({ code, in: fs.statSync(inp).size, out: out.length, ms: Date.now() - t });
})();
