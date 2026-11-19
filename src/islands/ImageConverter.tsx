import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import ProgressBar from '../components/ui/ProgressBar';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { IMAGE_ACCEPT, isImage } from '../lib/image';

export type Fmt = 'image/jpeg' | 'image/png' | 'image/webp';
const EXT: Record<Fmt, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
interface Item { id: string; file: File; url: string; out?: { blob: Blob; name: string }; error?: string; }
let seq = 0;

export default function ImageConverter({ initialFormat }: { initialFormat?: Fmt } = {}) {
  const [items, setItems] = useState<Item[]>([]);
  const [fmt, setFmt] = useState<Fmt>(initialFormat ?? 'image/jpeg');
  const [quality, setQuality] = useState(90);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState({ label: '', value: 0 });
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(items);
  ref.current = items;
  useEffect(() => () => ref.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const add = (files: File[]) => {
    const ok = files.filter(isImage);
    setError(ok.length < files.length ? `${files.length - ok.length} file(s) skipped. Only JPG, PNG and WebP are supported.` : null);
    setItems((c) => [...c, ...ok.map((file) => ({ id: `v${seq++}`, file, url: URL.createObjectURL(file) }))]);
    setPhase('edit');
  };

  const run = async () => {
    setPhase('working');
    const { decodeImage, draw, toBlob } = await import('../lib/image');
    const next: Item[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      setProgress({ label: `Converting ${it.file.name} (${i + 1} of ${items.length})…`, value: i / items.length });
      try {
        const d = await decodeImage(it.file, it.file.name);
        const c = draw(d, d.width, d.height, 'stretch', fmt === 'image/jpeg' ? '#ffffff' : null);
        d.close();
        const blob = await toBlob(c, fmt, quality / 100);
        c.width = c.height = 0;
        next.push({ ...it, error: undefined, out: { blob, name: `${stripExt(it.file.name)}.${EXT[fmt]}` } });
      } catch (e) { next.push({ ...it, out: undefined, error: friendlyError(e).message }); }
    }
    setItems(next);
    setPhase('done');
  };

  const done = items.filter((i) => i.out);
  const downloadAll = async () => {
    if (done.length === 1) return downloadBlob(done[0].out!.blob, done[0].out!.name, fmt);
    const { makeZip } = await import('../lib/zip');
    downloadBlob(await makeZip(done.map((i) => ({ name: i.out!.name, data: i.out!.blob }))), `converted-${EXT[fmt]}.zip`, 'application/zip');
  };
  const reset = () => { items.forEach((i) => URL.revokeObjectURL(i.url)); setItems([]); setPhase('edit'); setError(null); };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {phase !== 'done' && (
        <Dropzone accept={IMAGE_ACCEPT} multiple compact={items.length > 0} title={items.length ? 'Add more images' : 'Drag & drop your images here'}
          buttonLabel={items.length ? 'Add images' : 'Select images'} hint={items.length ? undefined : 'JPG, PNG or WebP · convert many at once'} onFiles={add} />
      )}
      {error && <ErrorBox>{error}</ErrorBox>}

      {phase !== 'done' && (
        <div class={`grid gap-4 sm:grid-cols-2 ${phase === 'working' ? 'pointer-events-none opacity-60' : ''}`}>
          <OptionChips label="Convert to" options={[{ value: 'image/jpeg', label: 'JPG' }, { value: 'image/png', label: 'PNG' }, { value: 'image/webp', label: 'WebP' }]} value={fmt} onChange={(v) => v && setFmt(v)} />
          {fmt !== 'image/png' && (
            <label class="block">
              <span class="mb-1.5 flex justify-between text-sm font-semibold text-ink dark:text-white">Quality <span class="tabular-nums text-muted dark:text-gray-400">{quality}%</span></span>
              <input type="range" min={40} max={100} step={5} value={quality} onInput={(e) => setQuality(Number((e.target as HTMLInputElement).value))} class="h-11 w-full accent-brand" aria-label="Quality" />
            </label>
          )}
        </div>
      )}
      {fmt === 'image/jpeg' && phase === 'edit' && items.some((i) => /png|webp/i.test(i.file.type)) && (
        <p class="text-xs text-muted dark:text-gray-400">JPG has no transparency. Transparent areas become white.</p>
      )}

      {items.length > 0 && (
        <ul class="space-y-2">
          {items.map((it) => (
            <li key={it.id} class="flex items-center gap-3 rounded-control border border-line p-2.5 dark:border-white/10">
              <img src={it.url} alt="" class="h-12 w-12 shrink-0 rounded-lg bg-surface object-cover dark:bg-white/5" />
              <div class="min-w-0 flex-1 text-sm">
                <p class="truncate font-semibold text-ink dark:text-white">{it.out?.name ?? it.file.name}</p>
                {it.out ? <p class="text-emerald-700 dark:text-emerald-300">{formatBytes(it.file.size)} → <strong>{formatBytes(it.out.blob.size)}</strong></p>
                  : it.error ? <p class="text-danger">{it.error}</p> : <p class="text-muted dark:text-gray-400">{formatBytes(it.file.size)}</p>}
              </div>
              {it.out ? <button type="button" class="btn-secondary min-h-10 shrink-0 px-3" onClick={() => downloadBlob(it.out!.blob, it.out!.name, fmt)}>Save</button>
                : phase === 'edit' && (
                  <button type="button" class="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" aria-label={`Remove ${it.file.name}`} onClick={() => { URL.revokeObjectURL(it.url); setItems((c) => c.filter((x) => x.id !== it.id)); }}>
                    <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
                  </button>
                )}
            </li>
          ))}
        </ul>
      )}

      {phase === 'working' && <ProgressBar label={progress.label} value={progress.value} />}
      {phase === 'edit' && items.length > 0 && <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Convert {items.length > 1 ? `${items.length} images` : 'image'} to {EXT[fmt].toUpperCase()}</button>}
      {phase === 'done' && (
        <div class="space-y-3">
          {done.length > 0 && <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={downloadAll}>{done.length > 1 ? `Download all (${done.length}) as .zip` : `Download ${done[0].out!.name.length > 28 ? 'image' : done[0].out!.name}`}</button>}
          <div class="grid grid-cols-2 gap-3">
            <button type="button" class="btn-secondary min-h-12" onClick={() => setPhase('edit')}>Change format</button>
            <button type="button" class="btn-secondary min-h-12" onClick={reset}>Convert more</button>
          </div>
        </div>
      )}
      <PrivacyNote />
    </div>
  );
}
