// Builds TIFF fixtures (fax G3/G4, LZW, PackBits, RGB, gray, CMYK, multi-page) with Ghostscript WASM and macOS sips.
const fs = require('fs');
const { execSync } = require('child_process');
const factory = require('@jspawn/ghostscript-wasm');
const wasm = new WebAssembly.Module(fs.readFileSync(require.resolve('@jspawn/ghostscript-wasm/gs.wasm')));
const mk = () => factory({ noInitialRun: true, print() {}, printErr() {}, instantiateWasm: (i, d) => { WebAssembly.instantiate(wasm, i).then((x) => d(x, wasm)); return {}; } });
(async () => {
  const src = fs.readFileSync('test/fixtures/small.pdf'); // 3 pages, text
  const inv = fs.readFileSync('test/fixtures/invoice.pdf'); // 1 page, colour
  const devs = [['tiffg4', 'fax-g4', src, 100], ['tiffg3', 'fax-g3', inv, 100], ['tiffg32d', 'fax-g3-2d', inv, 100], ['tiffcrle', 'fax-rle', inv, 100],
    ['tifflzw', 'mono-lzw', inv, 100], ['tiffpack', 'mono-packbits', inv, 100], ['tiff24nc', 'rgb', inv, 30], ['tiffgray', 'gray', src, 25], ['tiff32nc', 'cmyk', inv, 20]];
  for (const [dev, name, input, res] of devs) {
    const g = await mk();
    g.FS.writeFile('/in.pdf', input);
    g.callMain([`-sDEVICE=${dev}`, `-r${res}`, '-dNOPAUSE', '-dBATCH', '-dQUIET', '-sOutputFile=/o.tif', '/in.pdf']);
    fs.writeFileSync(`test/fixtures/tiff/${name}.tif`, g.FS.readFile('/o.tif'));
  }
  // RGB LZW (with predictor) and PackBits written by macOS
  execSync('sips -Z 240 test/fixtures/image.png --out test/out/tiff-src.png', { stdio: 'ignore' });
  for (const opt of ['lzw', 'packbits']) {
    try { execSync(`sips -s format tiff -s formatOptions ${opt} test/out/tiff-src.png --out test/fixtures/tiff/photo-${opt}.tif`, { stdio: 'ignore' }); } catch {}
  }
  console.log(fs.readdirSync('test/fixtures/tiff').join(' '));
})();
