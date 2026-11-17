/** PDF text layer → Markdown, using font size for headings and simple patterns for lists. */

export interface MdLine { text: string; size: number; y: number; x: number; page: number; }

/** Read lines (with font size and position) from a pdf.js document. */
export async function readLines(pdf: any, onPage?: (n: number, of: number) => void): Promise<MdLine[]> {
  const lines: MdLine[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onPage?.(n, pdf.numPages);
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    let cur: MdLine | null = null;
    let lastEOL = false;
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string') continue;
      const [a, b, c, d, x, y] = it.transform;
      const size = Math.round(Math.hypot(c, d) * 10) / 10 || Math.hypot(a, b);
      if (!it.str.trim()) { if (it.hasEOL) lastEOL = true; if (cur && it.str) cur.text += ' '; continue; }
      if (!cur || lastEOL || Math.abs(y - cur.y) > Math.max(size, cur.size) * 0.5) {
        if (cur) lines.push(cur);
        cur = { text: it.str, size, y, x, page: n - 1 };
      } else {
        cur.text += it.str;
        cur.size = Math.max(cur.size, size);
      }
      lastEOL = !!it.hasEOL;
    }
    if (cur) lines.push(cur);
    page.cleanup();
  }
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text);
}

const BULLET = /^([•●▪◦‣∙·○■□➢►]\s*|[-–—*]\s+)/;
const NUMBERED = /^(\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+/;

function escapeMd(s: string) {
  return s.replace(/^([#>])/, '\\$1').replace(/^(\d+)\.(\s)/, '$1\\.$2');
}

export function toMarkdown(lines: MdLine[], opts: { pageBreaks: boolean } = { pageBreaks: false }): string {
  if (!lines.length) return '';
  // body size = the size used by most characters
  const weight = new Map<number, number>();
  for (const l of lines) weight.set(l.size, (weight.get(l.size) ?? 0) + l.text.length);
  const body = [...weight.entries()].sort((p, q) => q[1] - p[1])[0][0];
  const headingSizes = [...new Set(lines.filter((l) => l.size >= body * 1.15 && l.text.length <= 140).map((l) => l.size))].sort((p, q) => q - p);
  const level = (s: number) => Math.min(headingSizes.indexOf(s) + 1, 4);

  const out: string[] = [];
  let para = '';
  let paraEnd: MdLine | null = null;
  const flush = () => { if (para) out.push(para); para = ''; paraEnd = null; };
  let page = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.page !== page) { flush(); if (opts.pageBreaks) out.push('---'); page = l.page; }
    if (/^\d{1,4}$/.test(l.text) || /^page \d+( of \d+)?$/i.test(l.text)) continue; // page numbers
    if (headingSizes.includes(l.size)) {
      flush();
      const prev = out[out.length - 1];
      const h = '#'.repeat(level(l.size)) + ' ';
      // a heading broken over two lines with the same size: join them
      if (prev?.startsWith(h) && lines[i - 1]?.size === l.size && lines[i - 1]?.page === l.page) out[out.length - 1] = prev + ' ' + l.text;
      else out.push(h + l.text);
      continue;
    }
    if (BULLET.test(l.text) && l.text.length > 2) { flush(); out.push('- ' + escapeMd(l.text.replace(BULLET, ''))); paraEnd = l; continue; }
    if (NUMBERED.test(l.text)) { flush(); const m = l.text.match(NUMBERED)![1].replace(/[()]/g, ''); out.push(`${/^\d/.test(m) ? m.replace(')', '.') : m} ${escapeMd(l.text.replace(NUMBERED, ''))}`); paraEnd = l; continue; }

    const prevLine: MdLine | null = paraEnd;
    const gap = prevLine ? prevLine.y - l.y : 0;
    const continues = !!prevLine && prevLine.page === l.page && gap > 0 && gap < l.size * 1.9;
    if (continues && !para) {
      // wrapped list item
      const last = out[out.length - 1];
      if (last && (last.startsWith('- ') || /^(\d+|[a-zA-Z])[.)] /.test(last))) { out[out.length - 1] = last + ' ' + l.text; paraEnd = l; continue; }
    }
    if (!continues || !para) {
      flush();
      para = escapeMd(l.text);
    } else if (/[A-Za-z]-$/.test(para)) {
      para = para.slice(0, -1) + l.text; // re-join hyphenated words
    } else {
      para += ' ' + l.text;
    }
    paraEnd = l;
  }
  flush();
  const isItem = (b: string) => /^(- |\d+\. |[a-zA-Z][.)] )/.test(b);
  let text = out[0] ?? '';
  for (let i = 1; i < out.length; i++) text += (isItem(out[i - 1]) && isItem(out[i]) ? '\n' : '\n\n') + out[i];
  return text.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
