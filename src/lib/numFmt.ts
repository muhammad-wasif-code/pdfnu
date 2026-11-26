/** Excel number formats: turn a cell value into the text Excel shows (numbers, currency, %, dates, times). */

export const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  5: '"$"#,##0_);("$"#,##0)', 6: '"$"#,##0_);[Red]("$"#,##0)', 7: '"$"#,##0.00_);("$"#,##0.00)', 8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
  9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@',
};
// East Asian built-in date ids
for (const id of [27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]) BUILTIN_FORMATS[id] = 'yyyy/m/d';
for (const id of [32, 33, 55, 56]) BUILTIN_FORMATS[id] = 'h:mm:ss';

const COLORS: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '00FF00', blue: '0000FF', yellow: 'FFFF00', magenta: 'FF00FF', cyan: '00FFFF' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Tok = { k: 'lit'; s: string } | { k: 'ph'; s: string } | { k: 'date'; s: string } | { k: 'at' } | { k: 'pct' } | { k: 'exp'; s: string };
interface Section { toks: Tok[]; color?: string; cond?: [string, number]; date: boolean; elapsed: boolean; }

function splitSections(fmt: string): string[] {
  const out: string[] = [];
  let cur = '', q = false, br = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '\\' && !q) { cur += ch + (fmt[i + 1] ?? ''); i++; continue; }
    if (ch === '"' && !br) q = !q;
    else if (ch === '[' && !q) br = true;
    else if (ch === ']' && !q) br = false;
    if (ch === ';' && !q && !br) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseSection(src: string): Section {
  const toks: Tok[] = [];
  const sec: Section = { toks, date: false, elapsed: false };
  const lit = (s: string) => { const l = toks[toks.length - 1]; if (l?.k === 'lit') l.s += s; else toks.push({ k: 'lit', s }); };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    if (ch === '"') { const e = src.indexOf('"', i + 1); lit(src.slice(i + 1, e < 0 ? undefined : e)); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === '\\') { lit(src[i + 1] ?? ''); i += 2; continue; }
    if (ch === '_') { lit(' '); i += 2; continue; }
    if (ch === '*') { i += 2; continue; }
    if (ch === '[') {
      const e = src.indexOf(']', i);
      const inner = src.slice(i + 1, e < 0 ? undefined : e);
      i = e < 0 ? src.length : e + 1;
      const low = inner.toLowerCase();
      if (COLORS[low]) sec.color = COLORS[low];
      else if (/^color\s*\d+$/i.test(inner)) { /* palette colour: ignore */ }
      else if (/^(<=|>=|<>|<|>|=)\s*-?[\d.]+$/.test(inner)) { const m = inner.match(/^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/)!; sec.cond = [m[1], +m[2]]; }
      else if (/^[hms]+$/i.test(inner)) { toks.push({ k: 'date', s: '[' + low + ']' }); sec.date = true; sec.elapsed = true; }
      else if (inner.startsWith('$')) { const sym = inner.slice(1).split('-')[0]; if (sym) lit(sym); }
      continue;
    }
    if (/^(AM\/PM|A\/P)/i.test(rest)) { const m = rest.match(/^(AM\/PM|A\/P)/i)![0]; toks.push({ k: 'date', s: m.toUpperCase() }); sec.date = true; i += m.length; continue; }
    if (/[yYmMdDhHsS]/.test(ch)) {
      let j = i; while (j < src.length && src[j].toLowerCase() === ch.toLowerCase()) j++;
      toks.push({ k: 'date', s: src.slice(i, j).toLowerCase() }); sec.date = true; i = j; continue;
    }
    if (/[eE]/.test(ch) && /[+-]/.test(src[i + 1] ?? '')) { let j = i + 2; while (j < src.length && /[0#?]/.test(src[j])) j++; toks.push({ k: 'exp', s: src.slice(i + 2, j) }); i = j; continue; }
    if (/[0#?.,]/.test(ch)) { const l = toks[toks.length - 1]; if (l?.k === 'ph') l.s += ch; else toks.push({ k: 'ph', s: ch }); i++; continue; }
    if (ch === '%') { toks.push({ k: 'pct' }); i++; continue; }
    if (ch === '@') { toks.push({ k: 'at' }); i++; continue; }
    lit(ch); i++;
  }
  // in date formats, "0" after seconds is fractional seconds; any other placeholder char is literal
  if (sec.date) for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.k !== 'ph') continue;
    const prev = toks[k - 1];
    if (/^\.0+$/.test(t.s) && prev?.k === 'date' && /s/.test(prev.s)) toks[k] = { k: 'date', s: t.s };
    else toks[k] = { k: 'lit', s: t.s };
  }
  return sec;
}

const cache = new Map<string, Section[]>();
function sections(fmt: string): Section[] {
  let s = cache.get(fmt);
  if (!s) { s = splitSections(fmt).map(parseSection); cache.set(fmt, s); }
  return s;
}

export function isDateFormat(fmt: string): boolean {
  if (!fmt || fmt === 'General') return false;
  return sections(fmt).some((s) => s.date);
}

/** Excel's "General" display for a number (up to ~11 characters). */
export function general(v: number): string {
  if (!isFinite(v)) return '#NUM!';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e11 || a < 1e-9) {
    const [m, e] = v.toExponential(5).split('e');
    return `${m.replace(/\.?0+$/, '')}E${+e < 0 ? '-' : '+'}${String(Math.abs(+e)).padStart(2, '0')}`;
  }
  if (Number.isInteger(v)) return String(v);
  const intDigits = Math.max(1, Math.floor(Math.log10(a)) + 1);
  return String(+v.toFixed(Math.max(0, Math.min(10 - intDigits, 15)))).replace(/^(-?)0\./, '$10.');
}

function groupThousands(s: string): string { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function fmtNumber(v: number, sec: Section, neg: boolean): string {
  const toks = sec.toks;
  const pct = toks.filter((t) => t.k === 'pct').length;
  let x = Math.abs(v) * Math.pow(100, pct);
  const ph = toks.filter((t) => t.k === 'ph').map((t) => t.s).join('');
  const exp = toks.find((t) => t.k === 'exp') as { k: 'exp'; s: string } | undefined;
  // trailing commas scale by 1000
  const m = ph.match(/,+$/);
  if (m && !exp) x /= Math.pow(1000, m[0].length);
  const core = ph.replace(/,+$/, '');
  const dot = core.indexOf('.');
  const intPart = dot < 0 ? core : core.slice(0, dot);
  const frac = dot < 0 ? '' : core.slice(dot + 1).replace(/,/g, '');
  const minInt = (intPart.match(/0/g) ?? []).length;
  const thousands = intPart.includes(',');
  const decimals = frac.length;
  const minDec = (frac.match(/0/g) ?? []).length;
  let num: string;
  if (exp) {
    let e = x === 0 ? 0 : Math.floor(Math.log10(x));
    const intLen = Math.max(1, intPart.replace(/,/g, '').length);
    if (intLen > 1) e = Math.floor(e / intLen) * intLen;
    let mant = x / Math.pow(10, e);
    let ms = mant.toFixed(decimals);
    if (+ms >= Math.pow(10, intLen)) { e += intLen; mant /= Math.pow(10, intLen); ms = mant.toFixed(decimals); }
    num = `${trimDec(ms, minDec)}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(Math.max(1, exp.s.length), '0')}`;
  } else {
    let [ip, fp = ''] = x.toFixed(decimals).split('.');
    if (ip === '0' && minInt === 0) ip = '';
    ip = ip.padStart(minInt, '0');
    if (thousands) ip = groupThousands(ip);
    while (fp.length > minDec && fp.endsWith('0')) fp = fp.slice(0, -1);
    num = ip + (core.includes('.') ? '.' + fp : '');
    if (num === '.') num = '';
  }
  // rebuild with literals around the number
  let out = '', placed = false;
  for (const t of toks) {
    if (t.k === 'lit') out += t.s;
    else if (t.k === 'pct') out += '%';
    else if ((t.k === 'ph' || t.k === 'exp') && !placed) { out += num; placed = true; }
  }
  return (neg ? '-' : '') + out;
}
function trimDec(s: string, minDec: number): string {
  const i = s.indexOf('.');
  if (i < 0) return s;
  let end = s.length;
  while (end > i + 1 + minDec && s[end - 1] === '0') end--;
  if (end === i + 1) return s.slice(0, i);
  return s.slice(0, end);
}

/** Serial date → calendar parts (Excel's 1900 system, with its fictitious 29 Feb 1900). */
export function serialToDate(serial: number, date1904 = false) {
  let days = Math.floor(serial);
  let secs = Math.round((serial - days) * 86400);
  if (secs >= 86400) { secs -= 86400; days++; }
  if (date1904) days += 1462;
  let d: Date;
  if (!date1904 && days === 60) return { y: 1900, m: 2, d: 29, wd: 3, H: Math.floor(secs / 3600), M: Math.floor((secs % 3600) / 60), S: secs % 60, frac: serial - Math.floor(serial) };
  if (!date1904 && days < 60) days += 1;
  d = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), H: Math.floor(secs / 3600), M: Math.floor((secs % 3600) / 60), S: secs % 60, frac: serial - Math.floor(serial) };
}

function fmtDate(v: number, sec: Section, date1904: boolean): string {
  const p = serialToDate(v, date1904);
  const ampm = sec.toks.some((t) => t.k === 'date' && (t.s === 'AM/PM' || t.s === 'A/P'));
  const toks = sec.toks;
  let out = '';
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 'lit') { out += t.s; continue; }
    if (t.k === 'pct') { out += '%'; continue; }
    if (t.k !== 'date') continue;
    const s = t.s;
    // m/mm means minutes after an hour or before a second
    const prevDate = (() => { for (let k = i - 1; k >= 0; k--) { const x = toks[k]; if (x.k === 'date' && !/^\./.test(x.s)) return x.s; } return ''; })();
    const nextDate = (() => { for (let k = i + 1; k < toks.length; k++) { const x = toks[k]; if (x.k === 'date' && !/^\./.test(x.s)) return x.s; } return ''; })();
    const minute = (s === 'm' || s === 'mm') && (/^h|\[h/.test(prevDate) || /^s|\[s/.test(nextDate));
    if (s.startsWith('[')) {
      const total = v * 86400;
      if (s[1] === 'h') out += pad(Math.floor(total / 3600), s.length - 2);
      else if (s[1] === 'm') out += pad(Math.floor(total / 60), s.length - 2);
      else out += pad(Math.floor(total), s.length - 2);
    } else if (s[0] === 'y') out += s.length <= 2 ? pad(p.y % 100, 2) : String(p.y);
    else if (minute) out += s === 'mm' ? pad(p.M, 2) : String(p.M);
    else if (s[0] === 'm') out += s === 'm' ? String(p.m) : s === 'mm' ? pad(p.m, 2) : s === 'mmm' ? MONTHS[p.m - 1].slice(0, 3) : s === 'mmmmm' ? MONTHS[p.m - 1][0] : MONTHS[p.m - 1];
    else if (s[0] === 'd') out += s === 'd' ? String(p.d) : s === 'dd' ? pad(p.d, 2) : s === 'ddd' ? DAYS[p.wd].slice(0, 3) : DAYS[p.wd];
    else if (s[0] === 'h') { const h = ampm ? ((p.H + 11) % 12) + 1 : p.H; out += s.length >= 2 ? pad(h, 2) : String(h); }
    else if (s[0] === 's') out += s.length >= 2 ? pad(p.S, 2) : String(p.S);
    else if (s.startsWith('.')) { const n = s.length - 1; const f = (p.frac * 86400) % 1; out += '.' + pad(Math.round(f * Math.pow(10, n)) % Math.pow(10, n), n); }
    else if (s === 'AM/PM') out += p.H < 12 ? 'AM' : 'PM';
    else if (s === 'A/P') out += p.H < 12 ? 'A' : 'P';
  }
  return out;
}

const condOk = (c: [string, number], v: number) => {
  switch (c[0]) { case '<': return v < c[1]; case '>': return v > c[1]; case '<=': return v <= c[1]; case '>=': return v >= c[1]; case '=': return v === c[1]; case '<>': return v !== c[1]; }
  return false;
};

/** Format a number with an Excel format code. Returns the text and an optional colour (RRGGBB). */
export function formatNumber(v: number, fmt: string, date1904 = false): { text: string; color?: string } {
  if (!fmt || /^general$/i.test(fmt.trim())) return { text: general(v) };
  const secs = sections(fmt);
  let sec: Section, neg = false;
  if (secs.some((s) => s.cond)) {
    sec = secs.find((s) => s.cond && condOk(s.cond, v)) ?? secs.find((s) => !s.cond) ?? secs[0];
    neg = v < 0 && !sec.cond?.[0].includes('<');
  } else if (v > 0 || secs.length === 1 || (v === 0 && secs.length < 3)) { sec = secs[0]; neg = v < 0; }
  else if (v < 0) sec = secs[1];
  else sec = secs[2];
  if (!sec.toks.length) return { text: '' };
  // a section that is just General inside a multi-part format
  if (sec.toks.length === 1 && sec.toks[0].k === 'lit' && /^general$/i.test(sec.toks[0].s.trim())) return { text: general(neg ? -Math.abs(v) : Math.abs(v)), color: sec.color };
  if (sec.date) {
    if (v < 0 && !sec.elapsed) return { text: '#'.repeat(8) };
    return { text: fmtDate(v, sec, date1904), color: sec.color };
  }
  if (!sec.toks.some((t) => t.k === 'ph' || t.k === 'exp')) {
    const txt = sec.toks.map((t) => (t.k === 'lit' ? t.s : t.k === 'pct' ? '%' : t.k === 'at' ? general(v) : '')).join('').replace(/general/i, general(Math.abs(v)));
    return { text: (neg ? '-' : '') + txt, color: sec.color };
  }
  return { text: fmtNumber(v, sec, neg), color: sec.color };
}

/** Text value through the text section (4th) or "@". */
export function formatText(s: string, fmt: string): string {
  if (!fmt || !fmt.includes('@')) return s;
  const secs = sections(fmt);
  const sec = secs.length >= 4 ? secs[3] : secs.find((x) => x.toks.some((t) => t.k === 'at'));
  if (!sec) return s;
  return sec.toks.map((t) => (t.k === 'lit' ? t.s : t.k === 'at' ? s : '')).join('');
}
