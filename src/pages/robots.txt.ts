import type { APIRoute } from 'astro';
const RULES = `# PDFNU: all public pages may be crawled and used by search and AI search engines.
User-agent: *
Allow: /
Disallow: /__test__/

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /`;
export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() ?? 'https://pdfnu.com/').replace(/\/$/, '');
  return new Response(`${RULES}\nSitemap: ${base}/sitemap-index.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
