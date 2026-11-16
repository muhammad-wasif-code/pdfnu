// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: process.env.SITE_URL || 'https://pdfnu.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file', // /compress-pdf.html → served as /compress-pdf on Cloudflare Pages
    inlineStylesheets: 'always', // inline all (small) CSS → no render-blocking request
    assets: '_astro',
  },
  integrations: [preact(), sitemap({ filter: (page) => !/\/404\/?$/.test(page) })],
  // Cast: @tailwindcss/vite and Astro bundle slightly different Vite type versions.
  vite: { plugins: [/** @type {any} */ (tailwindcss())] },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
});
