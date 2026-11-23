// Font catalogue shared by the build (copy-vendor) and tests. Fonts come from @fontsource packages (SIL OFL 1.1)
// as WOFF and are converted to plain TrueType, because fontkit can't read some of these WOFF files reliably.
import { inflateSync } from 'node:zlib';

/** Latin families that stand in (metric-compatible) for common Office fonts. */
export const LATIN_FAMILIES = {
  calibri: { pkg: 'carlito', subsets: ['latin', 'latin-ext', 'greek', 'cyrillic'] },
  serif: { pkg: 'tinos', subsets: ['latin', 'latin-ext', 'greek', 'cyrillic'] },
  mono: { pkg: 'cousine', subsets: ['latin', 'latin-ext', 'greek', 'cyrillic'] },
  cambria: { pkg: 'caladea', subsets: ['latin', 'latin-ext'] },
};

/** Script fonts (regular + bold). `subset` is the Fontsource subset name inside the package. */
export const SCRIPT_FONTS = {
  arabic: { pkg: 'noto-naskh-arabic', subset: 'arabic' },
  hebrew: { pkg: 'noto-sans-hebrew', subset: 'hebrew' },
  devanagari: { pkg: 'noto-sans-devanagari', subset: 'devanagari' },
  bengali: { pkg: 'noto-sans-bengali', subset: 'bengali' },
  gurmukhi: { pkg: 'noto-sans-gurmukhi', subset: 'gurmukhi' },
  gujarati: { pkg: 'noto-sans-gujarati', subset: 'gujarati' },
  oriya: { pkg: 'noto-sans-oriya', subset: 'oriya' },
  tamil: { pkg: 'noto-sans-tamil', subset: 'tamil' },
  telugu: { pkg: 'noto-sans-telugu', subset: 'telugu' },
  kannada: { pkg: 'noto-sans-kannada', subset: 'kannada' },
  malayalam: { pkg: 'noto-sans-malayalam', subset: 'malayalam' },
  sinhala: { pkg: 'noto-sans-sinhala', subset: 'sinhala' },
  thai: { pkg: 'noto-sans-thai', subset: 'thai' },
};

/** Every font file: [output name, path inside node_modules]. */
export function fontFiles() {
  const out = [];
  for (const [fam, { pkg, subsets }] of Object.entries(LATIN_FAMILIES))
    for (const sub of subsets) for (const w of [400, 700]) for (const st of ['normal', 'italic'])
      out.push([`${fam}-${sub}-${w}-${st}.ttf`, `@fontsource/${pkg}/files/${pkg}-${sub}-${w}-${st}.woff`]);
  for (const [script, { pkg, subset }] of Object.entries(SCRIPT_FONTS))
    for (const w of [400, 700]) out.push([`${script}-${w}.ttf`, `@fontsource/${pkg}/files/${pkg}-${subset}-${w}-normal.woff`]);
  return out;
}

/** WOFF 1.0 → plain sfnt (TTF/OTF). */
export function woffToSfnt(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0) !== 0x774f4646) throw new Error('not a WOFF file');
  const flavor = dv.getUint32(4), num = dv.getUint16(12);
  const tables = [];
  for (let i = 0; i < num; i++) {
    const o = 44 + i * 20;
    const tag = dv.getUint32(o), off = dv.getUint32(o + 4), comp = dv.getUint32(o + 8), orig = dv.getUint32(o + 12), sum = dv.getUint32(o + 16);
    const raw = buf.subarray(off, off + comp);
    tables.push({ tag, sum, data: comp < orig ? inflateSync(raw) : raw });
  }
  let es = 0; while ((1 << (es + 1)) <= num) es++;
  const sr = (1 << es) * 16;
  let size = 12 + 16 * num; for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size), o = new DataView(out.buffer);
  o.setUint32(0, flavor); o.setUint16(4, num); o.setUint16(6, sr); o.setUint16(8, es); o.setUint16(10, num * 16 - sr);
  let pos = 12 + 16 * num;
  tables.forEach((t, i) => {
    const d = 12 + i * 16;
    o.setUint32(d, t.tag); o.setUint32(d + 4, t.sum); o.setUint32(d + 8, pos); o.setUint32(d + 12, t.data.length);
    out.set(t.data, pos); pos += (t.data.length + 3) & ~3;
  });
  return out;
}
