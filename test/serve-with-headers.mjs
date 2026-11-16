// Local static server that applies public/_headers like Cloudflare Pages (for CSP/SW testing). Usage: node test/serve-with-headers.mjs [port]
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const port = Number(process.argv[2] || 4330);
const rules = []; let cur = null;
for (const line of readFileSync('dist/_headers', 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  if (!/^\s/.test(line)) { cur = { pat: new RegExp('^' + line.trim().replace(/\*/g, '.*') + '$'), h: {} }; rules.push(cur); }
  else { const i = line.indexOf(':'); cur.h[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };
createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = join('dist', path);
  if (existsSync(f + '.html')) f = f + '.html'; // like Cloudflare Pages: /guides → guides.html
  else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  const found = existsSync(f) && statSync(f).isFile();
  if (!found) f = 'dist/404.html';
  const headers = { 'Content-Type': types[extname(f)] || 'application/octet-stream' };
  for (const r of rules) if (r.pat.test(path)) Object.assign(headers, r.h);
  delete headers['Strict-Transport-Security']; delete headers['Content-Security-Policy'] && 0;
  headers['Content-Security-Policy'] = (headers['Content-Security-Policy'] || '').replace('; upgrade-insecure-requests', '');
  res.writeHead(found ? 200 : 404, headers);
  res.end(readFileSync(f));
}).listen(port, () => console.log(`serving dist with _headers on http://localhost:${port}`));
