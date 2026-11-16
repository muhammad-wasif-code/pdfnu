import gsPkg from '@jspawn/ghostscript-wasm/package.json';
import pdfjsPkg from 'pdfjs-dist/package.json';

/** Versioned paths → safe to cache forever (see public/_headers). */
export const GS_BASE = `/vendor/gs-${gsPkg.version}/`;
export const PDFJS_BASE = `/vendor/pdfjs-${pdfjsPkg.version}/`;
