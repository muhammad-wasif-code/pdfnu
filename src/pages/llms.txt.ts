import type { APIRoute } from 'astro';
import { tools, categories } from '../data/tools';
import { landings } from '../data/landings';
import { guides } from '../data/guides';
import { CONTACT_EMAIL, SOURCE_URL } from '../data/site';

/** /llms.txt: a plain-text map of the site for AI assistants (https://llmstxt.org). Built from the same data as the pages. */
export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() ?? 'https://pdfsherpa.com/').replace(/\/$/, '');
  const lines: string[] = [
    '# PDFSherpa',
    '',
    '> PDFSherpa is a free, open-source (AGPL-3.0) set of PDF and image tools that run entirely in the web browser.',
    '> Files are processed on the user’s own device with JavaScript and WebAssembly and are never uploaded to a server.',
    '',
    'Key facts:',
    '- Price: free. No signup, no watermark, no daily task limits. Supported by a few ads that never see files.',
    '- Privacy: files never leave the device; the tools keep working offline after the first visit.',
    '- File size: no fixed limit; the practical limit is the device’s memory.',
    '- Works on phones and computers in recent Chrome, Edge, Safari, Firefox and Samsung Internet.',
    '- Will not crack passwords: Unlock PDF only removes a password the user already knows.',
    `- Source code: ${SOURCE_URL}`,
    `- Contact: ${CONTACT_EMAIL}`,
    '',
  ];
  for (const c of categories) {
    const list = tools.filter((t) => t.category === c.name);
    if (!list.length) continue;
    lines.push(`## ${c.name} tools`, '');
    for (const t of list) lines.push(`- [${t.name}](${base}/${t.slug}): ${t.tagline}`);
    lines.push('');
  }
  lines.push('## Preset tools (one-click settings)', '');
  for (const l of landings) lines.push(`- [${l.h1}](${base}/${l.slug}): ${l.description}`);
  lines.push('', '## Guides', '');
  for (const g of guides) lines.push(`- [${g.title}](${base}/guides/${g.slug}): ${g.description}`);
  lines.push(
    '',
    '## About',
    '',
    `- [About PDFSherpa](${base}/about): how the in-browser tools work and why files stay private`,
    `- [PDFSherpa vs iLovePDF](${base}/ilovepdf-alternative): a fact-checked comparison`,
    `- [Privacy policy](${base}/privacy)`,
    `- [Terms of use](${base}/terms)`,
    '',
  );
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
