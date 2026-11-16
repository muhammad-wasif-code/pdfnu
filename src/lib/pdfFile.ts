import { pdfOp } from './pdfWorker';
import { assertPdf, isPdfName, UserError } from './errors';

export interface LoadedPdf { bytes: Uint8Array; pageCount: number; }

/** Validate + read a PDF. Rejects non-PDFs and any encrypted PDF (we never bypass protection). */
export async function readPdf(file: File): Promise<LoadedPdf> {
  if (!isPdfName(file)) throw new UserError(`“${file.name}” is not a PDF file.`, 'type');
  await assertPdf(file);
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { throw new UserError(`“${file.name}” is too large for your device’s memory.`, 'memory'); }
  let info: { pageCount: number; encrypted: boolean };
  try { info = await pdfOp('inspect', [bytes.slice().buffer]); } catch { throw new UserError(`“${file.name}” looks damaged or isn’t a valid PDF.`, 'corrupt'); }
  if (info.encrypted) throw new UserError(`“${file.name}” is password-protected or restricted. Open it with its password and save an unprotected copy first.`, 'encrypted');
  return { bytes, pageCount: info.pageCount };
}

let n = 0;
export const uid = () => `f${Date.now().toString(36)}${(n++).toString(36)}`;
