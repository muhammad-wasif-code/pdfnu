// Generates public/og.png (1200×630 social preview). Run: node scripts/make-og.mjs
import sharp from 'sharp';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef2ff"/></linearGradient>
<linearGradient id="d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#818CF8"/><stop offset=".55" stop-color="#6366F1"/><stop offset="1" stop-color="#4338CA"/></linearGradient>
<radialGradient id="g"><stop offset="0" stop-color="#c7d2fe" stop-opacity=".9"/><stop offset="1" stop-color="#eef2ff" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<circle cx="930" cy="300" r="300" fill="url(#g)"/>
<g transform="translate(80 70)"><rect width="64" height="64" rx="18" fill="#4F46E5"/><path d="M22 15h14l10 10v21a3 3 0 0 1-3 3H22a3 3 0 0 1-3-3V18a3 3 0 0 1 3-3Z" fill="#fff"/><path d="M26 33h12M26 39h8" stroke="#4F46E5" stroke-width="3" stroke-linecap="round"/>
<text x="84" y="47" font-family="Inter, Helvetica, Arial, sans-serif" font-size="40" font-weight="800" fill="#111827">PDFNU</text></g>
<text x="80" y="268" font-family="Inter, Helvetica, Arial, sans-serif" font-size="64" font-weight="800" fill="#111827">Every PDF tool you need.</text>
<text x="80" y="348" font-family="Inter, Helvetica, Arial, sans-serif" font-size="52" font-weight="800" fill="#4F46E5">Fast, free, and your files</text>
<text x="80" y="414" font-family="Inter, Helvetica, Arial, sans-serif" font-size="52" font-weight="800" fill="#4F46E5">never leave your device.</text>
<text x="80" y="520" font-family="Inter, Helvetica, Arial, sans-serif" font-size="28" font-weight="600" fill="#374151">No upload  ·  No signup  ·  No watermark  ·  Free forever</text>
<g transform="translate(860 120) rotate(12 120 160)"><path d="M40 0h120l80 80v220a20 20 0 0 1-20 20H40a20 20 0 0 1-20-20V20A20 20 0 0 1 40 0Z" fill="url(#d)"/><path d="M160 0v60a20 20 0 0 0 20 20h60Z" fill="#c7d2fe"/>
<text x="130" y="230" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="64" font-weight="800" fill="#fff">PDF</text></g>
</svg>`;
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile('public/og.png');
console.log('public/og.png written');
