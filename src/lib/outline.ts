/** Reading bookmarks and finding headings with pdf.js (browser main thread). */
import { openPdf } from './pdfjs';
import type { Bookmark } from './pdfOps';

/** Flattened outline in reading order, with resolved page numbers (0-based). */
export async function readOutline(bytes: Uint8Array): Promise<Bookmark[]> {
  const pdf = await openPdf(bytes.slice());
  try {
    const tree = (await pdf.getOutline()) ?? [];
    const out: Bookmark[] = [];
    const pageOf = async (dest: any): Promise<number | null> => {
      try {
        const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
        if (!Array.isArray(d) || !d[0]) return null;
        return typeof d[0] === 'number' ? d[0] : await pdf.getPageIndex(d[0]);
      } catch { return null; }
    };
    const walk = async (items: any[], level: number) => {
      for (const it of items) {
        const page = await pageOf(it.dest);
        out.push({ title: (it.title ?? '').trim() || 'Untitled', page: page ?? (out.length ? out[out.length - 1].page : 0), level });
        if (it.items?.length) await walk(it.items, level + 1);
      }
    };
    await walk(tree, 0);
    return out;
  } finally { await pdf.destroy(); }
}

/**
 * Headings guessed from text size: lines clearly larger (or bold and larger) than the body text.
 * Up to three levels, largest first. Repeated lines (running headers) are ignored.
 */
export async function detectHeadings(bytes: Uint8Array, onProgress?: (d: number, t: number) => void): Promise<Bookmark[]> {
  const pdf = await openPdf(bytes.slice());
  try {
    type L = { text: string; size: number; page: number; y: number; bold: boolean };
    const lines: L[] = [];
    const sizeChars = new Map<number, number>();
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const styles = tc.styles as Record<string, { fontFamily: string }>;
      let cur: L | null = null;
      for (const it of tc.items as any[]) {
        if (!('str' in it)) continue;
        const size = Math.round(Math.hypot(it.transform[2], it.transform[3]) * 2) / 2;
        const y = Math.round(it.transform[5]);
        if (it.str.trim()) sizeChars.set(size, (sizeChars.get(size) ?? 0) + it.str.length);
        const bold = /bold|black|heavy|semibold/i.test(it.fontName + ' ' + (styles[it.fontName]?.fontFamily ?? ''));
        if (cur && Math.abs(cur.y - y) < size * 0.5 && Math.abs(cur.size - size) < 0.6) { cur.text += (it.hasEOL ? ' ' : '') + it.str; }
        else { if (cur) lines.push(cur); cur = { text: it.str, size, page: p - 1, y, bold }; }
        if (it.hasEOL && cur) { lines.push(cur); cur = null; }
      }
      if (cur) lines.push(cur);
      page.cleanup();
      onProgress?.(p, pdf.numPages);
    }
    const body = [...sizeChars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
    const seen = new Map<string, number>();
    for (const l of lines) { const k = l.text.trim().toLowerCase(); seen.set(k, (seen.get(k) ?? 0) + 1); }
    const cands = lines.filter((l) => {
      const t = l.text.trim();
      if (t.length < 2 || t.length > 120 || /^[\d\s.\-–|/]+$/.test(t)) return false;
      if ((seen.get(t.toLowerCase()) ?? 0) > Math.max(2, pdf.numPages / 3)) return false; // running header/footer
      return l.size >= body * 1.18 || (l.bold && l.size >= body * 1.05 && t.length < 80);
    });
    // merge consecutive lines of the same heading (wrapped titles)
    const merged: L[] = [];
    for (const l of cands) {
      const prev = merged[merged.length - 1];
      if (prev && prev.page === l.page && prev.size === l.size && prev.y - l.y > 0 && prev.y - l.y < l.size * 1.6) prev.text += ' ' + l.text.trim();
      else merged.push({ ...l, text: l.text.trim() });
    }
    const sizes = [...new Set(merged.map((l) => l.size))].sort((a, b) => b - a).slice(0, 3);
    const list = merged.filter((l) => sizes.includes(l.size) || l.bold).slice(0, 500)
      .map((l) => ({ title: l.text.replace(/\s+/g, ' '), page: l.page, level: Math.max(0, sizes.indexOf(l.size) === -1 ? sizes.length - 1 : sizes.indexOf(l.size)) }));
    // levels may only go one step deeper than the entry above, and the first entry is top level
    list.forEach((b, i) => { b.level = i === 0 ? 0 : Math.min(b.level, list[i - 1].level + 1); });
    return list;
  } finally { await pdf.destroy(); }
}
