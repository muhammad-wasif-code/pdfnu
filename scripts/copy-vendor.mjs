// Copies large runtime assets (Ghostscript WASM, pdf.js fonts/cmaps) into public/vendor
// with versioned paths so they can be cached forever. Runs before dev/build.
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
console.log(`vendor ready: ${gsOut}, ${pjOut}`);
