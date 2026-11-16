import type { APIRoute } from 'astro';
/** ads.txt authorises Google to sell ads on this domain. Generated from PUBLIC_ADSENSE_CLIENT. */
export const GET: APIRoute = () => {
  const client = (import.meta.env.PUBLIC_ADSENSE_CLIENT as string | undefined) ?? '';
  const pub = client.replace(/^ca-/, '');
  const body = pub ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n` : '# Set PUBLIC_ADSENSE_CLIENT to generate this file\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
