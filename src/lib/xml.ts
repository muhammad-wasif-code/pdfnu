/**
 * Tiny XML → tree parser for Office Open XML parts. Works the same in browsers, workers and Node
 * (no DOMParser), and is fast enough for sheets with hundreds of thousands of cells.
 * Element and attribute names are stored without their namespace prefix (`r:id` → `id`).
 */
export interface XNode { n: string; a: Record<string, string>; c: XNode[]; t: string; }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') { const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return ''; } }
    return ENT[e] ?? m;
  });
}
const local = (name: string) => { const i = name.indexOf(':'); return i < 0 ? name : name.slice(i + 1); };
const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(src: string): XNode {
  const root: XNode = { n: '#root', a: {}, c: [], t: '' };
  const stack: XNode[] = [root];
  let i = 0;
  const len = src.length;
  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i && stack.length > 1) stack[stack.length - 1].t += decode(src.slice(i, lt));
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); i = e < 0 ? len : e + 2; continue; }
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); i = e < 0 ? len : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); const end = e < 0 ? len : e; stack[stack.length - 1].t += src.slice(lt + 9, end); i = end + 3; continue; }
    if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); i = e < 0 ? len : e + 1; continue; }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt);
      if (stack.length > 1) stack.pop();
      i = e < 0 ? len : e + 1; continue;
    }
    // start tag: find its end, skipping '>' inside quoted attribute values
    let j = lt + 1, q = '';
    for (; j < len; j++) { const ch = src[j]; if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; }
    const selfClose = src[j - 1] === '/';
    const body = src.slice(lt + 1, selfClose ? j - 1 : j);
    const sp = body.search(/[\s/]/);
    const name = local(sp < 0 ? body : body.slice(0, sp));
    const node: XNode = { n: name, a: {}, c: [], t: '' };
    if (sp >= 0) { ATTR.lastIndex = sp; let m: RegExpExecArray | null; while ((m = ATTR.exec(body))) node.a[local(m[1])] = decode(m[2] ?? m[3] ?? ''); }
    stack[stack.length - 1].c.push(node);
    if (!selfClose) stack.push(node);
    i = j + 1;
  }
  return root.c[0] ?? root;
}

export const kids = (el: XNode | undefined, name?: string): XNode[] => (el ? (name ? el.c.filter((c) => c.n === name) : el.c) : []);
export const kid = (el: XNode | undefined, name: string): XNode | undefined => el?.c.find((c) => c.n === name);
/** All descendants with a name (depth first). */
export function find(el: XNode | undefined, name: string, out: XNode[] = []): XNode[] {
  if (!el) return out;
  for (const c of el.c) { if (c.n === name) out.push(c); find(c, name, out); }
  return out;
}
