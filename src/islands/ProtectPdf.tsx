import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

const ASCII = /^[\x20-\x7E]+$/;

function strength(p: string): { label: string; score: number } {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return { score: Math.min(4, s), label: ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][Math.min(4, s)] };
}

function randomOwner() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 57]).join('');
}

export default function ProtectPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (files: File[]) => {
    setError(null);
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const pdf = await readPdf(files[0]);
      setFile(files[0]); setBytes(pdf.bytes);
      import('../lib/ghostscript').then((m) => m.warmupGhostscript());
    } catch (e) { setError(friendlyError(e).message); }
  };

  const problem = !pw ? null : pw.length < 4 ? 'Use at least 4 characters.' : !ASCII.test(pw) ? 'Use letters, numbers and standard symbols only (no emoji or accented letters), so every PDF reader can open it.' : pw2 && pw !== pw2 ? 'Passwords don’t match.' : null;
  const canRun = !!bytes && pw.length >= 4 && ASCII.test(pw) && pw === pw2;

  const run = async () => {
    if (!canRun || !bytes) return;
    setPhase('working'); setError(null);
    try {
      const { runGhostscriptArgs, encryptArgs } = await import('../lib/ghostscript');
      const res = await runGhostscriptArgs(bytes, encryptArgs(pw, randomOwner()));
      const { pdfOp } = await import('../lib/pdfWorker');
      const check = await pdfOp('inspect', [res.slice().buffer]);
      if (!check.encrypted) throw new Error('Encryption failed');
      setOut(res); setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setBytes(null); setPw(''); setPw2(''); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your PDF is password-protected!" stats={[['Encryption', '128-bit'], ['Password', `${pw.length} chars`], ['Size', formatBytes(out.length)]]}
          highlight="Anyone opening this file will need the password. Store it safely: it can’t be recovered."
          onDownload={() => downloadBlob(out, file.name)} downloadLabel={`Download ${file.name.length > 30 ? 'PDF' : file.name}`} onReset={reset} resetLabel="Protect another PDF" />
      </div>
    );
  }

  const st = strength(pw);
  const inputCls = 'h-12 w-full rounded-control border border-line bg-white px-4 pr-12 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 dark:border-white/10 dark:bg-night-2';

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={open} />
        : <FileRow name={file.name} size={formatBytes(file.size)} onRemove={phase === 'working' ? undefined : reset} />}
      {error && <ErrorBox onRetry={!file ? () => setError(null) : undefined}>{error}</ErrorBox>}

      {file && (
        <form class="space-y-4" onSubmit={(e) => { e.preventDefault(); run(); }}>
          {/* hidden username helps password managers offer to save the password */}
          <input type="text" name="username" autocomplete="username" value={file.name} class="hidden" readOnly aria-hidden="true" tabIndex={-1} />
          <label class="block">
            <span class="mb-1.5 block text-sm font-semibold text-ink dark:text-white">Password</span>
            <div class="relative">
              <input type={show ? 'text' : 'password'} autocomplete="new-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} class={inputCls} />
              <button type="button" onClick={() => setShow(!show)} class="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" aria-label={show ? 'Hide password' : 'Show password'}>
                <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10Z" /><circle cx="10" cy="10" r="2.5" />{show && <path d="m3 3 14 14" />}</svg>
              </button>
            </div>
            {pw && (
              <span class="mt-2 flex items-center gap-2 text-xs text-muted dark:text-gray-400">
                <span class="flex flex-1 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} class={`h-1.5 flex-1 rounded-full ${i < st.score ? (st.score >= 3 ? 'bg-success' : st.score === 2 ? 'bg-warning' : 'bg-danger') : 'bg-gray-200 dark:bg-white/10'}`} />)}</span>
                {st.label}
              </span>
            )}
          </label>
          <label class="block">
            <span class="mb-1.5 block text-sm font-semibold text-ink dark:text-white">Repeat password</span>
            <input type={show ? 'text' : 'password'} autocomplete="new-password" value={pw2} onInput={(e) => setPw2((e.target as HTMLInputElement).value)} class={inputCls} />
          </label>
          {problem && <p class="text-sm text-danger" role="alert">{problem}</p>}
          {phase === 'working' ? <ProgressBar label="Encrypting your PDF…" value={null} detail="First use downloads the PDF engine once (about 11 MB), then it works offline." /> : (
            <button type="submit" class="btn-primary min-h-12 w-full text-[15px]" disabled={!canRun}>Protect PDF</button>
          )}
        </form>
      )}
      <PrivacyNote />
    </div>
  );
}
