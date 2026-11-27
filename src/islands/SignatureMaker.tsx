import { useState } from 'preact/hooks';
import SignaturePad, { type SignatureImage } from '../components/ui/SignaturePad';
import OptionChips from '../components/ui/OptionChips';
import { PrivacyNote } from '../components/ui/Notice';
import { downloadBlob } from '../lib/download';

/** Draw, type or upload a signature and download it as a transparent PNG, JPG or SVG-wrapped PNG. */
export default function SignatureMaker() {
  const [sig, setSig] = useState<SignatureImage | null>(null);
  const [open, setOpen] = useState(false);
  const [bg, setBg] = useState<'transparent' | 'white'>('transparent');
  const [width, setWidth] = useState<'300' | '600' | '1200'>('600');

  const save = async (fmt: 'png' | 'jpg') => {
    if (!sig) return;
    const img = new Image(); img.src = sig.url; await img.decode();
    const w = +width, h = Math.round(w / sig.aspect);
    const pad = Math.round(w * 0.04);
    const c = document.createElement('canvas'); c.width = w + pad * 2; c.height = h + pad * 2;
    const ctx = c.getContext('2d')!;
    if (fmt === 'jpg' || bg === 'white') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, pad, pad, w, h);
    c.toBlob((b) => b && downloadBlob(b, `signature.${fmt}`, fmt === 'png' ? 'image/png' : 'image/jpeg'), fmt === 'png' ? 'image/png' : 'image/jpeg', 0.95);
  };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {open && <SignaturePad title="Create your signature" onDone={(s) => { if (sig) URL.revokeObjectURL(sig.url); setSig(s); setOpen(false); }} onClose={() => setOpen(false)} />}
      {!sig ? (
        <div class="grid place-items-center gap-3 rounded-card border-2 border-dashed border-indigo-300/80 px-4 py-10 text-center dark:border-brand-light/30">
          <p class="text-lg font-semibold text-ink dark:text-white">Draw, type or upload your signature</p>
          <p class="text-sm text-muted dark:text-gray-400">You get a clean PNG with a transparent background.</p>
          <button type="button" class="btn-primary min-h-12 px-6" onClick={() => setOpen(true)}>✍️ Create signature</button>
        </div>
      ) : (
        <>
          <div class="grid place-items-center rounded-control border border-line p-6 dark:border-white/10" style={{ background: bg === 'white' ? '#fff' : 'repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/16px 16px' }}>
            <img src={sig.url} alt="Your signature" class="max-h-40 max-w-full" />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <OptionChips<'transparent' | 'white'> label="Background (PNG)" value={bg} onChange={(v) => v && setBg(v)} options={[{ value: 'transparent', label: 'Transparent' }, { value: 'white', label: 'White' }]} />
            <OptionChips<'300' | '600' | '1200'> label="Width (pixels)" value={width} onChange={(v) => v && setWidth(v)} options={[{ value: '300', label: '300' }, { value: '600', label: '600' }, { value: '1200', label: '1200' }]} />
          </div>
          <div class="grid gap-2 sm:grid-cols-3">
            <button type="button" class="btn-primary min-h-12" onClick={() => save('png')}>Download PNG</button>
            <button type="button" class="btn-secondary min-h-12" onClick={() => save('jpg')}>Download JPG</button>
            <button type="button" class="btn-secondary min-h-12" onClick={() => setOpen(true)}>Make a new one</button>
          </div>
          <p class="text-sm text-muted dark:text-gray-400">Use it on documents with <a class="underline" href="/sign-pdf">Sign PDF</a>, or as an e-mail signature image.</p>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
