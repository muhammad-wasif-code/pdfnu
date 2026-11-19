import type { APIRoute } from 'astro';
const RULES = `# PDFSherpa: all public pages may be crawled and used by search and AI search engines.
# One group for every crawler (a bot that matches a named group ignores the * group).
User-agent: *
User-agent: Googlebot
User-agent: Bingbot
User-agent: Google-Extended
User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: PerplexityBot
User-agent: ClaudeBot
Allow: /
Disallow: /__test__/
Disallow: /cdn-cgi/`;
export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() ?? 'https://pdfsherpa.com/').replace(/\/$/, '');
  return new Response(`${RULES}\nSitemap: ${base}/sitemap-index.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
