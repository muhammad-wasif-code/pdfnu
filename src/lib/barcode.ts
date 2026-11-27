/**
 * 1-D barcodes as bar patterns: Code 128 (auto B/C), EAN-13, EAN-8, UPC-A, Code 39, ITF-14.
 * Output: module widths (1 = narrowest bar) starting with a bar, plus SVG.
 */

export type Symbology = 'code128' | 'ean13' | 'ean8' | 'upca' | 'code39' | 'itf14';

// Code 128 patterns (bar/space widths) for values 0..106
// prettier-ignore
const C128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];

function code128(text: string): number[] {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('CODE128_CHARS');
  const vals: number[] = [];
  let i = 0;
  const digitsAhead = (k: number) => { let n = 0; while (k + n < text.length && /\d/.test(text[k + n])) n++; return n; };
  let set: 'B' | 'C' = digitsAhead(0) >= 4 && digitsAhead(0) % 2 === 0 || digitsAhead(0) === text.length && text.length >= 2 && text.length % 2 === 0 ? 'C' : 'B';
  vals.push(set === 'C' ? 105 : 104);
  while (i < text.length) {
    const d = digitsAhead(i);
    if (set === 'B' && d >= 6 && d % 2 === 0) { vals.push(99); set = 'C'; }
    else if (set === 'B' && d >= 4 && i + d === text.length && d % 2 === 0) { vals.push(99); set = 'C'; }
    if (set === 'C') {
      if (d >= 2) { vals.push(+text.slice(i, i + 2)); i += 2; continue; }
      vals.push(100); set = 'B';
    }
    vals.push(text.charCodeAt(i) - 32); i++;
  }
  let sum = vals[0];
  for (let k = 1; k < vals.length; k++) sum += vals[k] * k;
  vals.push(sum % 103, 106);
  return vals.flatMap((v) => [...C128[v]].map(Number));
}

const L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'];
const G = L.map((p) => [...p].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function eanCheck(digits: string): number {
  let s = 0;
  for (let i = 0; i < digits.length; i++) s += +digits[digits.length - 1 - i] * (i % 2 === 0 ? 3 : 1);
  return (10 - (s % 10)) % 10;
}

function ean(digits: string): number[] {
  const out: number[] = [1, 1, 1]; // start guard (bar space bar)
  if (digits.length === 13) {
    const par = PARITY[+digits[0]];
    for (let i = 1; i <= 6; i++) out.push(...[...(par[i - 1] === 'L' ? L : G)[+digits[i]]].map(Number));
    out.push(1, 1, 1, 1, 1);
    for (let i = 7; i <= 12; i++) out.push(...[...L[+digits[i]]].map(Number));
  } else { // EAN-8
    for (let i = 0; i < 4; i++) out.push(...[...L[+digits[i]]].map(Number));
    out.push(1, 1, 1, 1, 1);
    for (let i = 4; i < 8; i++) out.push(...[...L[+digits[i]]].map(Number));
  }
  // L patterns start with a space; left-half digits therefore begin with a space after the guard
  out.push(1, 1, 1);
  return out;
}

// Code 39: n = narrow, w = wide (bars and spaces alternate, 9 elements)
const C39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
  $: 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
};
function code39(text: string): number[] {
  const t = `*${text.toUpperCase()}*`;
  const out: number[] = [];
  for (const ch of t) { const p = C39[ch]; if (!p) throw new Error('CODE39_CHARS'); out.push(...[...p].map((c) => (c === 'w' ? 3 : 1)), 1); }
  out.pop();
  return out;
}

function itf(digits: string): number[] {
  const P = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];
  const out = [1, 1, 1, 1];
  for (let i = 0; i < digits.length; i += 2) {
    const a = P[+digits[i]], b = P[+digits[i + 1]];
    for (let k = 0; k < 5; k++) out.push(a[k] === 'w' ? 3 : 1, b[k] === 'w' ? 3 : 1);
  }
  out.push(3, 1, 1);
  return out;
}

export interface Barcode { widths: number[]; text: string; guards?: number[]; }

/** Validate/complete input and build the pattern. Missing check digits are added. */
export function makeBarcode(sym: Symbology, raw: string): Barcode {
  const text = raw.trim();
  const digitsOnly = (n: number[]) => { if (!/^\d+$/.test(text) || !n.includes(text.length)) throw new Error('DIGITS'); };
  switch (sym) {
    case 'code128': if (!text) throw new Error('EMPTY'); return { widths: code128(text), text };
    case 'code39': if (!text) throw new Error('EMPTY'); return { widths: code39(text), text: text.toUpperCase() };
    case 'ean13': { digitsOnly([12, 13]); const d = text.slice(0, 12); const full = d + eanCheck(d); if (text.length === 13 && text !== full) throw new Error('CHECK'); return { widths: ean(full), text: full }; }
    case 'upca': { digitsOnly([11, 12]); const d = text.slice(0, 11); const full = d + eanCheck(d); if (text.length === 12 && text !== full) throw new Error('CHECK'); return { widths: ean('0' + full), text: full }; }
    case 'ean8': { digitsOnly([7, 8]); const d = text.slice(0, 7); const full = d + eanCheck(d); if (text.length === 8 && text !== full) throw new Error('CHECK'); return { widths: ean(full), text: full }; }
    case 'itf14': { digitsOnly([13, 14]); const d = text.slice(0, 13); const full = d + eanCheck(d); if (text.length === 14 && text !== full) throw new Error('CHECK'); return { widths: itf(full), text: full }; }
  }
}

export function barcodeSvg(b: Barcode, o: { height: number; module: number; showText: boolean; fg: string; bg: string | null; quiet: number }): { svg: string; w: number; h: number } {
  const total = b.widths.reduce((a, c) => a + c, 0);
  const W = (total + o.quiet * 2) * o.module, textH = o.showText ? o.module * 12 : 0;
  const H = o.height + textH + o.module * 4;
  let x = o.quiet * o.module, d = '';
  b.widths.forEach((w, i) => { if (i % 2 === 0) d += `M${x} ${o.module * 2}h${w * o.module}v${o.height}h${-w * o.module}z`; x += w * o.module; });
  const txt = o.showText ? `<text x="${W / 2}" y="${o.height + o.module * 2 + textH * 0.85}" font-family="Arial, Helvetica, sans-serif" font-size="${o.module * 10}" text-anchor="middle" fill="${o.fg}">${b.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>` : '';
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${o.bg ? `<rect width="${W}" height="${H}" fill="${o.bg}"/>` : ''}<path fill="${o.fg}" d="${d}"/>${txt}</svg>`, w: W, h: H };
}
