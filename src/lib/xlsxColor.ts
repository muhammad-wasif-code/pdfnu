/** Colours in SpreadsheetML (rgb / theme+tint / indexed) and DrawingML (srgbClr, schemeClr + lumMod…). */
import { kid, find, type XNode } from './xml';

export interface Theme { list: string[]; byName: Record<string, string>; minorFont?: string; majorFont?: string; }

function toHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  }
  return [h, s, l];
}
function fromHsl(h: number, s: number, l: number): string {
  l = Math.max(0, Math.min(1, l));
  const hue = (p: number, q: number, x: number) => { if (x < 0) x += 1; if (x > 1) x -= 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  let r: number, g: number, b: number;
  if (s === 0) r = g = b = l;
  else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3); }
  const to = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return (to(r) + to(g) + to(b)).toUpperCase();
}

/** Excel's tint: negative darkens, positive lightens (HSL luminance). */
export function tint(hex: string, t: number): string {
  if (!t) return hex;
  const [h, s, l] = toHsl(hex);
  return fromHsl(h, s, t < 0 ? l * (1 + t) : l * (1 - t) + t);
}
export function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const c = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0');
  return (c(0) + c(2) + c(4)).toUpperCase();
}

const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];

/** <color rgb|theme|indexed|auto tint/> → RRGGBB */
export function sheetColor(el: XNode | undefined, theme: Theme, fallback?: string): string | undefined {
  if (!el) return fallback;
  let hex: string | undefined;
  if (el.a.rgb) hex = el.a.rgb.length === 8 ? el.a.rgb.slice(2) : el.a.rgb.slice(-6);
  else if (el.a.theme !== undefined) hex = theme.list[+el.a.theme];
  else if (el.a.indexed !== undefined) { const i = +el.a.indexed; hex = i === 64 ? '000000' : i === 65 ? 'FFFFFF' : INDEXED[i]; }
  else if (el.a.auto) hex = fallback ?? '000000';
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return tint(hex.toUpperCase(), el.a.tint ? +el.a.tint : 0);
}

const PRESET: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080', darkBlue: '00008B', darkRed: '8B0000', darkGreen: '006400', lightGray: 'D3D3D3', navy: '000080', teal: '008080', silver: 'C0C0C0' };

/** A DrawingML colour element (srgbClr, schemeClr, sysClr, prstClr, scrgbClr, hslClr) with its modifiers. */
export function dmlColor(el: XNode | undefined, theme: Theme, phClr?: string): { hex: string; alpha: number } | undefined {
  if (!el) return undefined;
  let hex: string | undefined;
  switch (el.n) {
    case 'srgbClr': hex = el.a.val; break;
    case 'schemeClr': hex = el.a.val === 'phClr' ? phClr : theme.byName[el.a.val]; break;
    case 'sysClr': hex = el.a.lastClr ?? (el.a.val === 'window' ? 'FFFFFF' : '000000'); break;
    case 'prstClr': hex = PRESET[el.a.val] ?? '000000'; break;
    case 'scrgbClr': { const f = (k: string) => Math.round(Math.min(1, +(el.a[k] ?? 0) / 100000) * 255).toString(16).padStart(2, '0'); hex = f('r') + f('g') + f('b'); break; }
    case 'hslClr': hex = fromHsl(+(el.a.hue ?? 0) / 21600000, +(el.a.sat ?? 0) / 100000, +(el.a.lum ?? 0) / 100000); break;
    default: return undefined;
  }
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  hex = hex.toUpperCase();
  let alpha = 1;
  let [h, s, l] = toHsl(hex);
  let dirty = false;
  for (const m of el.c) {
    const v = +(m.a.val ?? 0) / 100000;
    switch (m.n) {
      case 'lumMod': l *= v; dirty = true; break;
      case 'lumOff': l += v; dirty = true; break;
      case 'satMod': s = Math.min(1, s * v); dirty = true; break;
      case 'tint': { if (dirty) { hex = fromHsl(h, s, l); dirty = false; } hex = mix('FFFFFF', hex, v); [h, s, l] = toHsl(hex); break; }
      case 'shade': { if (dirty) { hex = fromHsl(h, s, l); dirty = false; } hex = mix('000000', hex, v); [h, s, l] = toHsl(hex); break; }
      case 'alpha': alpha = v; break;
    }
  }
  if (dirty) hex = fromHsl(h, s, l);
  return { hex, alpha };
}

/** First colour child of a fill element (solidFill, gradFill → first stop). null = explicitly no fill. */
export function fillOf(spPr: XNode | undefined, theme: Theme, phClr?: string): string | null | undefined {
  if (!spPr) return undefined;
  if (kid(spPr, 'noFill')) return null;
  const solid = kid(spPr, 'solidFill');
  if (solid) return dmlColor(solid.c[0], theme, phClr)?.hex;
  const grad = kid(spPr, 'gradFill');
  if (grad) { const stops = find(grad, 'gs'); const mid = stops[Math.floor(stops.length / 2)] ?? stops[0]; return mid ? dmlColor(mid.c[0], theme, phClr)?.hex : undefined; }
  const patt = kid(spPr, 'pattFill');
  if (patt) return dmlColor(kid(patt, 'fgClr')?.c[0], theme, phClr)?.hex;
  return undefined;
}
/** a:ln → colour + width (pt); null = no line. */
export function lineOf(spPr: XNode | undefined, theme: Theme, phClr?: string): { color: string; w: number; dash?: string } | null | undefined {
  const ln = spPr ? kid(spPr, 'ln') : undefined;
  if (!ln) return undefined;
  if (kid(ln, 'noFill')) return null;
  const c = fillOf(ln, theme, phClr);
  const w = ln.a.w ? +ln.a.w / 12700 : 0.75;
  return c === undefined && !ln.a.w ? undefined : { color: c ?? '000000', w, dash: kid(ln, 'prstDash')?.a.val };
}

export function themeFrom(x: XNode | null): Theme {
  const scheme = x ? find(x, 'clrScheme')[0] : undefined;
  const get = (name: string, d: string) => { const c = kid(scheme, name)?.c[0]; return c ? (c.a.lastClr ?? c.a.val ?? d).toUpperCase() : d; };
  const byName: Record<string, string> = {
    dk1: get('dk1', '000000'), lt1: get('lt1', 'FFFFFF'), dk2: get('dk2', '44546A'), lt2: get('lt2', 'E7E6E6'),
    accent1: get('accent1', '4472C4'), accent2: get('accent2', 'ED7D31'), accent3: get('accent3', 'A5A5A5'), accent4: get('accent4', 'FFC000'),
    accent5: get('accent5', '5B9BD5'), accent6: get('accent6', '70AD47'), hlink: get('hlink', '0563C1'), folHlink: get('folHlink', '954F72'),
  };
  Object.assign(byName, { tx1: byName.dk1, bg1: byName.lt1, tx2: byName.dk2, bg2: byName.lt2 });
  const font = (which: string) => { const f = x ? find(x, which)[0] : undefined; return kid(f, 'latin')?.a.typeface || undefined; };
  return {
    // SpreadsheetML theme index: 0 = lt1, 1 = dk1, 2 = lt2, 3 = dk2, then accents
    list: [byName.lt1, byName.dk1, byName.lt2, byName.dk2, byName.accent1, byName.accent2, byName.accent3, byName.accent4, byName.accent5, byName.accent6, byName.hlink, byName.folHlink],
    byName, minorFont: font('minorFont'), majorFont: font('majorFont'),
  };
}
