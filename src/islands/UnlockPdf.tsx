import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { assertPdf, friendlyError, isPdfName, UserError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

type State = 'idle' | 'needs-password' | 'not-encrypted' | 'restrictions-only' | 'working' | 'done';

export default function UnlockPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [state, setState] = useState<State>('idle');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (files: File[]) => {
    const f = files[0];
    setError(null);
    try {
      if (!isPdfName(f)) throw new UserError(`“${f.name}” is not a PDF file.`, 'type');
      await assertPdf(f);
      const b = new Uint8Array(await f.arrayBuffer());
      const { pdfOp } = await import('../lib/pdfWorker');
      const info = await pdfOp('inspect', [b.slice().buffer]);
      setFile(f); setBytes(b);
      if (!info.encrypted) { setState('not-encrypted'); return; }
      // Does it open without a password? Then it only has permission restrictions.
      const { openPdf } = await import('../lib/pdfjs');
      try {
        const doc = await openPdf(b.slice());
        await doc.destroy();
        setState('restrictions-only');
      } catch (e: any) {
        if (e?.name !== 'PasswordException') throw e;
        setState('needs-password');
        import('../lib/ghostscript').then((m) => m.warmupGhostscript());
      }
    } catch (e) { setError(friendlyError(e).message); }
  };

  const unlock = async () => {
    if (!bytes || !pw) return;
    setError(null);
    setState('working');
    try {
      // 1. Verify the password the user typed
      const { openPdf } = await import('../lib/pdfjs');
      try {
        const doc = await openPdf(bytes.slice(), pw);
        await doc.destroy();
      } catch (e: any) {
        if (e?.name === 'PasswordException') { setError('That password is incorrect. Check for typos, Caps Lock and the keyboard language, then try again.'); setState('needs-password'); return; }
        throw e;
      }
      // 2. Re-write without encryption
      const { runGhostscriptArgs, decryptArgs } = await import('../lib/ghostscript');
      const res = await runGhostscriptArgs(bytes, decryptArgs(pw));
      const { pdfOp } = await import('../lib/pdfWorker');
      const check = await pdfOp('inspect', [res.slice().buffer]);
      if (check.encrypted || check.pageCount < 1) throw new Error('Unlock failed');
      setOut(res);
      setState('done');
    } catch (e) { setError(friendlyError(e).message); setState('needs-password'); }
  };

  const reset = () => { setFile(null); setBytes(null); setPw(''); setOut(null); setError(null); setState('idle'); };

  if (state === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard
          title="Password removed!"
          stats={[['File', file.name.length > 18 ? file.name.slice(0, 16) + '…' : file.name], ['Size', formatBytes(out.length)], ['Password', 'None']]}
          highlight="This copy opens without a password. Keep it somewhere safe, because anyone with the file can now read it."
          onDownload={() => downloadBlob(out, file.name)}
          downloadLabel={`Download ${file.name.length > 30 ? 'PDF' : file.name}`}
          onReset={reset}
          resetLabel="Unlock another PDF"
        />
      </div>
    );
  }

  const inputCls = 'h-12 w-full rounded-control border border-line bg-white px-4 pr-12 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 dark:border-white/10 dark:bg-night-2';

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your protected PDF here" buttonLabel="Select PDF" hint="You’ll need the password that opens the file" onFiles={open} />
        : <FileRow name={file.name} size={formatBytes(file.size)} onRemove={state === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={!file ? () => setError(null) : undefined}>{error}</ErrorBox>}

      {state === 'not-encrypted' && (
        <p class="rounded-control bg-surface px-4 py-3 text-sm text-gray-700 dark:bg-white/5 dark:text-gray-300">
          This PDF isn’t password-protected, so there’s nothing to unlock. You can use it directly with any PDFSherpa tool.
        </p>
      )}
      {state === 'restrictions-only' && (
        <p class="rounded-control bg-surface px-4 py-3 text-sm text-gray-700 dark:bg-white/5 dark:text-gray-300">
          This PDF opens without a password but has <strong>permission restrictions</strong> set by its owner (for example no editing or printing).
          PDFSherpa doesn’t remove restrictions it wasn’t given the password for. Ask the document’s owner for an unrestricted copy.
        </p>
      )}

      {(state === 'needs-password' || state === 'working') && (
        <form class="space-y-4" onSubmit={(e) => { e.preventDefault(); unlock(); }}>
          <input type="text" name="username" autocomplete="username" value={file?.name ?? ''} class="hidden" readOnly aria-hidden="true" tabIndex={-1} />
          <label class="block">
            <span class="mb-1.5 block text-sm font-semibold text-ink dark:text-white">Password that opens this PDF</span>
            <div class="relative">
              <input type={show ? 'text' : 'password'} autocomplete="current-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} class={inputCls} disabled={state === 'working'} />
              <button type="button" onClick={() => setShow(!show)} class="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" aria-label={show ? 'Hide password' : 'Show password'}>
                <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10Z" /><circle cx="10" cy="10" r="2.5" />{show && <path d="m3 3 14 14" />}</svg>
              </button>
            </div>
            <span class="mt-1 block text-xs text-muted dark:text-gray-400">PDFSherpa never guesses or cracks passwords. If you don’t know it, ask whoever sent you the file.</span>
          </label>
          {state === 'working' ? <ProgressBar label="Unlocking your PDF…" value={null} detail="First use downloads the PDF engine once (about 11 MB)." />
            : <button type="submit" class="btn-primary min-h-12 w-full text-[15px]" disabled={!pw}>Unlock PDF</button>}
        </form>
      )}
      <PrivacyNote />
    </div>
  );
}
