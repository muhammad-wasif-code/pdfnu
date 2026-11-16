// Runs after `astro build`: generates dist/sw.js (precache list) and the IndexNow key file.
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const DIST = 'dist';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(DIST).map((p) => '/' + relative(DIST, p).split('\\').join('/'));

const pages = files
  .filter((f) => f.endsWith('.html') && !f.startsWith('/__test__') && f !== '/404.html')
  .map((f) => (f === '/index.html' ? '/' : f.replace(/\/index\.html$/, '').replace(/\.html$/, '')));
const assets = files.filter((f) => f.startsWith('/_astro/'));
const extras = ['/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png'];
const precache = [...new Set([...pages, ...assets, ...extras])].sort();

const hash = createHash('sha256');
for (const f of precache.filter((f) => !pages.includes(f))) hash.update(f);
for (const f of files.filter((f) => f.endsWith('.html'))) hash.update(readFileSync(join(DIST, f)));
hash.update(readFileSync('scripts/sw-template.js'));
const version = hash.digest('hex').slice(0, 12);

const sw = readFileSync('scripts/sw-template.js', 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache));
writeFileSync(join(DIST, 'sw.js'), sw);
const bytes = precache.filter((f) => f.startsWith('/_astro/')).reduce((s, f) => s + statSync(join(DIST, f)).size, 0);
console.log(`sw.js: ${precache.length} URLs precached (${(bytes / 1024 / 1024).toFixed(2)} MB of assets), version ${version}`);

const key = process.env.INDEXNOW_KEY;
if (key) {
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) throw new Error('INDEXNOW_KEY must be 8–128 letters, digits or dashes');
  writeFileSync(join(DIST, `${key}.txt`), key);
  console.log(`IndexNow key file: /${key}.txt`);
}
