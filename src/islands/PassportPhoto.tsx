import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import Cropper, { fitRect } from '../components/ui/Cropper';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt, KB } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { IMAGE_ACCEPT, isImage, type Rect } from '../lib/image';

const DPI = 300;
const mm = (v: number) => Math.round((v / 25.4) * DPI);
interface Size { id: string; label: string; sub: string; w: number; h: number; }
const SIZES: Size[] = [
  { id: '35x45', label: '35×45 mm', sub: `${mm(35)}×${mm(45)} px`, w: mm(35), h: mm(45) },
  { id: '2x2', label: '2×2 inch', sub: '600×600 px', w: 600, h: 600 },
  { id: '33x48', label: '33×48 mm', sub: `${mm(33)}×${mm(48)} px`, w: mm(33), h: mm(48) },
  { id: 'custom', label: 'Custom', sub: 'Pixels', w: 0, h: 0 },
];
type Limit = 'none' | '20' | '50' | '100' | '200';

interface Result { photo: Blob; photoUrl: string; sheet: Blob; sheetUrl: string; copies: number; w: number; h: number; missed: boolean; }

export default function PassportPhoto() {
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState('');
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [sizeId, setSizeId] = useState('35x45');
  const [cw, setCw] = useState(400);
  const [ch, setCh] = useState(500);
  const [limit, setLimit] = useState<Limit>('none');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useRef<Blob | null>(null);

  const size = SIZES.find((s) => s.id === sizeId)!;
  const outW = sizeId === 'custom' ? cw : size.w;
  const outH = sizeId === 'custom' ? ch : size.h;
  const validSize = outW >= 50 && outH >= 50 && outW <= 3000 && outH <= 3000;
  const aspect = validSize ? outW / outH : 35 / 45;

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  useEffect(() => { if (nat.w) setRect(fitRect(nat.w, nat.h, aspect, 0.8)); }, [aspect]);

  const open = async (files: File[]) => {
    const f = files[0];
    if (!isImage(f)) { setError('Choose a JPG, PNG or WebP photo.'); return; }
    setError(null); setRes(null);
    try {
      const { decodeImage, draw, toBlob } = await import('../lib/image');
      const d = await decodeImage(f, f.name);
      // normalise orientation + cap working size for speed
      const s = Math.min(1, 4000 / Math.max(d.width, d.height));
      const c = draw(d, d.width * s, d.height * s);
      d.close();
      const blob = await toBlob(c, 'image/jpeg', 0.95);
      working.current = blob;
      setNat({ w: c.width, h: c.height });
      setRect(fitRect(c.width, c.height, aspect, 0.8));
      c.width = c.height = 0;
      setFile(f);
      setSrc((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
    } catch (e) { setError(friendlyError(e).message); }
  };

  const make = async () => {
    if (!working.current || !validSize) return;
    setBusy(true); setError(null);
    try {
      const { decodeImage, crop, toBlob, encodeUnder, fromCanvas, setJpegDpi } = await import('../lib/image');
      const d = await decodeImage(working.current, 'photo');
      const c = crop(d, rect, outW, outH, '#ffffff');
      d.close();
      let photo: Blob, missed = false;
      if (limit !== 'none') {
        const enc = await encodeUnder(fromCanvas(c), Number(limit) * KB, 'image/jpeg', { keepSize: true });
        photo = enc.blob; missed = enc.missed;
      } else photo = await toBlob(c, 'image/jpeg', 0.95);
      photo = await setJpegDpi(photo, DPI);

      // 4×6 inch print sheet (landscape, 300 DPI) with as many copies as fit
      const sheet = document.createElement('canvas');
      sheet.width = 6 * DPI; sheet.height = 4 * DPI;
      const sx = sheet.getContext('2d')!;
      sx.fillStyle = '#fff'; sx.fillRect(0, 0, sheet.width, sheet.height);
      const gap = mm(2), margin = mm(3);
      const cols = Math.max(1, Math.floor((sheet.width - 2 * margin + gap) / (outW + gap)));
      const rows = Math.max(1, Math.floor((sheet.height - 2 * margin + gap) / (outH + gap)));
      const fits = outW <= sheet.width - 2 * margin && outH <= sheet.height - 2 * margin;
      const gridW = cols * outW + (cols - 1) * gap, gridH = rows * outH + (rows - 1) * gap;
      const ox = (sheet.width - gridW) / 2, oy = (sheet.height - gridH) / 2;
      let copies = 0;
      if (fits) {
        sx.strokeStyle = '#d1d5db'; sx.lineWidth = 2;
        for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
          const x = ox + k * (outW + gap), y = oy + r * (outH + gap);
          sx.drawImage(c, x, y, outW, outH);
          sx.strokeRect(x - 1, y - 1, outW + 2, outH + 2);
          copies++;
        }
      }
      c.width = c.height = 0;
      const sheetBlob = await setJpegDpi(await toBlob(sheet, 'image/jpeg', 0.95), DPI);
      sheet.width = sheet.height = 0;
      if (res) { URL.revokeObjectURL(res.photoUrl); URL.revokeObjectURL(res.sheetUrl); }
      setRes({ photo, photoUrl: URL.createObjectURL(photo), sheet: sheetBlob, sheetUrl: URL.createObjectURL(sheetBlob), copies, w: outW, h: outH, missed });
    } catch (e) { setError(friendlyError(e).message); }
    setBusy(false);
  };

  const reset = () => { if (res) { URL.revokeObjectURL(res.photoUrl); URL.revokeObjectURL(res.sheetUrl); } setRes(null); setFile(null); setSrc(''); working.current = null; };
  const base = file ? stripExt(file.name) : 'photo';
  const inputCls = 'h-11 w-28 rounded-control border border-line bg-white px-3 text-[15px] tabular-nums outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 dark:border-white/10 dark:bg-night-2';

  if (res && file) {
    return (
      <div class="card space-y-4 p-4 sm:p-6">
        <div class="rounded-card border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-400/20 dark:bg-emerald-400/[.06]" role="status">
          <p class="font-semibold text-emerald-900 dark:text-emerald-200">Your passport photo is ready!</p>
          <p class="mt-1 text-sm text-emerald-800 dark:text-emerald-300">{res.w}×{res.h} px at {DPI} DPI · {formatBytes(res.photo.size)}{res.copies ? ` · print sheet with ${res.copies} copies` : ''}</p>
        </div>
        {res.missed && <p class="rounded-control border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">Couldn’t get under {limit}KB at this pixel size. This is the smallest version. Check whether the portal allows a larger file.</p>}
        <div class="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
          <img src={res.photoUrl} alt="Passport photo result" class="mx-auto max-h-56 rounded-md border border-line bg-white shadow-sm dark:border-white/10" />
          {res.copies > 0 && <img src={res.sheetUrl} alt="4×6 inch print sheet" class="mx-auto w-full max-w-md rounded-md border border-line bg-white shadow-sm dark:border-white/10" />}
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <button type="button" class="btn-primary min-h-12 text-[15px]" onClick={() => downloadBlob(res.photo, `${base}-passport-${res.w}x${res.h}.jpg`, 'image/jpeg')}>Download photo (for forms)</button>
          {res.copies > 0 && <button type="button" class="btn-secondary min-h-12" onClick={() => downloadBlob(res.sheet, `${base}-print-4x6.jpg`, 'image/jpeg')}>Download 4×6" print sheet</button>}
        </div>
        <div class="grid grid-cols-2 gap-3">
          <button type="button" class="btn-ghost" onClick={() => { URL.revokeObjectURL(res.photoUrl); URL.revokeObjectURL(res.sheetUrl); setRes(null); }}>← Adjust</button>
          <button type="button" class="btn-ghost" onClick={reset}>New photo</button>
        </div>
        <PrivacyNote />
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept={IMAGE_ACCEPT} title="Drag & drop your photo here" buttonLabel="Select photo" hint="Plain light background, face the camera, even light" onFiles={open} />
        : <FileRow kind="IMG" name={file.name} size={`${nat.w}×${nat.h}px · ${formatBytes(file.size)}`} onRemove={reset} />}
      {error && <ErrorBox>{error}</ErrorBox>}

      <fieldset>
        <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Photo size</legend>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SIZES.map((s) => (
            <button key={s.id} type="button" aria-pressed={sizeId === s.id} onClick={() => setSizeId(s.id)}
              class={`min-h-14 rounded-control border px-2 py-2 text-left ${sizeId === s.id ? 'border-brand bg-brand-soft ring-1 ring-brand dark:bg-brand/15' : 'border-line bg-surface hover:border-indigo-300 dark:border-white/10 dark:bg-white/[.03]'}`}>
              <span class={`block text-[13px] font-semibold ${sizeId === s.id ? 'text-brand dark:text-brand-light' : 'text-ink dark:text-white'}`}>{s.label}</span>
              <span class="block text-[11px] text-gray-600 dark:text-gray-400">{s.sub}</span>
            </button>
          ))}
        </div>
        {sizeId === 'custom' && (
          <div class="mt-3 flex flex-wrap items-end gap-3">
            <label><span class="mb-1 block text-xs font-semibold">Width (px)</span><input type="number" min={50} max={3000} value={cw} onInput={(e) => setCw(Number((e.target as HTMLInputElement).value))} class={inputCls} /></label>
            <label><span class="mb-1 block text-xs font-semibold">Height (px)</span><input type="number" min={50} max={3000} value={ch} onInput={(e) => setCh(Number((e.target as HTMLInputElement).value))} class={inputCls} /></label>
            {!validSize && <span class="text-sm text-danger">Use 50–3000 px.</span>}
          </div>
        )}
        <p class="mt-2 text-xs text-muted dark:text-gray-400">Requirements differ by country and portal and change over time. Always check the official size, background and file-size rules.</p>
      </fieldset>

      {file && src && (
        <>
          <div>
            <p class="mb-2 text-sm font-semibold text-ink dark:text-white">Position your face inside the oval</p>
            <Cropper src={src} naturalW={nat.w} naturalH={nat.h} aspect={aspect} value={rect} onChange={setRect} guide="face" />
          </div>
          <OptionChips label="Max file size (optional)" options={[{ value: 'none', label: 'No limit' }, { value: '20', label: '20KB' }, { value: '50', label: '50KB' }, { value: '100', label: '100KB' }, { value: '200', label: '200KB' }]} value={limit} onChange={(v) => v && setLimit(v)} />
          <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={busy || !validSize} onClick={make}>{busy ? 'Creating…' : 'Create passport photo'}</button>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
