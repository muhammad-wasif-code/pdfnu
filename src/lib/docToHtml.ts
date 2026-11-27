/**
 * Documents → HTML for the HTML-to-PDF engine: OpenDocument Text (.odt) and EPUB e-books.
 * Both are zip packages; pictures are returned as named assets that the HTML refers to.
 */
import { parseXml, kid, kids, find, type XNode } from './xml';

export interface HtmlDoc { html: string; assets: Map<string, Blob>; title: string; css: string; }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: string) => esc(s).replace(/"/g, '&quot;');
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };
const mimeOf = (p: string) => MIME[(p.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream';

async function openZip(bytes: Uint8Array) {
  const { default: JSZip } = await import('jszip');
  try { return await JSZip.loadAsync(bytes); } catch { throw new Error('NOT_ZIP'); }
}

// ───────────────────────── ODT ─────────────────────────

/** XML → XNode tree that keeps text nodes in order (as '#text' children). */
function domTree(src: string): XNode | null {
  const d = new DOMParser().parseFromString(src, 'application/xml');
  if (d.querySelector('parsererror')) return null;
  const conv = (el: Element): XNode => {
    const a: Record<string, string> = {};
    for (const at of Array.from(el.attributes)) a[at.localName] = at.value;
    const c: XNode[] = [];
    for (const ch of Array.from(el.childNodes)) {
      if (ch.nodeType === 1) c.push(conv(ch as Element));
      else if (ch.nodeType === 3 || ch.nodeType === 4) c.push({ n: '#text', a: {}, c: [], t: ch.nodeValue ?? '' });
    }
    return { n: el.localName, a, c, t: el.textContent ?? '' };
  };
  return conv(d.documentElement);
}

interface OStyle { css: string; parent?: string; breakBefore?: boolean; list?: string; }

/** OpenDocument text → HTML with headings, paragraphs, character styles, lists, tables, images, links. */
export async function odtToHtml(bytes: Uint8Array): Promise<HtmlDoc> {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('OLE_FILE');
  const zip = await openZip(bytes);
  // mixed content (text between spans) needs document order, so ODT XML goes through DOMParser
  const read = async (p: string) => { const f = zip.file(p); return f ? domTree(await f.async('string')) : null; };
  const content = await read('content.xml');
  if (!content) throw new Error('NOT_ODT');
  const stylesX = await read('styles.xml');
  const meta = await read('meta.xml');
  const title = find(meta ?? undefined, 'title')[0]?.t?.trim() ?? '';

  // styles (named + automatic) → CSS
  const styles = new Map<string, OStyle>();
  const listStyles = new Map<string, Map<number, 'bullet' | string>>();
  const collect = (root: XNode | null) => {
    if (!root) return;
    for (const st of find(root, 'style')) {
      const name = st.a.name; if (!name) continue;
      const tp = kid(st, 'text-properties')?.a ?? {}, pp = kid(st, 'paragraph-properties')?.a ?? {}, cp = kid(st, 'table-cell-properties')?.a ?? {};
      const css: string[] = [];
      if (tp['font-weight'] === 'bold' || +tp['font-weight'] >= 600) css.push('font-weight:700');
      if (tp['font-style'] === 'italic') css.push('font-style:italic');
      const deco = [tp['text-underline-style'] && tp['text-underline-style'] !== 'none' ? 'underline' : '', tp['text-line-through-style'] && tp['text-line-through-style'] !== 'none' ? 'line-through' : ''].filter(Boolean);
      if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
      if (tp.color) css.push(`color:${tp.color}`);
      if (tp['background-color'] && tp['background-color'] !== 'transparent') css.push(`background-color:${tp['background-color']}`);
      if (tp['font-size'] && /pt$/.test(tp['font-size'])) css.push(`font-size:${(parseFloat(tp['font-size']) * 4) / 3}px`);
      if (tp['font-size'] && /%$/.test(tp['font-size'])) css.push(`font-size:${tp['font-size']}`);
      if (tp['font-name'] || tp['font-family']) css.push(`font-family:'${(tp['font-family'] ?? tp['font-name']).replace(/['"]/g, '')}'`);
      if (tp['text-position']) { const v = tp['text-position']; if (/^super/.test(v) || /^\d/.test(v) && parseFloat(v) > 0) css.push('vertical-align:super;font-size:.7em'); else if (/^sub|^-/.test(v)) css.push('vertical-align:sub;font-size:.7em'); }
      if (pp['text-align']) css.push(`text-align:${pp['text-align'] === 'end' ? 'right' : pp['text-align'] === 'start' ? 'left' : pp['text-align']}`);
      for (const [k, c] of [['margin-left', 'margin-left'], ['margin-right', 'margin-right'], ['margin-top', 'margin-top'], ['margin-bottom', 'margin-bottom'], ['text-indent', 'text-indent']]) if (pp[k]) css.push(`${c}:${pp[k]}`);
      if (pp['line-height'] && /%$/.test(pp['line-height'])) css.push(`line-height:${parseFloat(pp['line-height']) / 100}`);
      if (pp['background-color'] && pp['background-color'] !== 'transparent') css.push(`background-color:${pp['background-color']}`);
      if (cp['background-color'] && cp['background-color'] !== 'transparent') css.push(`background-color:${cp['background-color']}`);
      for (const side of ['border', 'border-top', 'border-bottom', 'border-left', 'border-right']) { const v = cp[side] ?? pp[side]; if (v && v !== 'none') css.push(`${side}:${v}`); }
      if (cp.padding) css.push(`padding:${cp.padding}`);
      styles.set(name, { css: css.join(';'), parent: st.a['parent-style-name'], breakBefore: pp['break-before'] === 'page', list: st.a['list-style-name'] });
    }
    for (const ls of find(root, 'list-style')) {
      const m = new Map<number, 'bullet' | string>();
      for (const lv of ls.c) m.set(+(lv.a.level ?? 1), lv.n === 'list-level-style-bullet' ? 'bullet' : lv.a['num-format'] || '1');
      if (ls.a.name) listStyles.set(ls.a.name, m);
    }
  };
  collect(stylesX); collect(content);
  const cssOf = (name?: string, depth = 0): string => { if (!name || depth > 8) return ''; const s = styles.get(name); return s ? [cssOf(s.parent, depth + 1), s.css].filter(Boolean).join(';') : ''; };
  const headingName = (name?: string) => /heading|title/i.test(name ?? '') || /heading|title/i.test(styles.get(name ?? '')?.parent ?? '');

  const assets = new Map<string, Blob>();
  const img = async (href: string) => {
    if (assets.has(href)) return href;
    const f = zip.file(href);
    if (!f) return null;
    assets.set(href, new Blob([await f.async('uint8array') as BlobPart], { type: mimeOf(href) }));
    return href;
  };

  const runs = async (el: XNode): Promise<string> => {
    let s = '';
    for (const c of el.c) {
      if (c.n === '#text') { s += esc(c.t); continue; }
      switch (c.n) {
        case 'span': { const css = cssOf(c.a['style-name']); const inner = await runs(c); s += css ? `<span style="${attr(css)}">${inner}</span>` : inner; break; }
        case 'a': s += `<a href="${attr(c.a.href ?? '')}">${await runs(c)}</a>`; break;
        case 's': s += ' '.repeat(+(c.a.c ?? 1)); break;
        case 'tab': s += ' '; break;
        case 'line-break': s += '<br>'; break;
        case 'note': { const body = kid(c, 'note-body'); s += `<sup>${await runs(kid(c, 'note-citation') ?? { n: 'x', a: {}, c: [], t: '*' })}</sup>`; if (body) footnotes.push(await blocks(body)); break; }
        case 'frame': {
          const im = kid(c, 'image');
          const href = im?.a.href;
          const w = c.a.width, h = c.a.height;
          if (href && !/^https?:/.test(href)) { const k = await img(href); if (k) s += `<img src="${attr(k)}" style="${w ? `width:${w};` : ''}${h ? `height:${h};` : ''}max-width:100%">`; }
          const tb = kid(c, 'text-box');
          if (tb) s += `<span style="display:inline-block">${await blocks(tb)}</span>`;
          break;
        }
        case 'bookmark': case 'bookmark-start': case 'bookmark-end': case 'soft-page-break': case 'sequence-decls': break;
        default: s += await runs(c);
      }
    }
    return s;
  };
  const footnotes: string[] = [];
  let listDepth = 0;
  const blocks = async (el: XNode): Promise<string> => {
    let s = '';
    for (const c of el.c) {
      const st = styles.get(c.a['style-name'] ?? '');
      const pb = st?.breakBefore ? 'break-before:page;' : '';
      if (c.n === 'h' || (c.n === 'p' && headingName(c.a['style-name']))) {
        const lv = Math.min(6, +(c.a['outline-level'] ?? (/title/i.test(c.a['style-name'] ?? '') ? 1 : 2)));
        s += `<h${lv} style="${attr(pb + cssOf(c.a['style-name']))}">${await para(c)}</h${lv}>`;
      } else if (c.n === 'p') {
        const inner = await para(c);
        s += `<p style="${attr(pb + cssOf(c.a['style-name']))}">${inner || '&nbsp;'}</p>`;
      } else if (c.n === 'list') {
        const lsName = c.a['style-name'] ?? styles.get(kid(kid(c, 'list-item'), 'p')?.a['style-name'] ?? '')?.list;
        const fmt = lsName ? listStyles.get(lsName)?.get(listDepth + 1) : 'bullet';
        const ordered = fmt && fmt !== 'bullet';
        const type = ordered ? ({ a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' } as Record<string, string>)[fmt as string] ?? 'decimal' : 'disc';
        listDepth++;
        let items = '';
        for (const it of kids(c, 'list-item')) items += `<li>${await blocks(it)}</li>`;
        for (const it of kids(c, 'list-header')) items += `<li style="list-style:none">${await blocks(it)}</li>`;
        listDepth--;
        s += `<${ordered ? 'ol' : 'ul'} style="list-style-type:${type}">${items}</${ordered ? 'ol' : 'ul'}>`;
      } else if (c.n === 'table') {
        let rows = '';
        const rowEls = [...kids(c, 'table-row'), ...kids(kid(c, 'table-header-rows'), 'table-row'), ...find(c, 'table-rows').flatMap((r) => kids(r, 'table-row'))];
        const header = kids(kid(c, 'table-header-rows'), 'table-row');
        for (const r of [...header, ...rowEls.filter((x) => !header.includes(x))]) {
          let cellsHtml = '';
          for (const cell of r.c) {
            if (cell.n !== 'table-cell') continue;
            const span = cell.a['number-columns-spanned'], rs = cell.a['number-rows-spanned'];
            cellsHtml += `<td${span ? ` colspan="${span}"` : ''}${rs ? ` rowspan="${rs}"` : ''} style="${attr(cssOf(cell.a['style-name']))}">${await blocks(cell)}</td>`;
          }
          rows += `<tr>${cellsHtml}</tr>`;
        }
        s += `<table class="odt">${rows}</table>`;
      } else if (c.n === 'section' || c.n === 'text-box' || c.n === 'index-body' || c.n === 'table-of-content' || c.n === 'alphabetical-index') {
        s += await blocks(c.n === 'table-of-content' ? kid(c, 'index-body') ?? c : c);
      } else if (c.n === 'frame') {
        s += `<p>${await runs({ n: 'x', a: {}, c: [c], t: '' })}</p>`;
      }
    }
    return s;
  };
  const para = (p: XNode) => runs(p);

  const body = kid(kid(content, 'body'), 'text');
  if (!body) throw new Error('NOT_ODT');
  let html = await blocks(body);
  if (footnotes.length) html += `<hr><ol class="notes">${footnotes.map((f) => `<li>${f}</li>`).join('')}</ol>`;
  const css = 'p{margin:0 0 .35em}table.odt{border-collapse:collapse;margin:0 0 1em}table.odt td{vertical-align:top;padding:4px 6px}ol.notes{font-size:.85em}';
  return { html, assets, title, css };
}

// ───────────────────────── EPUB ─────────────────────────

function resolve(base: string, href: string) {
  const parts = base.split('/').slice(0, -1);
  for (const seg of decodeURIComponent(href.split('#')[0]).split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  return parts.join('/');
}

/** EPUB 2/3 → one HTML document: chapters in reading order, each on a new page, with the book’s CSS and pictures. */
export async function epubToHtml(bytes: Uint8Array, opts: { publisherCss: boolean }): Promise<HtmlDoc & { chapters: number }> {
  const zip = await openZip(bytes);
  const text = async (p: string) => { const f = zip.file(p) ?? zip.file(decodeURIComponent(p)); return f ? await f.async('string') : null; };
  const container = await text('META-INF/container.xml');
  const opfPath = container ? find(parseXml(container), 'rootfile')[0]?.a['full-path'] : undefined;
  const opfSrc = opfPath ? await text(opfPath) : null;
  if (!opfPath || !opfSrc) throw new Error('NOT_EPUB');
  if (zip.file('META-INF/encryption.xml') && /EncryptedData/.test((await text('META-INF/encryption.xml')) ?? '') && !/obfuscation|font/i.test((await text('META-INF/encryption.xml')) ?? '')) throw new Error('DRM');
  const opf = parseXml(opfSrc);
  const title = find(opf, 'title')[0]?.t?.trim() ?? '';
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const it of find(opf, 'item')) manifest.set(it.a.id, { href: resolve(opfPath, it.a.href ?? ''), type: it.a['media-type'] ?? '', props: it.a.properties ?? '' });
  const spine = find(opf, 'itemref').filter((r) => r.a.linear !== 'no').map((r) => manifest.get(r.a.idref)).filter((m): m is { href: string; type: string; props: string } => !!m && /html/.test(m.type));
  if (!spine.length) throw new Error('NOT_EPUB');

  const assets = new Map<string, Blob>();
  const cssParts: string[] = [];
  const cssSeen = new Set<string>();
  const parser = new DOMParser();
  let html = '';
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    const src = await text(item.href);
    if (!src) continue;
    const d = parser.parseFromString(src, /xhtml|xml/.test(item.type) ? 'application/xhtml+xml' : 'text/html');
    const doc = d.querySelector('parsererror') ? parser.parseFromString(src, 'text/html') : d;
    if (opts.publisherCss) {
      for (const l of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
        const p = resolve(item.href, l.getAttribute('href')!);
        if (cssSeen.has(p)) continue; cssSeen.add(p);
        let css = (await text(p)) ?? '';
        // url() inside the stylesheet → asset keys
        css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m, _q, ref) => (/^(data|https?):/.test(ref) ? _m : `url("${resolve(p, ref)}")`));
        cssParts.push(css.replace(/@font-face\s*{[^}]*}/g, ''));
      }
      for (const st of Array.from(doc.querySelectorAll('style'))) cssParts.push(st.textContent ?? '');
    }
    const body = doc.querySelector('body');
    if (!body) continue;
    // pictures: <img src>, SVG <image href>, and links to them
    for (const el of Array.from(body.querySelectorAll('img[src], image'))) {
      const a = el.localName === 'img' ? 'src' : el.hasAttribute('href') ? 'href' : 'xlink:href';
      const ref = el.getAttribute(a) ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!ref || /^(data|https?):/.test(ref)) continue;
      const p = resolve(item.href, ref);
      const f = zip.file(p);
      if (!f) continue;
      if (!assets.has(p)) assets.set(p, new Blob([await f.async('uint8array') as BlobPart], { type: mimeOf(p) }));
      if (el.localName === 'image') {
        // SVG cover pages: turn into a plain <img>
        const im = doc.createElement('img'); im.setAttribute('src', p); im.setAttribute('style', 'max-width:100%;max-height:100%');
        el.closest('svg')?.replaceWith(im);
      } else el.setAttribute('src', p);
    }
    // internal links can't jump between chapters in this flat copy: keep external ones only
    for (const a of Array.from(body.querySelectorAll('a[href]'))) if (!/^(https?:|mailto:)/.test(a.getAttribute('href')!)) a.removeAttribute('href');
    body.querySelectorAll('script').forEach((s) => s.remove());
    const cls = body.getAttribute('class');
    html += `<section class="chapter${cls ? ' ' + attr(cls) : ''}"${i ? ' style="break-before:page"' : ''}>${body.innerHTML}</section>\n`;
  }
  return { html, assets, title, css: cssParts.join('\n'), chapters: spine.length };
}

/** Plain text → HTML (keeps line breaks and spacing; long lines wrap). */
export function textToHtml(text: string): string {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  // form feed = page break (used by many old reports)
  return t.split('\f').map((part, i) => `<pre class="plain"${i ? ' style="break-before:page"' : ''}>${esc(part)}</pre>`).join('');
}
