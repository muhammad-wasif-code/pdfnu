/**
 * PDF → HTML and PDF → EPUB (browser main thread, pdf.js).
 *  - "exact": one self-contained HTML file; each page is a picture with an invisible, selectable
 *    text layer placed word-exactly on top (searchable, copyable, looks identical).
 *  - "flow": clean semantic HTML (headings, paragraphs, lists, bold/italic) that reflows on any screen.
 * EPUB uses the flow structure, split into chapters at the top headings.
 */
import { openPdf } from './pdfjs';
import { renderPage } from './render';
import { readLines, toBlocks, type Block, type MdRun } from './markdown';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: string) => esc(s).replace(/"/g, '&quot;');
type Progress = (stage: string, done?: number, total?: number) => void;

const runsHtml = (text: string, runs?: MdRun[]) => (runs?.length ? runs.map((r) => { let t = esc(r.text); if (r.b) t = `<strong>${t}</strong>`; if (r.i) t = `<em>${t}</em>`; return t; }).join('') : esc(text));

/** Semantic blocks → HTML body fragments (one string per block, page markers dropped). */
export function blocksToHtml(blocks: Block[], xhtml = false): string[] {
  const out: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => { if (list) { out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`); list = null; } };
  for (const b of blocks) {
    if (b.type === 'page') continue;
    if (b.type === 'li') {
      const tag = b.marker === null ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; }
      list.items.push(`<li>${runsHtml(b.text, b.runs)}</li>`);
      continue;
    }
    flush();
    const center = b.center ? ' class="center"' : '';
    if (b.type === 'h') out.push(`<h${b.level}${center}>${esc(b.text)}</h${b.level}>`);
    else out.push(`<p${center}>${runsHtml(b.text, b.runs)}</p>`);
  }
  flush();
  return xhtml ? out.map((s) => s.replace(/<br>/g, '<br/>')) : out;
}

const FLOW_CSS = `body{font-family:Georgia,"Times New Roman",serif;line-height:1.6;max-width:46em;margin:2em auto;padding:0 1em;color:#1f2328}
h1,h2,h3,h4{font-family:Arial,Helvetica,sans-serif;line-height:1.25}.center{text-align:center}p{margin:0 0 1em}`;

export async function pdfToHtml(bytes: Uint8Array, mode: 'exact' | 'flow', o: { title: string; quality: number; onProgress?: Progress }): Promise<string> {
  const pdf = await openPdf(bytes.slice());
  try {
    let meta = '';
    try { const m: any = await pdf.getMetadata(); meta = (m?.info?.Title ?? '').trim(); } catch { /* no metadata */ }
    const title = meta || o.title;
    if (mode === 'flow') {
      const lines = await readLines(pdf, (n, of) => o.onProgress?.('Reading text…', n, of), { styles: true });
      const body = blocksToHtml(toBlocks(lines)).join('\n');
      return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${FLOW_CSS}</style></head><body>\n${body}\n</body></html>\n`;
    }
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      o.onProgress?.('Drawing pages…', n, pdf.numPages);
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const canvas = await renderPage(pdf, n, o.quality);
      const jpg = canvas.toDataURL('image/jpeg', 0.82);
      canvas.width = canvas.height = 0;
      const tc = await page.getTextContent();
      const spans: string[] = [];
      for (const it of tc.items as any[]) {
        if (!it.str?.trim()) continue;
        // pdf.js item transform → viewport coordinates (y down)
        const [a, b, c, d, e, f] = it.transform;
        const m = vp.transform;
        const x = m[0] * e + m[2] * f + m[4], y = m[1] * e + m[3] * f + m[5];
        const size = Math.hypot(c, d) * vp.scale;
        const angle = (Math.atan2(b, a) * 180) / Math.PI;
        const w = (it.width ?? 0) * vp.scale;
        if (w <= 0 || size <= 0) continue;
        spans.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size.toFixed(2)}" textLength="${w.toFixed(2)}" lengthAdjust="spacingAndGlyphs"${angle ? ` transform="rotate(${(-angle).toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})"` : ''}>${esc(it.str)}</text>`);
      }
      page.cleanup();
      pages.push(`<section class="page" id="page-${n}" style="aspect-ratio:${vp.width.toFixed(2)}/${vp.height.toFixed(2)}"><img src="${jpg}" alt="Page ${n}"><svg viewBox="0 0 ${vp.width.toFixed(2)} ${vp.height.toFixed(2)}" xmlns="http://www.w3.org/2000/svg">${spans.join('')}</svg></section>`);
    }
    const css = `body{margin:0;background:#e5e7eb;font-family:Arial,Helvetica,sans-serif}.page{position:relative;max-width:900px;margin:16px auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}
.page img{display:block;width:100%;height:100%}.page svg{position:absolute;inset:0;width:100%;height:100%}.page text{fill:transparent;font-family:Arial,Helvetica,sans-serif;white-space:pre}
.page text::selection{fill:transparent;background:rgba(37,99,235,.3)}@media print{body{background:#fff}.page{margin:0;box-shadow:none;break-after:page}}`;
    return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body>\n${pages.join('\n')}\n</body></html>\n`;
  } finally { await pdf.destroy(); }
}

/** PDF → EPUB 3 (with an EPUB 2 table of contents for older readers). */
export async function pdfToEpub(bytes: Uint8Array, o: { title: string; author: string; onProgress?: Progress }): Promise<{ epub: Blob; chapters: number }> {
  const pdf = await openPdf(bytes.slice());
  let blocks: Block[];
  let title = o.title, author = o.author;
  try {
    try { const m: any = await pdf.getMetadata(); title = (m?.info?.Title ?? '').trim() || title; author = author || (m?.info?.Author ?? '').trim(); } catch { /* none */ }
    const lines = await readLines(pdf, (n, of) => o.onProgress?.('Reading text…', n, of), { styles: true });
    blocks = toBlocks(lines);
  } finally { await pdf.destroy(); }
  // chapters start at the largest heading level that occurs more than once (else every h1/h2)
  const levels = [1, 2, 3].filter((l) => blocks.filter((b) => b.type === 'h' && b.level === l).length >= 2);
  const split = levels[0] ?? 1;
  const chapters: { title: string; blocks: Block[] }[] = [];
  for (const b of blocks) {
    if (b.type === 'h' && b.level <= split) chapters.push({ title: b.text, blocks: [b] });
    else { if (!chapters.length) chapters.push({ title, blocks: [] }); chapters[chapters.length - 1].blocks.push(b); }
  }
  const nonEmpty = chapters.filter((c) => c.blocks.some((b) => b.type !== 'page'));
  if (!nonEmpty.length) throw new Error('NO_TEXT');
  const { default: JSZip } = await import('jszip');
  const z = new JSZip();
  const id = `urn:uuid:${crypto.randomUUID?.() ?? Date.now().toString(36)}`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/style.css', 'body{font-family:serif;line-height:1.5;margin:0 .5em}h1,h2,h3,h4{font-family:sans-serif;line-height:1.2;page-break-after:avoid}p{margin:0 0 .8em;text-indent:0}.center{text-align:center}');
  const xhtml = (t: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="UTF-8"/><title>${esc(t)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>\n${body}\n</body></html>\n`;
  nonEmpty.forEach((c, i) => z.file(`OEBPS/ch${i + 1}.xhtml`, xhtml(c.title, blocksToHtml(c.blocks, true).join('\n'))));
  z.file('OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${nonEmpty.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${esc(c.title)}</a></li>`).join('')}</ol></nav>`));
  z.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${attr(id)}"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${nonEmpty.map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="ch${i + 1}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`);
  z.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${esc(id)}</dc:identifier><dc:title>${esc(title)}</dc:title>${author ? `<dc:creator>${esc(author)}</dc:creator>` : ''}<dc:language>${/[؀-ۿ]/.test(title) ? 'ur' : 'en'}</dc:language><meta property="dcterms:modified">${now}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${nonEmpty.map((_, i) => `<item id="c${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine toc="ncx">${nonEmpty.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`);
  const epub = await z.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
  return { epub, chapters: nonEmpty.length };
}
