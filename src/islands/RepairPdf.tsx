import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError, isPdfName, UserError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

interface Result { bytes: Uint8Array; pages: number; method: string; wasOk: boolean; }

/** Does pdf.js open it, and how many pages render? */
async function probe(bytes: Uint8Array): Promise<number> {
  const { openPdf } = await import('../lib/pdfjs');
  try {
    const doc = await openPdf(bytes.slice());
    let ok = 0;
    for (let n = 1; n <= doc.numPages; n++) { try { await doc.getPage(n); ok++; } catch {} }
    await doc.destroy();
    return ok;
  } catch (e: any) {
    if (e?.name === 'PasswordException') throw new UserError('This PDF is password-protected. Unlock it first with Unlock PDF (you need its password).', 'encrypted');
    return 0;
  }
}

export default function RepairPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [step, setStep] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (f: File) => {
    setError(null); setFile(f); setPhase('working');
    try {
      if (!isPdfName(f)) throw new UserError(`“${f.name}” doesn’t look like a PDF file.`, 'type');
      setStep('Checking the file…');
      const { preparePdfBytes } = await import('../lib/pdfFile');
      let input = (await preparePdfBytes(new Uint8Array(await f.arrayBuffer()), f.name)).bytes;
      const before = await probe(input);

      // 1. Lossless structural rebuild
      setStep('Rebuilding the PDF structure…');
      try {
        const { pdfOp } = await import('../lib/pdfWorker');
        const r = await pdfOp('rebuild', [input.slice().buffer]);
        const pages = await probe(r.bytes);
        if (pages > 0 && pages >= before) { setRes({ bytes: r.bytes, pages, method: 'Rebuilt the file structure (lossless)', wasOk: before > 0 }); setPhase('done'); return; }
      } catch (e: any) { if (e?.code === 'encrypted') throw e; }

      // 2. Ghostscript recovery
      setStep('Recovering content with Ghostscript…');
      const { runGhostscriptArgs, repairArgs } = await import('../lib/ghostscript');
      try {
        const out = await runGhostscriptArgs(input, repairArgs());
        const pages = await probe(out);
        if (pages > 0) { setRes({ bytes: out, pages, method: 'Recovered pages with Ghostscript', wasOk: before > 0 }); setPhase('done'); return; }
      } catch {}
      throw new UserError('Sorry, this PDF is too badly damaged to recover. If you have the original source (Word, scan, email attachment), export or download it again.', 'corrupt');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };

  const reset = () => { setFile(null); setRes(null); setPhase('edit'); setError(null); };

  if (phase === 'done' && res && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={res.wasOk ? 'PDF rebuilt' : 'PDF repaired!'} stats={[['Pages recovered', String(res.pages)], ['Before', formatBytes(file.size)], ['After', formatBytes(res.bytes.length)]]}
          highlight={res.wasOk ? `Your PDF already opened, but we rebuilt it to clean up its structure. ${res.method}.` : `${res.method}. Open it to check every page looks right.`}
          onDownload={() => downloadBlob(res.bytes, file.name)} downloadLabel={`Download ${file.name.length > 30 ? 'repaired PDF' : file.name}`} onReset={reset} resetLabel="Repair another PDF" />
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file || phase === 'edit' ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop the damaged PDF" buttonLabel="Select PDF" hint="For PDFs that won’t open, show errors or have missing pages" onFiles={(f) => run(f[0])} />
        : <FileRow name={file.name} size={formatBytes(file.size)} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {phase === 'working' && <ProgressBar label={step || 'Working…'} value={null} detail="Repair runs on your device. Large files can take a minute." />}
      <PrivacyNote />
    </div>
  );
}
