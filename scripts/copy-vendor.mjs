// Copies large runtime assets (Ghostscript WASM, pdf.js fonts/cmaps) into public/vendor
// with versioned paths so they can be cached forever. Runs before dev/build.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);

const gsDir = dirname(require.resolve('@jspawn/ghostscript-wasm/package.json'));
const gsVer = JSON.parse(readFileSync(join(gsDir, 'package.json'), 'utf8')).version;
const gsOut = `public/vendor/gs-${gsVer}`;
if (!existsSync(join(gsOut, 'gs.wasm'))) {
  mkdirSync(gsOut, { recursive: true });
  cpSync(join(gsDir, 'gs.js'), join(gsOut, 'gs.js'));
  cpSync(join(gsDir, 'gs.wasm'), join(gsOut, 'gs.wasm'));
  cpSync(join(gsDir, 'LICENSE'), join(gsOut, 'LICENSE.txt'));
}
cpSync('scripts/gs-worker.js', join(gsOut, 'gs-worker.js'));

const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));
const pdfjsVer = JSON.parse(readFileSync(join(pdfjsDir, 'package.json'), 'utf8')).version;
const pjOut = `public/vendor/pdfjs-${pdfjsVer}`;
if (!existsSync(pjOut)) {
  cpSync(join(pdfjsDir, 'standard_fonts'), join(pjOut, 'standard_fonts'), { recursive: true });
  cpSync(join(pdfjsDir, 'cmaps'), join(pjOut, 'cmaps'), { recursive: true });
  cpSync(join(pdfjsDir, 'wasm'), join(pjOut, 'wasm'), { recursive: true });
  cpSync(join(pdfjsDir, 'iccs'), join(pjOut, 'iccs'), { recursive: true });
}
// OCR: tesseract.js worker + LSTM cores + language models (served from our own origin, never a CDN)
const tjDir = dirname(require.resolve('tesseract.js/package.json'));
const tjVer = JSON.parse(readFileSync(join(tjDir, 'package.json'), 'utf8')).version;
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const tjOut = `public/vendor/tesseract-${tjVer}`;
if (!existsSync(join(tjOut, 'lang', 'hin.traineddata.gz'))) {
  mkdirSync(join(tjOut, 'lang'), { recursive: true });
  cpSync(join(tjDir, 'dist', 'worker.min.js'), join(tjOut, 'worker.min.js'));
  for (const f of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js', 'LICENSE']) cpSync(join(coreDir, f), join(tjOut, f === 'LICENSE' ? 'LICENSE.txt' : f));
  for (const l of ['eng', 'urd', 'hin']) {
    const d = dirname(require.resolve(`@tesseract.js-data/${l}/package.json`));
    cpSync(join(d, '4.0.0_best_int', `${l}.traineddata.gz`), join(tjOut, 'lang', `${l}.traineddata.gz`));
  }
}

// HEIC decoder (libheif compiled to JS, bundled in heic2any)
const hDir = dirname(require.resolve('heic2any/package.json'));
const hVer = JSON.parse(readFileSync(join(hDir, 'package.json'), 'utf8')).version;
const hOut = `public/vendor/heic2any-${hVer}`;
if (!existsSync(join(hOut, 'heic2any.min.js'))) {
  mkdirSync(hOut, { recursive: true });
  cpSync(join(hDir, 'dist', 'heic2any.min.js'), join(hOut, 'heic2any.min.js'));
  writeFileSync(join(hOut, 'LICENSE.txt'), readFileSync(join(hDir, 'LICENSE.md'), 'utf8') + '\n\nBundles libheif (LGPL-3.0), https://github.com/strukturag/libheif\n');
}
// Fonts for drawing text in any script (Word to PDF, watermark, header/footer, edit, forms). WOFF → TTF.
const { fontFiles, woffToSfnt } = await import('./fonts.mjs');
const fVer = JSON.parse(readFileSync(join(dirname(require.resolve('@fontsource/carlito/package.json')), 'package.json'), 'utf8')).version;
const fOut = `public/vendor/fonts-${fVer}`;
if (!existsSync(join(fOut, 'LICENSE.txt'))) {
  mkdirSync(fOut, { recursive: true });
  for (const [name, src] of fontFiles()) writeFileSync(join(fOut, name), woffToSfnt(readFileSync(require.resolve(src))));
  writeFileSync(join(fOut, 'LICENSE.txt'), 'Carlito, Tinos, Cousine, Caladea and the Noto fonts are licensed under the SIL Open Font License 1.1 (https://openfontlicense.org). Converted from the @fontsource packages.\n');
}
console.log(`vendor ready: ${gsOut}, ${pjOut}, ${tjOut}, ${hOut}, ${fOut}`);
