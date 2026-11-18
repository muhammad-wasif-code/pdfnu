// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * <lastmod> for the sitemap = last git commit that touched the page's source file.
 * Skipped entirely in shallow clones (every file would get the same date, which misleads crawlers).
 */
/** @param {...string} args */
const git = (...args) => { try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return ''; } };
// CI (Cloudflare Pages) clones shallowly; fetch history once so dates are real.
if (git('rev-parse', '--is-shallow-repository') === 'true') git('fetch', '--unshallow', '--quiet');
const fullHistory = git('rev-parse', '--is-shallow-repository') === 'false';
const lastmodCache = new Map();
/** @param {string} url @returns {string | undefined} */
function lastmodFor(url) {
  if (!fullHistory) return undefined;
  const path = new URL(url).pathname.replace(/\/$/, '') || '/';
  if (lastmodCache.has(path)) return lastmodCache.get(path);
  const candidates = path === '/' ? ['src/pages/index.astro'] : [`src/pages${path}.astro`, `src/pages${path}/index.astro`];
  // pages from dynamic routes (keyword landing pages) fall back to their data file
  const file = candidates.find((f) => existsSync(f)) ?? 'src/data/landings.ts';
  const date = file ? git('log', '-1', '--format=%cI', '--', file) : '';
  const value = date || undefined;
  lastmodCache.set(path, value);
  return value;
}

export default defineConfig({
  site: process.env.SITE_URL || 'https://pdfsherpa.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file', // /compress-pdf.html → served as /compress-pdf on Cloudflare Pages
    inlineStylesheets: 'always', // inline all (small) CSS → no render-blocking request
    assets: '_astro',
  },
  integrations: [preact(), sitemap({
      filter: (page) => !/\/404\/?$/.test(page),
      serialize(item) {
        const lastmod = lastmodFor(item.url);
        return lastmod ? { ...item, lastmod } : item;
      },
    })],
  // Cast: @tailwindcss/vite and Astro bundle slightly different Vite type versions.
  vite: { plugins: [/** @type {any} */ (tailwindcss())] },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
});
