// Notify Bing, Yandex, Seznam, Naver etc. (via IndexNow) about all URLs in the sitemap.
// Usage after deploying: INDEXNOW_KEY=yourkey SITE_URL=https://pdfnu.com node scripts/indexnow.mjs
const key = process.env.INDEXNOW_KEY;
const site = (process.env.SITE_URL || 'https://pdfnu.com').replace(/\/$/, '');
if (!key) { console.error('Set INDEXNOW_KEY (same value used at build time).'); process.exit(1); }
const index = await (await fetch(`${site}/sitemap-index.xml`)).text();
const maps = [...index.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
const urls = [];
for (const m of maps) urls.push(...[...(await (await fetch(m)).text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((x) => x[1]));
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(site).host, key, keyLocation: `${site}/${key}.txt`, urlList: urls }),
});
console.log(`IndexNow: submitted ${urls.length} URLs → HTTP ${res.status}`);
