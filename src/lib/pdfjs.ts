import { PDFJS_BASE } from './vendor';

type PdfJs = typeof import('pdfjs-dist');
let lib: Promise<PdfJs> | null = null;

/** Lazily loads pdf.js (only when a tool actually needs to render pages). */
export function loadPdfJs(): Promise<PdfJs> {
  if (!lib) {
    lib = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, w]) => {
      m.GlobalWorkerOptions.workerSrc = w.default;
      return m;
    });
  }
  return lib;
}

export async function openPdf(data: Uint8Array, password?: string) {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({
    data,
    password,
    isEvalSupported: false,
    standardFontDataUrl: PDFJS_BASE + 'standard_fonts/',
    cMapUrl: PDFJS_BASE + 'cmaps/',
    cMapPacked: true,
    wasmUrl: PDFJS_BASE + 'wasm/',
    iccUrl: PDFJS_BASE + 'iccs/',
  } as any).promise;
}

/** Keep canvases within mobile Safari limits (~16.7 MP); we stay well below. */
export const MAX_CANVAS_PIXELS = 8_000_000;
