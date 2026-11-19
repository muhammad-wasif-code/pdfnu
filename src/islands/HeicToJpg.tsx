import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { downloadBlob } from '../lib/download';
import { HEIC_BASE } from '../lib/vendor';

type Fmt = 'image/jpeg' | 'image/png';
interface Item { id: number; file: File; out?: { blob: Blob; url: string; name: string }; error?: string; }
let seq = 0;

type Heic2any = (o: { blob: Blob; toType: string; quality?: number }) => Promise<Blob | Blob[]>;
let loader: Promise<Heic2any> | null = null;
/** heic2any (libheif) is a 1.3 MB UMD script, loaded from our own /vendor only when needed. */
function loadHeic(): Promise<Heic2any> {
  if (!loader) {
    loader = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `${HEIC_BASE}heic2any.min.js`;
      s.onload = () => ((window as any).heic2any ? res((window as any).heic2any) : rej(new Error('HEIC decoder failed to load')));
      s.onerror = () => { loader = null; rej(new Error('HEIC decoder failed to load. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
  }
  return loader;
}
const isHeic = (f: File) => /\.(heic|heif)$/i.test(f.name) || /image\/hei[cf]/.test(f.type);

export default function HeicToJpg() {
  const [items, setItems] = useState<Item[]>([]);
  const [fmt, setFmt] = useState<Fmt>('image/jpeg');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<Item[]>([]);
  ref.current = items;
  useEffect(() => () => ref.current.forEach((i) => i.out && URL.revokeObjectURL(i.out.url)), []);

  const add = (files: File[]) => {
    const ok = files.filter(isHeic);
    if (!ok.length) { setError('Choose HEIC or HEIF photos (the format iPhones use).'); return; }
    setError(ok.length < files.length ? `${files.length - ok.length} file(s) skipped because they aren’t HEIC.` : null);
    setPhase('edit');
    setItems((c) => [...c, ...ok.map((file) => ({ id: seq++, file }))]);
  };

  const run = async () => {
    setPhase('working');
    try {
      setProgress({ label: 'Loading the HEIC decoder (first time only)…', value: 0 });
      const heic2any = await loadHeic();
      const ext = fmt === 'image/png' ? 'png' : 'jpg';
      const next: Item[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        setProgress({ label: `Converting ${it.file.name} (${i + 1} of ${items.length})…`, value: i / items.length });
        if (it.out) { next.push(it); continue; }
        try {
          const r = await heic2any({ blob: it.file, toType: fmt, quality: 0.92 });
          const blob = Array.isArray(r) ? r[0] : r;
          next.push({ ...it, out: { blob, url: URL.createObjectURL(blob), name: it.file.name.replace(/\.(heic|heif)$/i, '') + '.' + ext } });
        } catch { next.push({ ...it, error: 'This file couldn’t be decoded. It may be damaged or not a real HEIC photo.' }); }
      }
      setItems(next); setPhase('done');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setPhase('edit'); }
  };

  const done = items.filter((i) => i.out);
  const downloadAll = async () => {
    if (done.length === 1) return downloadBlob(done[0].out!.blob, done[0].out!.name, fmt);
    const { makeZip } = await import('../lib/zip');
    downloadBlob(await makeZip(done.map((i) => ({ name: i.out!.name, data: i.out!.blob }))), 'converted-photos.zip', 'application/zip');
  };
  const reset = () => { items.forEach((i) => i.out && URL.revokeObjectURL(i.out.url)); setItems([]); setPhase('edit'); setError(null); };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {phase !== 'done' && <Dropzone accept=".heic,.heif,image/heic,image/heif" multiple compact={items.length > 0} title="Drag & drop iPhone photos (HEIC)" buttonLabel={items.length ? 'Add more' : 'Select HEIC photos'} onFiles={add} />}
      {error && <ErrorBox onRetry={() => setError(null)}>{error}</ErrorBox>}

      {items.length > 0 && (
        <ul class="divide-y divide-line rounded-control border border-line text-sm dark:divide-white/10 dark:border-white/10">
          {items.map((it) => (
            <li key={it.id} class="flex items-center gap-3 p-2.5">
              {it.out ? <img src={it.out.url} alt="" class="h-12 w-12 rounded object-cover" /> : <span class="grid h-12 w-12 place-items-center rounded bg-surface text-xs font-bold text-muted dark:bg-white/5">HEIC</span>}
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{it.out?.name ?? it.file.name}</p>
                <p class={`text-xs ${it.error ? 'text-danger' : 'text-muted dark:text-gray-400'}`}>{it.error ?? (it.out ? `${formatBytes(it.file.size)} → ${formatBytes(it.out.blob.size)}` : formatBytes(it.file.size))}</p>
              </div>
              {it.out && <button type="button" class="btn-ghost min-h-10 px-3" onClick={() => downloadBlob(it.out!.blob, it.out!.name, fmt)}>Save</button>}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && phase === 'edit' && (
        <>
          <OptionChips<Fmt> label="Convert to" value={fmt} onChange={(v) => v && setFmt(v)} options={[{ value: 'image/jpeg', label: 'JPG', sub: 'Smaller, works everywhere' }, { value: 'image/png', label: 'PNG', sub: 'Lossless' }]} variant="cards" />
          <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Convert {items.length} photo{items.length > 1 ? 's' : ''}</button>
        </>
      )}
      {phase === 'working' && <ProgressBar label={progress.label} value={progress.value} detail="Photos are converted on your device. Nothing is uploaded." />}
      {phase === 'done' && (
        <div class="grid gap-3 sm:grid-cols-2">
          <button type="button" class="btn-primary min-h-12 text-[15px]" disabled={!done.length} onClick={downloadAll}>{done.length > 1 ? `Download all (${done.length}) as .zip` : 'Download'}</button>
          <button type="button" class="btn-secondary min-h-12" onClick={reset}>Convert more photos</button>
        </div>
      )}
      <PrivacyNote />
    </div>
  );
}
