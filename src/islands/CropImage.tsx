import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import Cropper, { fitRect } from '../components/ui/Cropper';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { IMAGE_ACCEPT, isImage, type Rect } from '../lib/image';

type Ratio = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '35:45';
const RATIOS: Record<Ratio, number | null> = { free: null, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '35:45': 35 / 45 };
type Fmt = 'image/jpeg' | 'image/png' | 'image/webp';
const EXT: Record<Fmt, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export default function CropImage() {
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState('');
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [ratio, setRatio] = useState<Ratio>('free');
  const [turns, setTurns] = useState(0);
  const [fmt, setFmt] = useState<Fmt>('image/jpeg');
  const [out, setOut] = useState<{ blob: Blob; url: string; name: string; w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useRef<Blob | null>(null);

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  /** Decode (EXIF-aware), apply rotation, and show as a blob URL the cropper can use. */
  const load = async (f: File, quarterTurns: number) => {
    const { decodeImage, rotate90, toBlob } = await import('../lib/image');
    const d = await decodeImage(f, f.name);
    const c = rotate90(d, quarterTurns);
    d.close();
    const blob = await toBlob(c, 'image/png');
    working.current = blob;
    setNat({ w: c.width, h: c.height });
    setRect(fitRect(c.width, c.height, RATIOS[ratio]));
    c.width = c.height = 0;
    setSrc((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
  };

  const open = async (files: File[]) => {
    const f = files[0];
    if (!isImage(f)) { setError('Choose a JPG, PNG or WebP image.'); return; }
    setError(null); setOut(null); setTurns(0);
    try {
      setFile(f);
      setFmt(f.type === 'image/png' ? 'image/png' : f.type === 'image/webp' ? 'image/webp' : 'image/jpeg');
      await load(f, 0);
    } catch (e) { setError(friendlyError(e).message); setFile(null); }
  };

  const rotateBy = async (d: number) => { if (!file) return; const t = turns + d; setTurns(t); await load(file, t); };
  const chooseRatio = (r: Ratio) => { setRatio(r); if (RATIOS[r]) setRect(fitRect(nat.w, nat.h, RATIOS[r])); };

  const apply = async () => {
    if (!file || !src) return;
    setError(null);
    try {
      const { decodeImage, crop, toBlob } = await import('../lib/image');
      const d = await decodeImage(working.current!, file.name);
      const c = crop(d, rect, undefined, undefined, fmt === 'image/png' ? null : '#ffffff');
      d.close();
      const blob = await toBlob(c, fmt, 0.92);
      const w = c.width, h = c.height;
      c.width = c.height = 0;
      setOut({ blob, url: URL.createObjectURL(blob), name: `${stripExt(file.name)}-cropped.${EXT[fmt]}`, w, h });
    } catch (e) { setError(friendlyError(e).message); }
  };

  const reset = () => { if (out) URL.revokeObjectURL(out.url); setOut(null); setFile(null); setSrc(''); };

  if (out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Image cropped!" stats={[['Before', `${nat.w}×${nat.h}`], ['After', `${out.w}×${out.h}`], ['Size', formatBytes(out.blob.size)]]}
          onDownload={() => downloadBlob(out.blob, out.name, out.blob.type)} downloadLabel={`Download ${out.name.length > 30 ? 'image' : out.name}`} onReset={reset} resetLabel="Crop another image">
          <img src={out.url} alt="Cropped result" class="mx-auto mt-3 max-h-64 rounded-md border border-line bg-white object-contain dark:border-white/10" />
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => { URL.revokeObjectURL(out.url); setOut(null); }}>← Adjust crop</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept={IMAGE_ACCEPT} title="Drag & drop your image here" buttonLabel="Select image" hint="JPG, PNG or WebP" onFiles={open} />
        : <FileRow kind="IMG" name={file.name} size={`${nat.w}×${nat.h}px · ${formatBytes(file.size)}`} onRemove={reset} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {file && src && (
        <>
          <Cropper src={src} naturalW={nat.w} naturalH={nat.h} aspect={RATIOS[ratio]} value={rect} onChange={setRect} />
          <p class="text-center text-sm tabular-nums text-muted dark:text-gray-400">Crop: {Math.round(rect.w)} × {Math.round(rect.h)} px</p>
          <OptionChips label="Aspect ratio" options={[{ value: 'free', label: 'Free' }, { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' }, { value: '3:4', label: '3:4' }, { value: '16:9', label: '16:9' }, { value: '35:45', label: 'Passport' }]} value={ratio} onChange={(v) => v && chooseRatio(v)} />
          <div class="flex flex-wrap items-end gap-4">
            <div>
              <p class="mb-2 text-sm font-semibold text-ink dark:text-white">Rotate</p>
              <div class="flex gap-2">
                <button type="button" class="btn-secondary min-h-11 px-4" onClick={() => rotateBy(-1)} aria-label="Rotate left">↺</button>
                <button type="button" class="btn-secondary min-h-11 px-4" onClick={() => rotateBy(1)} aria-label="Rotate right">↻</button>
              </div>
            </div>
            <OptionChips label="Format" options={[{ value: 'image/jpeg', label: 'JPG' }, { value: 'image/png', label: 'PNG' }, { value: 'image/webp', label: 'WebP' }]} value={fmt} onChange={(v) => v && setFmt(v)} />
          </div>
          <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={apply}>Crop image</button>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
