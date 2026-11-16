// Generates PNG icons + favicon.ico from public/favicon.svg. Run: node scripts/make-icons.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync('public/favicon.svg');
const png = (size) => sharp(svg, { density: 1200 }).resize(size, size).png().toBuffer();
writeFileSync('public/icon-192.png', await png(192));
writeFileSync('public/icon-512.png', await png(512));
writeFileSync('public/apple-touch-icon.png', await sharp({ create: { width: 180, height: 180, channels: 4, background: '#4F46E5' } }).composite([{ input: await png(180) }]).png().toBuffer());
// maskable: logo on full-bleed indigo with safe-zone padding
const inner = await png(360);
writeFileSync('public/icon-maskable-512.png', await sharp({ create: { width: 512, height: 512, channels: 4, background: '#4F46E5' } }).composite([{ input: inner, left: 76, top: 76 }]).png().toBuffer());
// ICO containing a single 32x32 PNG
const p32 = await png(32);
const h = Buffer.alloc(22);
h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
h.writeUInt8(32, 6); h.writeUInt8(32, 7); h.writeUInt8(0, 8); h.writeUInt8(0, 9);
h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12); h.writeUInt32LE(p32.length, 14); h.writeUInt32LE(22, 18);
writeFileSync('public/favicon.ico', Buffer.concat([h, p32]));
console.log('icons written');
