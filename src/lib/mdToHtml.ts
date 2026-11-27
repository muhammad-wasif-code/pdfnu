/**
 * Markdown → HTML (CommonMark essentials + GitHub extras: tables, task lists, strikethrough,
 * fenced code, autolinks). Raw HTML is passed through (the page is rendered without scripts).
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** Inline formatting: code, images, links, emphasis, strikethrough, autolinks, line breaks. */
export function inline(src: string): string {
  const codes: string[] = [];
  let s = src.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _t, code) => { codes.push(`<code>${esc(code.trim())}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  // keep raw inline HTML tags, escape the rest
  const tags: string[] = [];
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, (m) => { tags.push(m); return `\u0001${tags.length - 1}\u0001`; });
  s = s.replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (_m, alt, url, title) => `<img src="${attr(url)}" alt="${attr(alt)}"${title ? ` title="${attr(title)}"` : ''}>`);
  s = s.replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (_m, text, url, title) => `<a href="${attr(url)}"${title ? ` title="${attr(title)}"` : ''}>${text}</a>`);
  s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<)]+[^\s<).,;:!?'"])/g, (_m, pre, url) => `${pre}<a href="${attr(url.startsWith('www.') ? 'https://' + url : url)}">${url}</a>`);
  s = s.replace(/(^|[\s(])([\w.+-]+@[\w-]+\.[\w.-]+[a-z])/gi, (_m, pre, mail) => `${pre}<a href="mailto:${attr(mail)}">${mail}</a>`);
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  s = s.replace(/(^|[^*\w])\*(?=\S)([\s\S]*?\S)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_(?=\S)([\s\S]*?\S)_(?![_\w])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  s = s.replace(/(?: {2,}|\\)\n/g, '<br>\n');
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i) => tags[+i]).replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[+i]);
  return s;
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out: string[] = [];
  let i = 0;
  const para: string[] = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join('\n'))}</p>`); para.length = 0; } };

  // front matter
  if (lines[0] === '---') { const end = lines.indexOf('---', 1); if (end > 0 && end < 40) i = end + 1; }

  while (i < lines.length) {
    const l = lines[i];
    // fenced code
    const fence = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)/.exec(l);
    if (fence) {
      flushPara();
      const close = fence[2][0];
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*\\${close}{${fence[2].length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[3] ? ` class="language-${attr(fence[3])}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (!l.trim()) { flushPara(); i++; continue; }
    // ATX heading
    const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) { flushPara(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    // setext heading
    if (para.length === 0 && i + 1 < lines.length && /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1]) && l.trim() && !/^\s*[-*+]\s/.test(l)) {
      const lv = lines[i + 1].trim()[0] === '=' ? 1 : 2;
      out.push(`<h${lv}>${inline(l.trim())}</h${lv}>`); i += 2; continue;
    }
    // horizontal rule
    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { flushPara(); out.push('<hr>'); i++; continue; }
    // table
    if (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      const head = cells(l);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      const a = (k: number) => (align[k] ? ` style="text-align:${align[k]}"` : '');
      let html = `<table><thead><tr>${head.map((c, k) => `<th${a(k)}>${inline(c)}</th>`).join('')}</tr></thead><tbody>`;
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { html += `<tr>${cells(lines[i]).map((c, k) => `<td${a(k)}>${inline(c)}</td>`).join('')}</tr>`; i++; }
      out.push(html + '</tbody></table>');
      continue;
    }
    // blockquote
    if (/^ {0,3}>/.test(l)) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (lines[i].trim() && q.length && !/^\s*$/.test(lines[i - 1] ?? '')))) { q.push(lines[i].replace(/^ {0,3}> ?/, '')); i++; }
      out.push(`<blockquote>${mdToHtml(q.join('\n'))}</blockquote>`);
      continue;
    }
    // lists (nested by indentation)
    const li = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(l);
    if (li) {
      flushPara();
      const { html, next } = list(lines, i);
      out.push(html); i = next; continue;
    }
    // raw HTML block
    if (/^\s*<(div|table|section|figure|details|p|pre|ul|ol|h[1-6]|blockquote|hr|img|center|aside|header|footer|nav|article|style)\b/i.test(l)) {
      flushPara();
      const block: string[] = [];
      while (i < lines.length && lines[i].trim()) block.push(lines[i++]);
      out.push(block.join('\n'));
      continue;
    }
    // indented code (not inside a paragraph)
    if (/^ {4,}/.test(l) && !para.length) {
      const body: string[] = [];
      while (i < lines.length && (/^ {4,}/.test(lines[i]) || !lines[i].trim())) body.push(lines[i++].slice(4));
      while (body.length && !body[body.length - 1].trim()) body.pop();
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    para.push(l.trim() ? l.replace(/^ {1,3}/, '') : l);
    i++;
  }
  flushPara();
  return out.join('\n');
}

function list(lines: string[], start: number): { html: string; next: number } {
  const first = /^(\s*)([-*+]|\d{1,9}[.)])\s+/.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const startNo = ordered ? parseInt(first[2], 10) : 1;
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const body: string[] = [m[3]];
    i++;
    // continuation lines and nested blocks (indented more than the marker)
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { if (i + 1 < lines.length && /^\s+/.test(lines[i + 1]) && (lines[i + 1].match(/^\s*/)![0].length > indent)) { body.push(''); i++; continue; } break; }
      const sub = /^(\s*)([-*+]|\d{1,9}[.)])\s+/.exec(l);
      if (sub && sub[1].length <= indent) break;
      body.push(l.replace(new RegExp(`^\\s{0,${indent + first[2].length + 1}}`), ''));
      i++;
    }
    let text = body.join('\n');
    let task = '';
    const t = /^\[([ xX])\]\s+/.exec(text);
    if (t) { task = `<span class="box">${t[1] !== ' ' ? '☑' : '☐'}</span> `; text = text.slice(t[0].length); }
    const inner = /\n\s*([-*+]|\d+[.)])\s|\n\n/.test(text) ? mdToHtml(text).replace(/^<p>([\s\S]*?)<\/p>/, '$1') : inline(text);
    items.push(`<li${task ? ' class="task"' : ''}>${task}${inner}</li>`);
  }
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}${ordered && startNo !== 1 ? ` start="${startNo}"` : ''}>${items.join('')}</${tag}>`, next: i };
}

/** Readable document styles shared by the text-to-PDF converters. */
export function docCss(o: { font: 'sans' | 'serif' | 'mono'; size: number }) {
  const fam = { sans: 'Arial, Helvetica, sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' }[o.font];
  return `
  html,body{margin:0;padding:0;background:#fff}
  body{font-family:${fam};font-size:${o.size}px;line-height:1.5;color:#1f2328}
  h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.2em 0 .5em;font-weight:700}
  h1{font-size:2em;border-bottom:1px solid #d0d7de;padding-bottom:.3em}h2{font-size:1.5em;border-bottom:1px solid #d0d7de;padding-bottom:.3em}h3{font-size:1.25em}h4{font-size:1em}
  p,ul,ol,blockquote,pre,table{margin:0 0 1em}
  a{color:#0969da;text-decoration:underline}
  code{font-family:"Courier New",Courier,monospace;font-size:.88em;background:#f3f4f6;border-radius:4px;padding:.1em .3em}
  pre{background:#f6f8fa;border:1px solid #e5e7eb;border-radius:6px;padding:12px;white-space:pre-wrap;word-break:break-word}
  pre code{background:none;padding:0;font-size:.85em}
  blockquote{border-left:4px solid #d0d7de;color:#57606a;padding:0 1em;margin-left:0}
  table{border-collapse:collapse;width:auto;max-width:100%}th,td{border:1px solid #d0d7de;padding:6px 12px;text-align:left;vertical-align:top}th{background:#f6f8fa;font-weight:700}
  img{max-width:100%;height:auto}hr{border:0;border-top:2px solid #d0d7de;margin:1.5em 0}
  li.task{list-style:none}li.task .box{display:inline-block;width:1.2em;margin-left:-1.3em}li>ul,li>ol{margin:0}
  h1,h2,h3,h4{break-after:avoid}
  `;
}
