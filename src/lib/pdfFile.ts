import { pdfOp } from './pdfWorker';
import { assertPdf, isPdfName, UserError } from './errors';

export interface LoadedPdf { bytes: Uint8Array; pageCount: number; }

/**
 * Validate + normalize raw PDF bytes. Files that open without a password but carry owner restrictions
 * (no editing, printing…) are decrypted losslessly so every tool can work on them, as other PDF
 * services do. Files that need a password to open are rejected: use Unlock PDF with the password.
 */
export async function preparePdfBytes(bytes: Uint8Array, fileName: string): Promise<LoadedPdf> {
  let info: { pageCount: number; encrypted: boolean };
  try { info = await pdfOp('inspect', [bytes.slice().buffer]); } catch { throw new UserError(`“${fileName}” looks damaged or isn’t a valid PDF.`, 'corrupt'); }
  if (!info.pageCount) throw new UserError(`“${fileName}” has no pages.`, 'corrupt');
  if (info.encrypted) {
    const res = await pdfOp('decrypt', [bytes.slice().buffer, '']);
    if (res.status === 'ok') bytes = res.bytes;
    else if (res.status === 'password') throw new UserError(`“${fileName}” needs a password to open. Remove it first with Unlock PDF (you’ll need the password).`, 'encrypted');
    else {
      // Adobe / LiveCycle forms sometimes use restrictions our parser can’t strip; Ghostscript can when the file still opens without a password.
      try {
        const { openPdf } = await import('./pdfjs');
        const doc = await openPdf(bytes.slice());
        await doc.destroy();
        const { runGhostscriptArgs, decryptArgs } = await import('./ghostscript');
        bytes = await runGhostscriptArgs(bytes, decryptArgs(''));
      } catch {
        throw new UserError(`“${fileName}” uses a kind of protection PDFSherpa can’t open. Save an unprotected copy first.`, 'encrypted');
      }
    }
    try { info = await pdfOp('inspect', [bytes.slice().buffer]); } catch { throw new UserError(`“${fileName}” looks damaged or isn’t a valid PDF.`, 'corrupt'); }
  }
  return { bytes, pageCount: info.pageCount };
}

/** Validate + read a PDF from a browser `File`. */
export async function readPdf(file: File): Promise<LoadedPdf> {
  if (!isPdfName(file)) throw new UserError(`“${file.name}” is not a PDF file.`, 'type');
  await assertPdf(file);
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { throw new UserError(`“${file.name}” is too large for your device’s memory.`, 'memory'); }
  return preparePdfBytes(bytes, file.name);
}

let n = 0;
export const uid = () => `f${Date.now().toString(36)}${(n++).toString(36)}`;
