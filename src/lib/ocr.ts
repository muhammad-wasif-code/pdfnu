/** Text recognition with tesseract.js. Engine and models are self-hosted under /vendor; nothing is sent anywhere. */
import { TESSERACT_BASE } from './vendor';
import type { OcrWord } from './pdfOps';

export type OcrLang = 'eng' | 'urd' | 'hin';
export const OCR_LANGS: { value: OcrLang; label: string; latin: boolean }[] = [
  { value: 'eng', label: 'English', latin: true },
  { value: 'urd', label: 'Urdu', latin: false },
  { value: 'hin', label: 'Hindi', latin: false },
];

export interface OcrResult { text: string; words: OcrWord[]; confidence: number; }

export async function createOcr(lang: OcrLang, onProgress?: (status: string, p: number) => void) {
  const { createWorker, OEM } = await import('tesseract.js');
  const worker = await createWorker(lang, OEM.LSTM_ONLY, {
    workerPath: `${TESSERACT_BASE}worker.min.js`,
    corePath: TESSERACT_BASE,
    langPath: `${TESSERACT_BASE}lang`,
    gzip: true,
    logger: (m: { status: string; progress: number }) => onProgress?.(m.status, m.progress),
  });
  return {
    async recognize(image: HTMLCanvasElement | Blob): Promise<OcrResult> {
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      const words: OcrWord[] = [];
      for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) {
        words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
      }
      return { text: data.text, words, confidence: data.confidence };
    },
    terminate: () => worker.terminate(),
  };
}
