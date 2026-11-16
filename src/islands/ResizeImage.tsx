import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt, KB } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { IMAGE_ACCEPT, isImage, type Fit, type OutType } from '../lib/image';

interface Preset { id: string; label: string; w: number; h: number; note: string; }
const PRESETS: Preset[] = [
  { id: 'passport', label: 'Passport 35×45 mm', w: 413, h: 531, note: '413×531 px at 300 DPI' },
  { id: 'square2in', label: '2×2 inch', w: 600, h: 600, note: '600×600 px at 300 DPI' },
  { id: 'sign', label: 'Signature strip', w: 300, h: 100, note: '300×100 px (3:1)' },
  { id: 'social', label: 'Square 1080', w: 1080, h: 1080, note: 'Social media post' },
  { id: 'hd', label: 'HD 1920×1080', w: 1920, h: 1080, note: 'Wallpaper / slides' },
];
type Fmt = 'image/jpeg' | 'image/png' | 'image/webp';
const EXT: Record<Fmt, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export default function ResizeImage() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [lock, setLock] = useState(true);
  const [fit, setFit] = useState<Fit>('cover');
  const [fmt, setFmt] = useState<Fmt>('image/jpeg');
  const [maxKb, setMaxKb] = useState('');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<{ blob: Blob; name: string; missed: boolean; w: number; h: number } | null>(null);
  const [outUrl, setOutUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef('');
  urlRef.current = url;
  useEffect(() => () => { URL.revokeObjectURL(urlRef.current); }, []);

  const open = async (files: File[]) => {
    const f = files[0];
    if (!isImage(f)) { setError('Choose a JPG, PNG or WebP image.'); return; }
    setError(null);
    try {
      const { decodeImage } = await import('../lib/image');
      const d = await decodeImage(f, f.name);
      setNat({ w: d.width, h: d.height }); setW(d.width); setH(d.height);
      d.close();
      if (url) URL.revokeObjectURL(url);
      setFile(f); setUrl(URL.createObjectURL(f));
      setFmt(f.type === 'image/png' ? 'image/png' : f.type === 'image/webp' ? 'image/webp' : 'image/jpeg');
    } catch (e) { setError(friendlyError(e).message); }
  };

  const choosePreset = (id: string | null) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p) { setW(p.w); setH(p.h); setLock(false); setFit('cover'); if (fmt === 'image/png') setFmt('image/jpeg'); }
    else if (nat) { setW(nat.w); setH(nat.h); setLock(true); }
  };
  const setWidth = (v: number) => { setPreset(null); setW(v); if (lock && nat && v > 0) setH(Math.max(1, Math.round((v * nat.h) / nat.w))); };
  const setHeight = (v: number) => { setPreset(null); setH(v); if (lock && nat && v > 0) setW(Math.max(1, Math.round((v * nat.w) / nat.h))); };
  const scale = (pct: number) => { if (!nat) return; setPreset(null); setLock(true); setW(Math.round((nat.w * pct) / 100)); setH(Math.round((nat.h * pct) / 100)); };

  const valid = w >= 1 && h >= 1 && w <= 12000 && h <= 12000 && w * h <= 60_000_000;

  const run = async () => {
    if (!file || !valid) return;
    setPhase('working'); setError(null);
    try {
      const { decodeImage, draw, toBlob, encodeUnder } = await import('../lib/image');
      const d = await decodeImage(file, file.name);
      const mode: Fit = lock ? 'stretch' : fit;
      const c = draw(d, w, h, mode, fmt === 'image/png' ? null : '#ffffff');
      d.close();
      const limit = Number(maxKb) > 0 ? Number(maxKb) * KB : null;
      let blob: Blob, missed = false;
      if (limit) {
        const enc = await encodeUnder({ source: c, width: c.width, height: c.height, close() {} }, limit, fmt as OutType, { keepSize: true });
        blob = enc.blob; missed = enc.missed;
      } else blob = await toBlob(c, fmt, 0.92);
      c.width = c.height = 0;
      const ext = limit && fmt === 'image/png' ? 'jpg' : EXT[fmt];
      const name = `${stripExt(file.name)}-${w}x${h}.${ext}`;
      if (outUrl) URL.revokeObjectURL(outUrl);
      setOutUrl(URL.createObjectURL(blob));
      setOut({ blob, name, missed, w, h });
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setNat(null); setOut(null); setPreset(null); setMaxKb(''); setPhase('edit'); };

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Image resized!" stats={[['Before', `${nat!.w}×${nat!.h}`], ['After', `${out.w}×${out.h}`], ['Size', formatBytes(out.blob.size)]]}
          warnings={out.missed ? [`Couldn’t get under ${maxKb}KB at ${out.w}×${out.h}px. This is the smallest version at that size. Try smaller dimensions.`] : []}
          onDownload={() => downloadBlob(out.blob, out.name, out.blob.type)} downloadLabel={`Download ${out.name.length > 30 ? 'image' : out.name}`} onReset={reset} resetLabel="Resize another image">
          <img src={outUrl} alt="Resized result" class="mx-auto mt-3 max-h-56 rounded-md border border-line bg-white object-contain dark:border-white/10" />
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change size</button>
        </ResultCard>
      </div>
    );
  }

  const inputCls = 'h-12 w-full rounded-control border border-line bg-white px-3 text-[15px] tabular-nums outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 dark:border-white/10 dark:bg-night-2';
  const previewFit = lock ? 'fill' : fit === 'cover' ? 'cover' : fit === 'contain' ? 'contain' : 'fill';

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept={IMAGE_ACCEPT} title="Drag & drop your image here" buttonLabel="Select image" hint="JPG, PNG or WebP" onFiles={open} />
        : <FileRow kind="IMG" name={file.name} size={`${nat?.w}×${nat?.h}px · ${formatBytes(file.size)}`} onRemove={reset} />}
      {error && <ErrorBox>{error}</ErrorBox>}

      {file && nat && (
        <div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_200px]">
          <div class="space-y-4">
            <fieldset>
              <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Presets</legend>
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => choosePreset(preset === p.id ? null : p.id)}
                    class={`min-h-14 rounded-control border px-2 py-2 text-left transition-colors ${preset === p.id ? 'border-brand bg-brand-soft ring-1 ring-brand dark:bg-brand/15' : 'border-line bg-surface hover:border-indigo-300 dark:border-white/10 dark:bg-white/[.03]'}`}>
                    <span class={`block text-[13px] font-semibold ${preset === p.id ? 'text-brand dark:text-brand-light' : 'text-ink dark:text-white'}`}>{p.label}</span>
                    <span class="block text-[11px] text-muted dark:text-gray-400">{p.note}</span>
                  </button>
                ))}
              </div>
              <p class="mt-2 text-xs text-muted dark:text-gray-400">Always check the exact size the official portal asks for. Requirements change.</p>
            </fieldset>

            <div class="flex items-end gap-2">
              <label class="flex-1"><span class="mb-1.5 block text-sm font-semibold text-ink dark:text-white">Width (px)</span>
                <input type="number" min={1} max={12000} value={w || ''} onInput={(e) => setWidth(Number((e.target as HTMLInputElement).value))} class={inputCls} /></label>
              <button type="button" onClick={() => setLock(!lock)} aria-pressed={lock} aria-label={lock ? 'Unlock aspect ratio' : 'Lock aspect ratio'} title="Keep aspect ratio"
                class={`grid h-12 w-12 shrink-0 place-items-center rounded-control border ${lock ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line text-gray-500 dark:border-white/10'}`}>
                <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 12 12 8M7 9.5 5.5 11a2.5 2.5 0 0 0 3.5 3.5L10.5 13M13 10.5 14.5 9A2.5 2.5 0 0 0 11 5.5L9.5 7" />{!lock && <path d="m3 3 14 14" />}</svg>
              </button>
              <label class="flex-1"><span class="mb-1.5 block text-sm font-semibold text-ink dark:text-white">Height (px)</span>
                <input type="number" min={1} max={12000} value={h || ''} onInput={(e) => setHeight(Number((e.target as HTMLInputElement).value))} class={inputCls} /></label>
            </div>
            <div class="flex flex-wrap gap-2">
              {[25, 50, 75].map((p) => <button key={p} type="button" class="btn-secondary min-h-10 px-3" onClick={() => scale(p)}>{p}%</button>)}
            </div>
            {!valid && <p class="text-sm text-danger" role="alert">Use a size between 1 and 12000 px per side (max 60 megapixels).</p>}

            {!lock && (
              <OptionChips label="If the shape changes" options={[{ value: 'cover', label: 'Crop to fill' }, { value: 'contain', label: 'Add white border' }, { value: 'stretch', label: 'Stretch' }]} value={fit} onChange={(v) => v && setFit(v)} />
            )}
            <div class="flex flex-wrap items-end gap-4">
              <OptionChips label="Format" options={[{ value: 'image/jpeg', label: 'JPG' }, { value: 'image/png', label: 'PNG' }, { value: 'image/webp', label: 'WebP' }]} value={fmt} onChange={(v) => v && setFmt(v)} />
              <label><span class="mb-1.5 block text-sm font-semibold text-ink dark:text-white">Max size (KB, optional)</span>
                <input type="number" min={5} placeholder="e.g. 50" value={maxKb} onInput={(e) => setMaxKb((e.target as HTMLInputElement).value)} class={`${inputCls} w-36`} /></label>
            </div>
          </div>
          <div>
            <p class="mb-2 text-sm font-semibold text-ink dark:text-white">Preview</p>
            <div class="mx-auto grid max-w-[200px] place-items-center rounded-md border border-dashed border-line bg-surface p-2 dark:border-white/10 dark:bg-white/5">
              <img src={url} alt="" class="max-h-56 w-full bg-white" style={{ aspectRatio: valid ? `${w} / ${h}` : undefined, objectFit: previewFit as any }} />
            </div>
            <p class="mt-2 text-center text-xs tabular-nums text-muted dark:text-gray-400">{w}×{h}px</p>
          </div>
        </div>
      )}

      {file && (phase === 'working' ? <ProgressBar label="Resizing…" value={null} /> : (
        <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!valid} onClick={run}>Resize image</button>
      ))}
      <PrivacyNote />
    </div>
  );
}
