/** PDF text layer → Markdown, using font size for headings and simple patterns for lists. */

export interface MdRun { text: string; b: boolean; i: boolean; }
export interface MdLine {
  text: string; size: number; y: number; x: number; page: number;
  /** right edge and page width (for alignment), styled runs (when read with `styles`) */
  x1?: number; pageW?: number; runs?: MdRun[];
}

/** Bold/italic from a pdf.js font object (flags, or the font name such as "ABCDEF+Arial-BoldItalicMT"). */
function fontStyle(f: any): { b: boolean; i: boolean } {
  const name = String(f?.name ?? f?.loadedName ?? '');
  return { b: !!f?.bold || !!f?.black || /bold|black|heavy|semibold|demi/i.test(name), i: !!f?.italic || /italic|oblique/i.test(name) };
}

/**
 * Read lines (with font size and position) from a pdf.js document.
 * `styles: true` also records bold/italic runs (needs the page's fonts, so it is slower).
 */
export async function readLines(pdf: any, onPage?: (n: number, of: number) => void, opts: { styles?: boolean } = {}): Promise<MdLine[]> {
  const lines: MdLine[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onPage?.(n, pdf.numPages);
    const page = await pdf.getPage(n);
    const pageW = page.getViewport({ scale: 1 }).width;
    if (opts.styles) { try { await page.getOperatorList(); } catch { /* styles are optional */ } }
    const style = (fontName: string) => { if (!opts.styles) return { b: false, i: false }; try { return page.commonObjs.has(fontName) ? fontStyle(page.commonObjs.get(fontName)) : { b: false, i: false }; } catch { return { b: false, i: false }; } };
    const tc = await page.getTextContent();
    let cur: MdLine | null = null;
    let lastEOL = false;
    const addRun = (l: MdLine, text: string, st: { b: boolean; i: boolean }) => {
      if (!opts.styles) return;
      const runs = (l.runs ??= []);
      const last = runs[runs.length - 1];
      if (last && last.b === st.b && last.i === st.i) last.text += text; else runs.push({ text, ...st });
    };
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string') continue;
      const [a, b, c, d, x, y] = it.transform;
      const size = Math.round(Math.hypot(c, d) * 10) / 10 || Math.hypot(a, b);
      if (!it.str.trim()) { if (it.hasEOL) lastEOL = true; if (cur && it.str) { cur.text += ' '; addRun(cur, ' ', cur.runs?.[cur.runs.length - 1] ?? { b: false, i: false }); } continue; }
      const st = style(it.fontName);
      const right = x + (it.width ?? 0);
      if (!cur || lastEOL || Math.abs(y - cur.y) > Math.max(size, cur.size) * 0.5) {
        if (cur) lines.push(cur);
        cur = { text: it.str, size, y, x, page: n - 1, x1: right, pageW };
        addRun(cur, it.str, st);
      } else {
        cur.text += it.str;
        cur.size = Math.max(cur.size, size);
        cur.x1 = Math.max(cur.x1 ?? right, right);
        addRun(cur, it.str, st);
      }
      lastEOL = !!it.hasEOL;
    }
    if (cur) lines.push(cur);
    page.cleanup();
  }
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim(), runs: l.runs ? normRuns(l.runs) : undefined })).filter((l) => l.text);
}

/** Collapse whitespace across runs and trim the ends, keeping styles. */
function normRuns(runs: MdRun[]): MdRun[] {
  const out: MdRun[] = [];
  for (const r of runs) {
    const t = r.text.replace(/\s+/g, ' ');
    const last = out[out.length - 1];
    if (last && last.text.endsWith(' ') && t.startsWith(' ')) { if (t.length > 1) out.push({ ...r, text: t.slice(1) }); }
    else if (t) out.push({ ...r, text: t });
  }
  if (out.length) { out[0].text = out[0].text.trimStart(); out[out.length - 1].text = out[out.length - 1].text.trimEnd(); }
  return out.filter((r) => r.text);
}

/** A line whose middle is at the middle of the page and that clearly doesn't span the text width. */
const isCentered = (l: MdLine) => !!l.pageW && l.x1 !== undefined && Math.abs((l.x + l.x1) / 2 - l.pageW / 2) < l.pageW * 0.035 && l.x1 - l.x < l.pageW * 0.6;

const BULLET = /^([•●▪◦‣∙·○■□➢►]\s*|[-–—*]\s+)/;
const NUMBERED = /^(\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+/;

function escapeMd(s: string) {
  return s.replace(/^([#>])/, '\\$1').replace(/^(\d+)\.(\s)/, '$1\\.$2');
}

/** A structural block read from the PDF (shared by Markdown and Word export). */
/** `runs` (bold/italic) and `center` are only filled when lines were read with styles. */
export type Block =
  | { type: 'h'; level: number; text: string; center?: boolean }
  | { type: 'p'; text: string; runs?: MdRun[]; center?: boolean }
  | { type: 'li'; marker: string | null; text: string; runs?: MdRun[] } // marker null = bullet, else "1." / "a)"
  | { type: 'page' };

/** Remove the first n characters from styled runs. */
function dropChars(runs: MdRun[] | undefined, n: number): MdRun[] | undefined {
  if (!runs) return undefined;
  const out: MdRun[] = [];
  for (const r of runs) { if (n >= r.text.length) { n -= r.text.length; continue; } out.push({ ...r, text: r.text.slice(n) }); n = 0; }
  return out;
}
function joinRuns(a: MdRun[] | undefined, b: MdRun[] | undefined, sep: string): MdRun[] | undefined {
  if (!a || !b) return undefined;
  const out = a.map((r) => ({ ...r }));
  if (sep && out.length) out[out.length - 1].text += sep;
  for (const r of b) { const last = out[out.length - 1]; if (last && last.b === r.b && last.i === r.i) last.text += r.text; else out.push({ ...r }); }
  return out;
}

const withRuns = <T extends object>(b: T, runs: MdRun[] | undefined): T => (runs ? { ...b, runs: runs.map((r) => ({ ...r })) } : b);

export function toBlocks(lines: MdLine[]): Block[] {
  if (!lines.length) return [];
  // body size = the size used by most characters
  const weight = new Map<number, number>();
  for (const l of lines) weight.set(l.size, (weight.get(l.size) ?? 0) + l.text.length);
  const body = [...weight.entries()].sort((p, q) => q[1] - p[1])[0][0];
  const headingSizes = [...new Set(lines.filter((l) => l.size >= body * 1.15 && l.text.length <= 140).map((l) => l.size))].sort((p, q) => q - p);
  const level = (s: number) => Math.min(headingSizes.indexOf(s) + 1, 4);

  const out: Block[] = [];
  let para: { type: 'p'; text: string; runs?: MdRun[]; center?: boolean } | null = null;
  let paraEnd: MdLine | null = null;
  const flush = () => { if (para) out.push(para); para = null; paraEnd = null; };
  let page = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.page !== page) { flush(); out.push({ type: 'page' }); page = l.page; }
    if (/^\d{1,4}$/.test(l.text) || /^page \d+( of \d+)?$/i.test(l.text)) continue; // page numbers
    if (headingSizes.includes(l.size)) {
      flush();
      const prev = out[out.length - 1];
      const lv = level(l.size);
      // a heading broken over two lines with the same size: join them
      if (prev?.type === 'h' && prev.level === lv && lines[i - 1]?.size === l.size && lines[i - 1]?.page === l.page) prev.text += ' ' + l.text;
      else out.push(isCentered(l) ? { type: 'h', level: lv, text: l.text, center: true } : { type: 'h', level: lv, text: l.text });
      continue;
    }
    if (BULLET.test(l.text) && l.text.length > 2) { flush(); const text = l.text.replace(BULLET, ''); out.push(withRuns({ type: 'li', marker: null, text }, dropChars(l.runs, l.text.length - text.length))); paraEnd = l; continue; }
    if (NUMBERED.test(l.text)) { flush(); const m = l.text.match(NUMBERED)![1].replace(/[()]/g, ''); const text = l.text.replace(NUMBERED, ''); out.push(withRuns({ type: 'li', marker: /^\d/.test(m) ? m.replace(')', '.') : m, text }, dropChars(l.runs, l.text.length - text.length))); paraEnd = l; continue; }
    // centred lines (titles, addresses, signatures) stay lines of their own
    if (isCentered(l)) { flush(); out.push(withRuns({ type: 'p', text: l.text, center: true }, l.runs)); continue; }

    const prevLine: MdLine | null = paraEnd;
    const gap = prevLine ? prevLine.y - l.y : 0;
    const continues = !!prevLine && prevLine.page === l.page && gap > 0 && gap < l.size * 1.9;
    if (continues && !para) {
      // wrapped list item
      const last = out[out.length - 1];
      if (last?.type === 'li') { last.text += ' ' + l.text; if (last.runs) last.runs = joinRuns(last.runs, l.runs, ' '); paraEnd = l; continue; }
    }
    if (!continues || !para) {
      flush();
      para = withRuns({ type: 'p' as const, text: l.text }, l.runs);
    } else if (/[A-Za-z]-$/.test(para.text)) {
      para.text = para.text.slice(0, -1) + l.text; // re-join hyphenated words
      if (para.runs) { const last = para.runs[para.runs.length - 1]; if (last) last.text = last.text.slice(0, -1); para.runs = joinRuns(para.runs, l.runs, ''); }
    } else {
      para.text += ' ' + l.text;
      if (para.runs) para.runs = joinRuns(para.runs, l.runs, ' ');
    }
    paraEnd = l;
  }
  flush();
  return out;
}

export function toMarkdown(lines: MdLine[], opts: { pageBreaks: boolean } = { pageBreaks: false }): string {
  const out: string[] = [];
  for (const b of toBlocks(lines)) {
    if (b.type === 'page') { if (opts.pageBreaks && out.length) out.push('---'); }
    else if (b.type === 'h') out.push('#'.repeat(b.level) + ' ' + b.text);
    else if (b.type === 'li') out.push((b.marker === null ? '- ' : b.marker + ' ') + escapeMd(b.text));
    else out.push(escapeMd(b.text));
  }
  const isItem = (b: string) => /^(- |\d+\. |[a-zA-Z][.)] )/.test(b);
  let text = out[0] ?? '';
  for (let i = 1; i < out.length; i++) text += (isItem(out[i - 1]) && isItem(out[i]) ? '\n' : '\n\n') + out[i];
  return text.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
