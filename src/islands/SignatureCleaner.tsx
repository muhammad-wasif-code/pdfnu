import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt, KB } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { IMAGE_ACCEPT, isImage } from '../lib/image';

type Ink = 'original' | 'black' | 'blue';
const INK: Record<Ink, [number, number, number] | null> = { original: null, black: [17, 24, 39], blue: [29, 78, 216] };
type Limit = 'none' | '10' | '20' | '50';

export default function SignatureCleaner() {
  const [file, setFile] = useState<File | null>(null);
  const [threshold, setThreshold] = useState(185);
  const [ink, setInk] = useState<Ink>('black');
  const [bg, setBg] = useState<'transparent' | 'white'>('transparent');
  const [limit, setLimit] = useState<Limit>('none');
  const [preview, setPreview] = useState<{ url: string; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = useRef<HTMLCanvasElement | null>(null);
  const result = useRef<HTMLCanvasElement | null>(null);

  const open = async (files: File[]) => {
    const f = files[0];
    if (!isImage(f)) { setError('Choose a JPG, PNG or WebP photo of your signature.'); return; }
    setError(null);
    try {
      const { decodeImage, draw } = await import('../lib/image');
      const d = await decodeImage(f, f.name);
      const s = Math.min(1, 2000 / Math.max(d.width, d.height));
      source.current = draw(d, d.width * s, d.height * s);
      d.close();
      setFile(f);
    } catch (e) { setError(friendlyError(e).message); }
  };

  // live preview (debounced)
  useEffect(() => {
    if (!file || !source.current) return;
    const t = setTimeout(async () => {
      const { cleanInk, trimCanvas, toBlob } = await import('../lib/image');
      const cleaned = cleanInk(source.current!, threshold, INK[ink]);
      const trimmed = trimCanvas(cleaned);
      cleaned.width = cleaned.height = 0;
      if (!trimmed) { setPreview(null); setError('No ink found. Move the slider to the right, or use a clearer photo.'); return; }
      setError(null);
      result.current = trimmed;
      const blob = await toBlob(trimmed, 'image/png');
      setPreview((old) => { if (old) URL.revokeObjectURL(old.url); return { url: URL.createObjectURL(blob), w: trimmed.width, h: trimmed.height }; });
    }, 120);
    return () => clearTimeout(t);
  }, [file, threshold, ink]);

  const download = async () => {
    const c = result.current;
    if (!c || !file) return;
    setBusy(true);
    try {
      const { toBlob, encodeUnder, fromCanvas } = await import('../lib/image');
      const base = `${stripExt(file.name)}-signature`;
      if (bg === 'transparent') {
        downloadBlob(await toBlob(c, 'image/png'), `${base}.png`, 'image/png');
      } else {
        const white = document.createElement('canvas');
        white.width = c.width; white.height = c.height;
        const ctx = white.getContext('2d')!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, white.width, white.height); ctx.drawImage(c, 0, 0);
        let blob: Blob;
        if (limit !== 'none') {
          const enc = await encodeUnder(fromCanvas(white), Number(limit) * KB, 'image/jpeg');
          blob = enc.blob;
          if (enc.missed) setError(`Couldn’t reach ${limit}KB. Saved the smallest version (${formatBytes(blob.size)}).`);
        } else blob = await toBlob(white, 'image/jpeg', 0.92);
        downloadBlob(blob, `${base}.jpg`, 'image/jpeg');
      }
    } catch (e) { setError(friendlyError(e).message); }
    setBusy(false);
  };

  const reset = () => { if (preview) URL.revokeObjectURL(preview.url); setPreview(null); setFile(null); source.current = null; result.current = null; };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept={IMAGE_ACCEPT} title="Drag & drop a photo of your signature" buttonLabel="Select photo" hint="Sign on white paper with a dark pen, photograph in daylight" onFiles={open} />
        : <FileRow kind="IMG" name={file.name} size={formatBytes(file.size)} onRemove={reset} />}
      {error && <ErrorBox>{error}</ErrorBox>}

      {file && (
        <>
          <div class="rounded-control border border-line bg-[repeating-conic-gradient(#e5e7eb_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-4 dark:border-white/10">
            {preview ? <img src={preview.url} alt="Cleaned signature preview" class="mx-auto max-h-48 w-auto" style={bg === 'white' ? { background: '#fff' } : undefined} />
              : <p class="py-10 text-center text-sm text-muted">Processing…</p>}
          </div>
          {preview && <p class="text-center text-xs tabular-nums text-muted dark:text-gray-400">{preview.w} × {preview.h} px · auto-cropped</p>}

          <label class="block">
            <span class="mb-1.5 flex justify-between text-sm font-semibold text-ink dark:text-white">Background removal <span class="font-normal text-muted dark:text-gray-400">{threshold < 160 ? 'gentle' : threshold > 210 ? 'strong' : 'balanced'}</span></span>
            <input type="range" min={120} max={240} step={5} value={threshold} onInput={(e) => setThreshold(Number((e.target as HTMLInputElement).value))} class="h-11 w-full accent-brand" aria-label="Background removal strength" />
            <span class="text-xs text-muted dark:text-gray-400">Shadows or gray paper left behind? Move right. Thin strokes disappearing? Move left.</span>
          </label>

          <div class="grid gap-4 sm:grid-cols-2">
            <OptionChips label="Ink colour" options={[{ value: 'black', label: 'Black' }, { value: 'blue', label: 'Blue' }, { value: 'original', label: 'Original' }]} value={ink} onChange={(v) => v && setInk(v)} />
            <OptionChips label="Background" options={[{ value: 'transparent', label: 'Transparent PNG' }, { value: 'white', label: 'White JPG' }]} value={bg} onChange={(v) => v && setBg(v)} />
          </div>
          {bg === 'white' && (
            <OptionChips label="Max size for forms (optional)" options={[{ value: 'none', label: 'No limit' }, { value: '10', label: '10KB' }, { value: '20', label: '20KB' }, { value: '50', label: '50KB' }]} value={limit} onChange={(v) => v && setLimit(v)} />
          )}

          <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!preview || busy} onClick={download}>
            {busy ? 'Saving…' : `Download ${bg === 'transparent' ? 'PNG' : 'JPG'}`}
          </button>
          <p class="text-center text-xs text-muted dark:text-gray-400">Need exact pixels for a form? Open the result in <a class="font-semibold text-brand underline dark:text-brand-light" href="/resize-image">Resize Image</a>. To sign a PDF, use <a class="font-semibold text-brand underline dark:text-brand-light" href="/sign-pdf">Sign PDF</a>.</p>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
