import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import ProgressBar from '../components/ui/ProgressBar';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, percentSaved, stripExt, KB } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { IMAGE_ACCEPT, isImage, type OutType } from '../lib/image';

export type Target = '20' | '30' | '50' | '100' | '200';
type Fmt = 'image/jpeg' | 'image/webp';
interface Item { id: string; file: File; url: string; out?: { blob: Blob; name: string; w: number; h: number; missed: boolean; unchanged: boolean; url: string }; error?: string; }

let seq = 0;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export default function CompressImage({ initialTarget }: { initialTarget?: Target } = {}) {
  const [items, setItems] = useState<Item[]>([]);
  const [target, setTarget] = useState<Target>(initialTarget ?? '50');
  const [fmt, setFmt] = useState<Fmt>('image/jpeg');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(items);
  ref.current = items;
  useEffect(() => () => ref.current.forEach((i) => URL.revokeObjectURL(i.url)), []);
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('target');
    if (t && ['20', '30', '50', '100', '200'].includes(t)) setTarget(t as Target);
  }, []);

  const add = (files: File[]) => {
    const ok = files.filter(isImage);
    setError(ok.length < files.length ? `${files.length - ok.length} file(s) skipped. Only JPG, PNG and WebP images are supported.` : null);
    setItems((c) => [...c, ...ok.map((file) => ({ id: `c${seq++}`, file, url: URL.createObjectURL(file) }))]);
    setPhase('edit');
  };

  const run = async () => {
    setPhase('working');
    items.forEach((i) => { if (i.out && i.out.url !== i.url) URL.revokeObjectURL(i.out.url); });
    const { decodeImage, encodeUnder } = await import('../lib/image');
    const limit = Number(target) * KB;
    const next: Item[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      setProgress({ label: `Compressing ${it.file.name} (${i + 1} of ${items.length})…`, value: i / items.length });
      try {
        const name = `${stripExt(it.file.name)}.${EXT[fmt]}`;
        if (it.file.size <= limit && it.file.type === fmt) {
          next.push({ ...it, out: { blob: it.file, name: it.file.name, w: 0, h: 0, missed: false, unchanged: true, url: it.url } });
          continue;
        }
        const d = await decodeImage(it.file, it.file.name);
        const enc = await encodeUnder(d, limit, fmt as OutType);
        d.close();
        next.push({ ...it, error: undefined, out: { blob: enc.blob, name, w: enc.width, h: enc.height, missed: enc.missed, unchanged: false, url: URL.createObjectURL(enc.blob) } });
      } catch (e) {
        next.push({ ...it, out: undefined, error: friendlyError(e).message });
      }
    }
    setItems(next);
    setPhase('done');
  };

  const done = items.filter((i) => i.out);
  const downloadAll = async () => {
    if (done.length === 1) return downloadBlob(done[0].out!.blob, done[0].out!.name, done[0].out!.blob.type);
    const { makeZip } = await import('../lib/zip');
    downloadBlob(await makeZip(done.map((i) => ({ name: i.out!.name, data: i.out!.blob }))), 'compressed-images.zip', 'application/zip');
  };
  const reset = () => { items.forEach((i) => { URL.revokeObjectURL(i.url); if (i.out && i.out.url !== i.url) URL.revokeObjectURL(i.out.url); }); setItems([]); setPhase('edit'); setError(null); };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {phase !== 'done' && (
        <Dropzone accept={IMAGE_ACCEPT} multiple compact={items.length > 0} title={items.length ? 'Add more images' : 'Drag & drop your images here'}
          buttonLabel={items.length ? 'Add images' : 'Select images'} hint={items.length ? undefined : 'JPG, PNG or WebP · photos, signatures, scans'} onFiles={add} />
      )}
      {error && <ErrorBox>{error}</ErrorBox>}

      {phase !== 'done' && (
        <div class={`grid gap-4 sm:grid-cols-[1fr_auto] ${phase === 'working' ? 'pointer-events-none opacity-60' : ''}`}>
          <OptionChips label="Target size (maximum)" options={(['20', '30', '50', '100', '200'] as Target[]).map((v) => ({ value: v, label: `${v}KB` }))} value={target} onChange={(v) => v && setTarget(v)} />
          <OptionChips label="Format" options={[{ value: 'image/jpeg', label: 'JPG' }, { value: 'image/webp', label: 'WebP' }]} value={fmt} onChange={(v) => v && setFmt(v)} />
        </div>
      )}

      {items.length > 0 && (
        <ul class="space-y-2">
          {items.map((it) => (
            <li key={it.id} class="flex items-center gap-3 rounded-control border border-line p-2.5 dark:border-white/10">
              <img src={it.out?.url ?? it.url} alt="" class="h-14 w-14 shrink-0 rounded-lg bg-surface object-cover dark:bg-white/5" />
              <div class="min-w-0 flex-1 text-sm">
                <p class="truncate font-semibold text-ink dark:text-white">{it.out?.name ?? it.file.name}</p>
                {it.out ? (
                  <p class={it.out.missed ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}>
                    {formatBytes(it.file.size)} → <strong>{formatBytes(it.out.blob.size)}</strong>
                    {it.out.unchanged ? ' · already under target' : ` · ${percentSaved(it.file.size, it.out.blob.size)}% smaller · ${it.out.w}×${it.out.h}px`}
                    {it.out.missed && ' · couldn’t reach the target, this is the smallest readable version'}
                  </p>
                ) : it.error ? <p class="text-danger">{it.error}</p> : <p class="text-muted dark:text-gray-400">{formatBytes(it.file.size)}</p>}
              </div>
              {it.out ? (
                <button type="button" class="btn-secondary min-h-10 shrink-0 px-3" onClick={() => downloadBlob(it.out!.blob, it.out!.name, it.out!.blob.type)}>Save</button>
              ) : phase === 'edit' && (
                <button type="button" class="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" aria-label={`Remove ${it.file.name}`} onClick={() => { URL.revokeObjectURL(it.url); setItems((c) => c.filter((x) => x.id !== it.id)); }}>
                  <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {phase === 'working' && <ProgressBar label={progress.label} value={progress.value} detail="Processing on your device…" />}
      {phase === 'edit' && items.length > 0 && (
        <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Compress {items.length > 1 ? `${items.length} images` : 'image'} to under {target}KB</button>
      )}
      {phase === 'done' && (
        <div class="space-y-3">
          {done.length > 0 && <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={downloadAll}>{done.length > 1 ? `Download all (${done.length}) as .zip` : `Download ${done[0].out!.name.length > 28 ? 'image' : done[0].out!.name}`}</button>}
          <div class="grid grid-cols-2 gap-3">
            <button type="button" class="btn-secondary min-h-12" onClick={() => setPhase('edit')}>Change target</button>
            <button type="button" class="btn-secondary min-h-12" onClick={reset}>Compress more images</button>
          </div>
        </div>
      )}
      <PrivacyNote />
    </div>
  );
}
