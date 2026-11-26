/**
 * "PDFSherpa vs X" comparison pages. Every competitor fact comes from that competitor's own pages
 * (listed in `sources`), read on `checked`. Re-check them and update `checked` before changing any claim.
 * Leave a fact out rather than guess.
 */
import type { QA } from '../components/FAQ.astro';

export interface Comparison {
  slug: string;
  name: string;
  /** <title>, ≤ 60 chars */
  title: string;
  description: string;
  lead: string;
  checked: string;
  rows: { feature: string; us: string; them: string }[];
  betterThem: string[];
  faqs: QA[];
  sources: { label: string; url: string }[];
}

const where = 'In your browser, on your device. The file is never uploaded.';
const kept = 'Never stored. Nothing reaches a server.';
const openSource = 'Yes, AGPL-3.0. Anyone can read the code.';
const price = 'Free. A few ads, which never see your files.';

export const comparisons: Comparison[] = [
  {
    slug: 'ilovepdf-alternative',
    name: 'iLovePDF',
    title: 'iLovePDF Alternative That Never Uploads Files | PDFSherpa',
    description: "PDFSherpa vs iLovePDF: where files are processed, free limits, OCR, offline use and price, checked against iLovePDF's own pages. Free, no upload.",
    lead: 'The short answer: iLovePDF uploads your file to its servers and keeps some features for Premium. PDFSherpa does the work inside your browser, so the file never leaves your device, and every tool is free.',
    checked: '2026-11-26',
    rows: [
      { feature: 'Where your file is processed', us: where, them: 'Web tools upload the file (encrypted) to iLovePDF servers, in the European Economic Area by default.' },
      { feature: 'How long files are kept', us: kept, them: 'Deleted automatically within 2 hours. Signed documents and audit trails are kept 5 years.' },
      { feature: 'Free usage limits', us: 'No daily limits and no fixed file size. Your device’s memory is the limit.', them: 'Free plan has “limited document processing” and per-tool size caps, e.g. 100 MB for Merge, 15 MB for Word to PDF.' },
      { feature: 'OCR (scanned PDFs to text)', us: 'Free: OCR PDF, Image to Text, and PDF to Word for scans.', them: 'OCR tools are Premium only.' },
      { feature: 'PDF to PDF/A', us: 'Free', them: 'Premium only' },
      { feature: 'Works offline', us: 'Yes, in the browser after your first visit.', them: 'Desktop app processes files locally; it is a Premium feature.' },
      { feature: 'Open source', us: openSource, them: 'Not stated. They use their own processing engine.' },
      { feature: 'Price', us: price, them: 'Free plan, or Premium from US$4/month billed yearly (US$48), US$7 billed monthly.' },
    ],
    betterThem: [
      'You want AI summaries or document translation.',
      'You need signature requests with an audit trail, or team and business plans.',
      'You prefer installed desktop and mobile apps, and you have Premium.',
    ],
    faqs: [
      { q: 'Is PDFSherpa a good free alternative to iLovePDF?', a: 'For everyday jobs (compress, merge, split, convert, sign, edit, OCR) yes, and your files stay on your device. iLovePDF is the better choice if you need AI summaries or translation, signature workflows with an audit trail, or team plans.' },
      { q: 'Does iLovePDF upload my files?', a: 'Its web tools do. iLovePDF says files travel encrypted to its servers and are deleted automatically within 2 hours. PDFSherpa never uploads files at all: everything runs inside your browser.' },
      { q: 'Is OCR free on PDFSherpa?', a: 'Yes. <a href="/ocr-pdf">OCR PDF</a>, <a href="/image-to-text">Image to Text</a> and <a href="/pdf-to-word">PDF to Word</a> (for scanned pages) are free. On iLovePDF, OCR tools are part of Premium.' },
      { q: 'Can I use PDFSherpa for confidential documents?', a: 'Yes. Because files are processed on your device and never sent to a server, there is nothing for anyone else to store or leak. Read <a href="/guides/are-online-pdf-tools-safe">are online PDF tools safe?</a> for how to check any tool yourself.' },
    ],
    sources: [
      { label: 'iLovePDF: Security & Privacy (where files are processed, retention)', url: 'https://www.ilovepdf.com/help/security' },
      { label: 'iLovePDF: Pricing (free limits, Premium-only tools, price)', url: 'https://www.ilovepdf.com/pricing' },
    ],
  },
  {
    slug: 'smallpdf-alternative',
    name: 'Smallpdf',
    title: 'Smallpdf Alternative: Free, No Upload, No Limits | PDFSherpa',
    description: "PDFSherpa vs Smallpdf: where files go, daily limits, OCR, text editing and compression levels, checked against Smallpdf's own pages. Free, private.",
    lead: 'The short answer: Smallpdf is cloud-based, so your file is uploaded, and the free plan has daily download limits. PDFSherpa runs in your browser, never uploads the file, and has no daily limits.',
    checked: '2026-11-26',
    rows: [
      { feature: 'Where your file is processed', us: where, them: 'Cloud-based: you upload the file and it is processed on Smallpdf’s servers (TLS-encrypted).' },
      { feature: 'How long files are kept', us: kept, them: 'Deleted automatically after one hour.' },
      { feature: 'Free usage limits', us: 'No daily limits and no fixed file size. Your device’s memory is the limit.', them: 'Free plan has a daily download limit on most tools.' },
      { feature: 'Compression strength', us: 'Every level is free, including target sizes like 100KB.', them: 'Basic is free; Moderate and Strong compression are Pro.' },
      { feature: 'OCR (scanned PDFs to text)', us: 'Free: OCR PDF, Image to Text, and PDF to Word for scans.', them: 'OCR for PDF to Word, Excel and PowerPoint is Pro.' },
      { feature: 'Edit text in a PDF', us: 'Free: add text, images and shapes with Edit PDF.', them: 'Edit Text is Pro.' },
      { feature: 'Open source', us: openSource, them: 'Not stated.' },
      { feature: 'Price', us: price, them: 'Free plan with limits, or Pro (7-day free trial). Price depends on your region.' },
    ],
    betterThem: [
      'You want AI tools such as chat with PDF, summaries or translation.',
      'You need e-signature requests with a certificate of completion (via Sign.com).',
      'You want cloud storage for your documents and team billing.',
    ],
    faqs: [
      { q: 'Is PDFSherpa a good free alternative to Smallpdf?', a: 'Yes for everyday jobs: compress, merge, split, convert, edit, sign and OCR, with no daily limits and no upload. Smallpdf is the better choice if you want AI chat and summaries, signature requests or cloud storage.' },
      { q: 'Does Smallpdf upload my files?', a: 'Yes. Smallpdf says its tools are cloud-based and that files are deleted automatically after one hour. PDFSherpa never uploads files: everything runs inside your browser.' },
      { q: 'Can I compress a PDF strongly for free?', a: 'On PDFSherpa, yes. <a href="/compress-pdf">Compress PDF</a> offers every level free, plus presets like <a href="/compress-pdf-to-100kb">100KB</a> and <a href="/compress-pdf-to-200kb">200KB</a>. On Smallpdf, Moderate and Strong compression are Pro.' },
      { q: 'Can I use PDFSherpa for confidential documents?', a: 'Yes. Files are processed on your device and never sent to a server. Read <a href="/guides/are-online-pdf-tools-safe">are online PDF tools safe?</a> for how to check any tool yourself.' },
    ],
    sources: [
      { label: 'Smallpdf: Compress PDF (cloud-based, files deleted after one hour)', url: 'https://smallpdf.com/compress-pdf' },
      { label: 'Smallpdf: Pricing (free limits, Pro-only features)', url: 'https://smallpdf.com/pricing' },
    ],
  },
  {
    slug: 'adobe-acrobat-alternative',
    name: 'Adobe Acrobat online',
    title: 'Adobe Acrobat Online Alternative, No Upload | PDFSherpa',
    description: "PDFSherpa vs Adobe Acrobat's free online tools: where files go, sign-in, free limits and price, checked against Adobe's own pages. Free, private.",
    lead: 'The short answer: Adobe’s free online tools send your file to Adobe’s servers and allow limited use before you need a paid plan. PDFSherpa runs in your browser, never uploads the file, and every tool is free.',
    checked: '2026-11-26',
    rows: [
      { feature: 'Where your file is processed', us: where, them: 'Online tools upload the file to Adobe’s servers.' },
      { feature: 'How long files are kept', us: kept, them: 'Deleted after processing, unless you sign in to save it.' },
      { feature: 'Account needed', us: 'Never.', them: 'Not for basic use. Signing in is needed to save, share or reorganise pages.' },
      { feature: 'Free usage limits', us: 'No limits. Your device’s memory is the limit.', them: '“Limited use” for free; unlimited use needs a paid Acrobat plan.' },
      { feature: 'Works offline', us: 'Yes, in the browser after your first visit.', them: 'With the installed Acrobat desktop app; the online tools need a connection.' },
      { feature: 'Open source', us: openSource, them: 'No. Acrobat is proprietary software.' },
      { feature: 'Price', us: price, them: 'Acrobat Standard US$14.99/month, Pro US$19.99/month (yearly plan, billed monthly).' },
    ],
    betterThem: [
      'You need full Acrobat features such as editing existing text in place or certified PDF workflows.',
      'Your company already pays for Adobe and stores files in Adobe cloud.',
      'You want Adobe’s AI Assistant (Acrobat Studio).',
    ],
    faqs: [
      { q: 'Is PDFSherpa a good free alternative to Adobe Acrobat online?', a: 'For everyday jobs (compress, merge, split, convert, sign, fill forms, OCR) yes, without uploads or usage limits. Full Acrobat is still the better choice for advanced editing and enterprise document workflows.' },
      { q: 'Does Adobe Acrobat online upload my files?', a: 'Yes. Adobe says files are handled by Adobe servers and deleted unless you sign in to save them. PDFSherpa never uploads files: everything runs inside your browser.' },
      { q: 'Do I need an Adobe account?', a: 'Not for basic use, according to Adobe, but you do to save, share or reorganise pages, and unlimited use needs a paid plan. PDFSherpa never asks for an account.' },
      { q: 'Can I use PDFSherpa for confidential documents?', a: 'Yes. Files are processed on your device and never sent to a server. Read <a href="/guides/are-online-pdf-tools-safe">are online PDF tools safe?</a> for how to check any tool yourself.' },
    ],
    sources: [
      { label: 'Adobe: Compress PDF online (servers, deletion, limited use)', url: 'https://www.adobe.com/acrobat/online/compress-pdf.html' },
      { label: 'Adobe: Merge PDF online (sign-in to save, share or reorganise)', url: 'https://www.adobe.com/acrobat/online/merge-pdf.html' },
      { label: 'Adobe: Acrobat pricing', url: 'https://www.adobe.com/acrobat/pricing.html' },
    ],
  },
];

export const getComparison = (slug: string) => {
  const c = comparisons.find((x) => x.slug === slug);
  if (!c) throw new Error(`Unknown comparison ${slug}`);
  return c;
};
