// Generates test PDFs: small text PDF and a "scanned" image-only PDF built from noisy JPEG-like raster.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const small = await PDFDocument.create();
const font = await small.embedFont(StandardFonts.Helvetica);
for (let p = 0; p < 3; p++) {
  const page = small.addPage([595, 842]);
  for (let i = 0; i < 40; i++) page.drawText(`Page ${p + 1} line ${i + 1}: The quick brown fox jumps over the lazy dog.`, { x: 40, y: 800 - i * 19, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
}
writeFileSync('test/fixtures/small.pdf', await small.save());

// "scanned" page: grayish paper with text-like dark strokes + noise, at ~200dpi A4
async function scanPage(seed) {
  const w = 1654, h = 2339;
  const buf = Buffer.alloc(w * h * 3);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const line = y % 48 < 22 && y > 150 && y < h - 150 && x > 120 && x < w - 120 && ((x >> 4) + (y >> 5)) % 7 !== 0;
    const ink = line && rnd() < 0.55;
    const v = ink ? 40 + rnd() * 40 : 225 + rnd() * 25;
    const i = (y * w + x) * 3; buf[i] = v; buf[i + 1] = v - 3; buf[i + 2] = v - 8;
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}
async function imagePdf(pages, file) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const jpg = await doc.embedJpg(await scanPage(i + 7));
    const page = doc.addPage([595, 842]);
    page.drawImage(jpg, { x: 0, y: 0, width: 595, height: 842 });
  }
  writeFileSync(file, await doc.save());
}
await imagePdf(4, 'test/fixtures/scanned.pdf');
console.log('fixtures written');

// ~50 MB photo-heavy PDF
if (process.argv.includes('--big')) {
  const doc = await PDFDocument.create();
  const jpgs = [];
  for (let i = 0; i < 4; i++) jpgs.push(await doc.embedJpg(await scanPage(100 + i).then((b) => sharp(b).resize(3300, 4678).jpeg({ quality: 95 }).toBuffer())));
  let n = 0;
  while ((await doc.save({ useObjectStreams: false })).length < 50 * 1024 * 1024 && n < 60) {
    // embed fresh copies so the size really grows (no dedup)
    const img = await doc.embedJpg(await scanPage(200 + n).then((b) => sharp(b).resize(3300, 4678).jpeg({ quality: 95 }).toBuffer()));
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
    n++;
  }
  writeFileSync('test/fixtures/big.pdf', await doc.save());
  console.log('big pages', n);
}

// ~7 MB noisy 12 MP photo for image-compression tests (not committed)
if (process.argv.includes('--big')) {
  const w = 3000, h = 4000, b = Buffer.alloc(w * h * 3);
  let s = 7;
  for (let i = 0; i < b.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; b[i] = ((((i / 3) | 0) % w) * 80 / w + ((s >> 16) % 120)) | 0; }
  await sharp(b, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toFile('test/fixtures/noisy.jpg');
  console.log('noisy.jpg written');
}
