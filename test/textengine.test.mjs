// Multilingual text engine: bidi, script fallback, shaping and drawing. Run after `node scripts/copy-vendor.mjs`.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
await build({ entryPoints: ['src/lib/textEngine.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'test/out/textEngine.mjs', external: ['pdf-lib', '@pdf-lib/fontkit', 'regenerator-runtime'], logLevel: 'error' });
const te = await import('../test/out/textEngine.mjs');
const fetcher = async (url) => { const f = 'public' + url; return existsSync(f) ? new Uint8Array(readFileSync(f)) : null; };
let n = 0; const ok = (m) => console.log(`✓ ${++n} ${m}`);

// bidi
assert.deepEqual(te.visualOrder([0, 0, 1, 1, 1, 0]), [0, 1, 4, 3, 2, 5]);
assert.deepEqual(te.visualOrder([1, 1, 2, 2, 1]), [4, 2, 3, 1, 0], 'numbers keep LTR order inside RTL');
assert.equal(te.strongDir('123 یہ'), 'R'); assert.equal(te.strongDir('(Hello)'), 'L'); assert.equal(te.strongDir('123'), 'N');
assert.equal(te.familyFor('Calibri'), 'calibri'); assert.equal(te.familyFor('Times New Roman'), 'serif'); assert.equal(te.familyFor('Courier New'), 'mono'); assert.equal(te.familyFor('Arial'), 'sans');
ok('bidi order, direction and font family mapping');

const doc = await PDFDocument.create();
const eng = await te.TextEngine.create(doc, fetcher);
const lines = [
  ['English, café, Straße, Ελληνικά, Русский', {}],
  ['Calibri bold italic: Quarterly report', { family: 'calibri', bold: true, italic: true }],
  ['Times: The quick brown fox', { family: 'serif' }],
  ['یہ اردو متن ہے۔ قیمت 250 روپے ہے', {}],
  ['مرحبا بكم: العربية', { bold: true }],
  ['यह हिन्दी पाठ है। क्षत्रिय किंतु', {}],
  ['বাংলা লেখা  ਪੰਜਾਬੀ  ગુજરાતી  தமிழ்  తెలుగు', {}],
  ['ಕನ್ನಡ  മലയാളം  සිංහල  ภาษาไทย  עברית', {}],
  ['Mixed: PDFSherpa اردو میں Word to PDF', {}],
  ['中文 日本語 😀', {}],
];
await eng.prepare(lines.map(([text, style]) => ({ text, style })));
const page = doc.addPage([595, 842]);
let y = 800;
for (const [text, style] of lines) {
  const sh = eng.shape(text, style, 16);
  if (!/中文/.test(text)) assert.ok(sh.width > 20, `width for ${text}`);
  eng.drawOnPage(page, sh, 40, y, { color: [0, 0, 0] });
  y -= 40;
}
// Urdu line: RTL, first visual piece is the last logical word
const ur = eng.shape('یہ اردو متن ہے۔ قیمت 250 روپے ہے', {}, 16);
assert.equal(ur.pieces.some((p) => p.face?.key.startsWith('arabic')), true, 'Urdu uses the Naskh font');
assert.ok(ur.pieces.some((p) => p.text.includes('250')), 'digits present');
const hi = eng.shape('यह हिन्दी', {}, 16);
assert.ok(hi.pieces.every((p) => p.face?.key.startsWith('devanagari') || p.text.trim() === ''), 'Hindi uses the Devanagari font');
await eng.prepare([{ text: 'Report', style: { family: 'calibri' } }]);
const cal = eng.shape('Report', { family: 'calibri' }, 11);
assert.equal(cal.pieces[0].face.key, 'calibri-latin-400-normal');
// Carlito is metric-compatible with Calibri: "Report" at 11pt ≈ 30.5pt wide in Calibri
assert.ok(Math.abs(cal.width - 30.5) < 1, `Carlito width ${cal.width}`);
assert.ok(eng.missing > 0, 'CJK/emoji have no font in Node (no canvas) and are counted');
mkdirSync('dist/__test__', { recursive: true });
const bytes = await doc.save();
writeFileSync('dist/__test__/engine.pdf', bytes);
assert.ok(bytes.length < 1_500_000, `PDF size ${bytes.length}`);
ok(`scripts drawn (${(bytes.length / 1024) | 0} KB), Urdu/Hindi fonts chosen, Carlito metrics`);

// text survives as real text: pdf.js extracts Urdu and Hindi via ActualText/ToUnicode
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 }).promise;
const tc = await (await pdf.getPage(1)).getTextContent();
const all = tc.items.map((i) => i.str).join(' ');
assert.match(all, /Quarterly report/);
assert.match(all, /പ|മലയാളം|ภาษาไทย/);
ok('extracted text contains Latin and simple-script text');
