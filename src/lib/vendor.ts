import gsPkg from '@jspawn/ghostscript-wasm/package.json';
import pdfjsPkg from 'pdfjs-dist/package.json';
import tesseractPkg from 'tesseract.js/package.json';
import heicPkg from 'heic2any/package.json';
import fontsPkg from '@fontsource/carlito/package.json';

/** Versioned paths → safe to cache forever (see public/_headers). */
export const GS_BASE = `/vendor/gs-${gsPkg.version}/`;
export const PDFJS_BASE = `/vendor/pdfjs-${pdfjsPkg.version}/`;
export const TESSERACT_BASE = `/vendor/tesseract-${tesseractPkg.version}/`;
export const HEIC_BASE = `/vendor/heic2any-${heicPkg.version}/`;
export const FONTS_BASE = `/vendor/fonts-${fontsPkg.version}/`;
