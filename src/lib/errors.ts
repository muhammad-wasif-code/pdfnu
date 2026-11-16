/** Errors shown to users. `code` lets the UI pick an icon/hint. */
export class UserError extends Error {
  constructor(message: string, public code: 'type' | 'encrypted' | 'memory' | 'corrupt' | 'target' | 'generic' = 'generic') {
    super(message);
  }
}

export function friendlyError(err: unknown): UserError {
  if (err instanceof UserError) return err;
  const msg = String((err as Error)?.message ?? err ?? '');
  const name = (err as Error)?.name ?? '';
  if (name === 'RangeError' || /out of memory|allocation|Array buffer allocation|memory access out of bounds|Cannot enlarge memory/i.test(msg))
    return new UserError('This file is too large for your device’s memory. Try a smaller file, close other tabs, or use a computer.', 'memory');
  if (/encrypt|password/i.test(msg))
    return new UserError('This PDF is password-protected. Open it with its password and save an unprotected copy first.', 'encrypted');
  if (/Invalid PDF|No PDF header|Failed to parse|InvalidPDF|bad xref|Expected/i.test(msg))
    return new UserError('This file looks damaged or isn’t a valid PDF.', 'corrupt');
  console.error(err);
  return new UserError('Something went wrong while processing this file. Please try again.', 'generic');
}

/** Check magic bytes so a renamed .docx doesn’t get processed as a PDF. */
export async function assertPdf(file: File): Promise<void> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const text = new TextDecoder('latin1').decode(head);
  if (!text.includes('%PDF-')) throw new UserError(`“${file.name}” is not a PDF file.`, 'type');
}

export function isPdfName(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
