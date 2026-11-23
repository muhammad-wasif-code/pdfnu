# PDFSherpa

**Every PDF tool you need. Fast, free, and your files never leave your device.**

[Live site](https://pdfsherpa.com) · [Source](https://github.com/muhammad-wasif-code/pdfnu) · [Follow PDFSherpa on LinkedIn](https://www.linkedin.com/company/pdfsherpa/) · Contact: [hello@pdfsherpa.com](mailto:hello@pdfsherpa.com)

PDFSherpa is a static website with **39 PDF and image tools** that run **100% in the browser**. Files are never uploaded to a server. There is no signup, no watermark, and no file-size limit imposed by a server. After the first visit, the site works offline as an installable PWA. How-to guides: [pdfsherpa.com/guides](https://pdfsherpa.com/guides).

![PDFSherpa homepage](docs/screenshot-home.png)

- **Stack:** Astro 5 (static output) · TypeScript · Tailwind CSS v4 · Preact islands
- **Engines:** [pdf-lib](https://pdf-lib.js.org/) (editing), [pdf.js](https://mozilla.github.io/pdf.js/) (rendering), [Ghostscript WASM](https://github.com/jsscheller/ghostscript-wasm) (compression, encryption, and related PDF tasks), [Tesseract.js](https://tesseract.projectnaptha.com/) (OCR), JSZip, heic2any, PptxGenJS
- **Hosting:** Cloudflare Pages · PWA with offline support · AdSense-ready
- **License:** GNU AGPL-3.0-or-later (see [LICENSE](LICENSE)) because Ghostscript is AGPL

---

## Privacy model

Every tool processes files inside the browser with JavaScript and WebAssembly. The file is read into the page's memory, processed on your device, and handed back as a download. Nothing is sent to a PDFSherpa server, so documents never leave the device.

Unlock PDF asks for a password only when you already know it; the password stays in the browser too. PDFSherpa does not crack, guess, or bypass unknown passwords.

---

## Tools

### Optimize
- **Compress PDF** — reduce file size, including exact targets such as 100KB or 200KB
- **Grayscale PDF** — convert a PDF to black and white
- **Repair PDF** — attempt to fix a damaged PDF

### Organize
- **Merge PDF** — combine files
- **Split PDF** — extract page ranges into new files
- **Rotate PDF** — rotate pages
- **Organize Pages** — reorder pages
- **Delete Pages** — remove pages
- **Extract Pages** — save chosen pages as a new PDF
- **Compare PDF** — word-level diff between two PDFs

### Convert
- **JPG to PDF** — turn images into a PDF
- **PDF to JPG/PNG** — export pages as images
- **Image Converter** — convert between JPG, PNG and WebP
- **PDF to Text** — extract text
- **Extract Images** — save images embedded in a PDF
- **Scan to PDF** — phone camera to PDF, with shadow removal
- **PDF to Markdown** — text with headings
- **PDF to PowerPoint** — pages to slides
- **PDF to PDF/A** — archive-ready PDF
- **OCR PDF** — English, Urdu and Hindi; searchable PDF for English

### Edit
- **Edit PDF** — add text, images and shapes
- **Sign PDF** — add a signature
- **Fill PDF Form** — complete form fields
- **Watermark** — add a text or image watermark
- **Page Numbers** — add page numbers
- **Header & Footer** — add text to every page
- **Crop PDF** — trim page margins
- **Resize PDF** — change page size (A4, Letter, Legal, and others)
- **Flatten PDF** — lock forms and comments

### Security
- **Protect PDF** — add a password
- **Unlock PDF** — remove a password, only if you already have the correct one
- **Redact PDF** — true redaction: the text is removed from the file, not just covered

### Image
- **Compress Image** — reduce image size, including targets such as 10KB, 20KB or 50KB
- **Resize Image** — change dimensions
- **Passport Photo maker** — 35×45 mm, 2×2 in, and a print sheet
- **Crop Image** — trim photos
- **Signature Cleaner** — make a transparent signature PNG
- **HEIC to JPG** — convert iPhone photos
- **Combine Images** — join photos into one image

Useful deep links include [/compress-pdf-to-100kb](https://pdfsherpa.com/compress-pdf-to-100kb), [/compress-image-to-20kb](https://pdfsherpa.com/compress-image-to-20kb), [/passport-photo-maker](https://pdfsherpa.com/passport-photo-maker), [/redact-pdf](https://pdfsherpa.com/redact-pdf), [/ocr-pdf](https://pdfsherpa.com/ocr-pdf), [/scan-to-pdf](https://pdfsherpa.com/scan-to-pdf), [/sign-pdf](https://pdfsherpa.com/sign-pdf) and [/heic-to-jpg](https://pdfsherpa.com/heic-to-jpg).

---

## Local development

Requirements: **Node.js 20.3+** (22 recommended, see `.nvmrc`) and npm.

```bash
npm install
npm run dev        # http://localhost:4322 (copies vendor engines to public/vendor first)
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Copies engines → builds static site to `dist/` → generates `dist/sw.js` (and the IndexNow key file if `INDEXNOW_KEY` is set) |
| `npm run preview` | Serves `dist/` locally |
| `npm test` | Unit tests for PDF operations, text diff, Markdown conversion, password protection, and Ghostscript-backed tools (Node) |
| `npm run check` | TypeScript / Astro type check |
| `node scripts/make-og.mjs` | Regenerates `public/og.png` |
| `node scripts/make-icons.mjs` | Regenerates favicons/PWA icons from `public/favicon.svg` |

### Environment variables

Copy `.env.example` to `.env` for local use. Set the same variables in Cloudflare Pages for production.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SITE_URL` | yes | Canonical domain, e.g. `https://pdfsherpa.com` (canonical tags, sitemap, robots.txt) |
| `PUBLIC_SOURCE_URL` | **yes (AGPL)** | Public URL of this repository, linked in the footer and About page |
| `PUBLIC_ADSENSE_CLIENT` | no | `ca-pub-…`. Leave empty to disable ads entirely (no reserved ad space is rendered) |
| `PUBLIC_CONTACT_EMAIL` | no | Shown on Contact/Privacy (defaults to `hello@pdfsherpa.com`) |
| `INDEXNOW_KEY` | no | 8–128 letters/digits; publishes `/<key>.txt` for IndexNow |

### Manual browser testing

After `npm run build`, run `./scripts/serve-fixtures.sh` to copy the test files from `test/fixtures/` into `dist/__test__/` (local only). In the browser console on any tool page, run `await import('/__test__/browser-helpers.js')` and use `load(['scanned.pdf'])`, `btn(/Compress/)`, `wait(/complete/)` and `dl()`. `node test/make-fixtures.mjs --big` regenerates the 50 MB test PDF.

---

## Project structure

```
src/
  pages/            one .astro page per tool + guides, legal pages, robots.txt, ads.txt
  islands/          Preact tool UIs (only JS shipped on tool pages)
  components/       Astro components (Header, Footer, ToolCard, FAQ, AdSlot…) and ui/ (Dropzone, OptionChips, ProgressBar, ResultCard…)
  layouts/          BaseLayout (SEO head, theme, SW), ToolLayout, GuideLayout, PageLayout
  lib/              compression pipeline, pdf-lib ops (run in a Web Worker), pdf.js loader, image helpers, zip
  data/             tool + guide registry
  styles/global.css design tokens (Tailwind @theme) from /design
scripts/            vendor copy, Ghostscript worker, service-worker template/postbuild, icons, OG image, IndexNow
public/_headers     security headers, CSP, caching for Cloudflare Pages
```

Heavy code is lazy-loaded: tool pages ship a small Preact island, then pdf-lib, pdf.js and JSZip load on first use. The 16 MB Ghostscript WASM (11 MB gzipped) and Tesseract OCR data load only on tools that need them.

---

## Deploy to Cloudflare Pages (from GitHub)

1. **Push to GitHub**
   ```bash
   git add -A && git commit -m "Initial PDFSherpa site"
   git remote add origin https://github.com/muhammad-wasif-code/pdfnu.git
   git push -u origin main
   ```
   The repository should be **public**, which is the simplest way to meet the AGPL source-code requirement.
2. In the Cloudflare dashboard go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repository.
3. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: `NODE_VERSION=22`, `SITE_URL`, `PUBLIC_SOURCE_URL`, and optionally `PUBLIC_ADSENSE_CLIENT`, `PUBLIC_CONTACT_EMAIL`, `INDEXNOW_KEY`
4. **Save and Deploy.** Every push to `main` redeploys, and pull requests get preview URLs.
5. **Custom domain:** Pages project → **Custom domains → Set up a domain**. Enable *Always Use HTTPS*.
6. Optional: **Caching → Configuration → Crawler Hints** on. Cloudflare then pings IndexNow automatically when pages change.

Notes:
- `public/_headers` sets the CSP (allows AdSense + `wasm-unsafe-eval` for WebAssembly), HSTS and long-term caching for `/_astro/*` and `/vendor/*`. **No COEP/COOP headers** are set, on purpose, because they would break AdSense.
- Ghostscript's `gs.wasm` is 16 MB, under Cloudflare Pages' 25 MiB per-file limit.
- Clean URLs: Astro builds `compress-pdf.html`, and Cloudflare serves it at `/compress-pdf`.

---

## Google AdSense

1. Apply at [adsense.google.com](https://adsense.google.com) with your domain. Set `PUBLIC_ADSENSE_CLIENT=ca-pub-…` and redeploy. This adds the `google-adsense-account` verification meta tag and generates `/ads.txt`.
2. **Consent (EEA, UK, Switzerland):** in AdSense go to **Privacy & messaging → European regulations → Create message** and publish it for your site. It's Google's certified CMP, delivered by the same ad script. The footer shows a "Privacy choices" link once it's active.
3. Create ad units and put their slot IDs in the `<AdSlot slot="…">` usages (tool pages: `tool-below`, `tool-article`, `tool-sidebar`; guides: `guide-article`, `guide-sidebar`).
4. Ad slots reserve their height to prevent layout shift, never overlap the drop zone or buttons, and the ad script loads only after the page is idle.

---

## Google Search Console

1. Go to [search.google.com/search-console](https://search.google.com/search-console) → **Add property → Domain** → enter `pdfsherpa.com`.
2. Verify with the DNS TXT record. If DNS is on Cloudflare, Search Console can add it automatically, or add it under **DNS → Records**.
3. **Sitemaps** → submit `sitemap-index.xml`.
4. **URL inspection** → paste the homepage and a few tool URLs → **Request indexing**.
5. Check **Pages** and **Core Web Vitals** after a few days.

## Bing Webmaster Tools

1. Go to [bing.com/webmasters](https://www.bing.com/webmasters) → **Import from Google Search Console**, the fastest route since it copies the verified site and sitemaps. Alternatively add the site manually and verify by DNS CNAME or meta tag.
2. **Sitemaps** → submit `https://pdfsherpa.com/sitemap-index.xml`.
3. **IndexNow:** set `INDEXNOW_KEY` in Cloudflare, redeploy, then after each deploy with new pages run:
   ```bash
   INDEXNOW_KEY=yourkey SITE_URL=https://pdfsherpa.com node scripts/indexnow.mjs
   ```
   This notifies Bing, Yandex, Seznam and Naver. With Cloudflare Crawler Hints enabled this happens automatically.

`robots.txt` allows all crawlers, including Googlebot, Bingbot, Google-Extended, GPTBot, OAI-SearchBot, PerplexityBot and ClaudeBot.

---

## Known limitations

- **Protect PDF** uses PDF standard security revision 3 (128-bit RC4) via Ghostscript 9.56. It's universally compatible but weaker than AES-256.
- **Unlock PDF** only removes a password you already know. It does not crack, guess, or bypass unknown passwords, and it does not strip owner permission restrictions without the owner's password. Other tools still expect a file you can already open; unlock it first if you have the password.
- **Text watermarks/page numbers** use the standard Helvetica font (WinAnsi characters only). Other scripts are replaced with "?".
- **OCR PDF** recognises English, Urdu and Hindi. Searchable PDF output is available for English.
- **Offline:** all pages and the core engines are cached on first visit. Heavier engines such as Ghostscript and Tesseract are cached the first time a tool that needs them is used online.
- **Browsers:** needs WebAssembly + ES2022 (Chrome/Edge 100+, Safari 16.4+, Firefox 110+).

## Credits & licenses

PDFSherpa © its contributors, AGPL-3.0-or-later. Bundled: Ghostscript (AGPL-3.0, Artifex), pdf.js (Apache-2.0, Mozilla), pdf-lib (MIT), JSZip (MIT/GPLv3), Preact (MIT), Inter font (OFL-1.1), Tesseract.js, heic2any, PptxGenJS.

Contact: [hello@pdfsherpa.com](mailto:hello@pdfsherpa.com)
