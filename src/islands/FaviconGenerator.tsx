import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';

const SIZES = [16, 32, 48, 180, 192, 512];

/** .ico holding PNG images (supported by every current browser and Windows). */
function ico(pngs: { size: number; data: Uint8Array }[]): Uint8Array {
  const head = 6 + pngs.length * 16;
  const total = head + pngs.reduce((t, p) => t + p.data.length, 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, pngs.length, true);
  let off = head;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    out[e] = p.size >= 256 ? 0 : p.size; out[e + 1] = p.size >= 256 ? 0 : p.size;
    dv.setUint16(e + 4, 1, true); dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, p.data.length, true); dv.setUint32(e + 12, off, true);
    out.set(p.data, off); off += p.data.length;
  });
  return out;
}

type Source = 'image' | 'text';
export default function FaviconGenerator() {
  const [source, setSource] = useState<Source>('image');
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  const [text, setText] = useState('P');
  const [fg, setFg] = useState('#ffffff');
  const [bg, setBg] = useState('#4f46e5');
  const [shape, setShape] = useState<'square' | 'rounded' | 'circle'>('rounded');
  const [padding, setPadding] = useState(8);
  const [name, setName] = useState('My Site');
  const [out, setOut] = useState<{ zip: Blob; ico: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLDivElement>(null);

  const draw = (size: number) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const clipPath = () => { ctx.beginPath(); if (shape === 'circle') ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); else if (shape === 'rounded' && (ctx as any).roundRect) (ctx as any).roundRect(0, 0, size, size, size * 0.22); else ctx.rect(0, 0, size, size); };
    if (source === 'text' || bg !== 'transparent') { clipPath(); ctx.fillStyle = bg === 'transparent' ? 'rgba(0,0,0,0)' : bg; ctx.fill(); }
    const pad = (size * padding) / 100;
    if (source === 'image' && img) {
      ctx.save(); clipPath(); ctx.clip();
      const s = Math.min((size - pad * 2) / img.width, (size - pad * 2) / img.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (size - img.width * s) / 2, (size - img.height * s) / 2, img.width * s, img.height * s);
      ctx.restore();
    } else if (source === 'text' && text.trim()) {
      const t = [...text.trim()].slice(0, 3).join('');
      let px = size * 0.72;
      ctx.font = `700 ${px}px Arial, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      while (ctx.measureText(t).width > size - pad * 2 && px > 4) { px *= 0.9; ctx.font = `700 ${px}px Arial, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`; }
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t, size / 2, size / 2 + px * 0.04);
    }
    return c;
  };
  useEffect(() => {
    if (!preview.current) return;
    preview.current.replaceChildren(...[16, 32, 64, 128].map((s) => { const c = draw(s); c.style.cssText = `width:${s}px;height:${s}px;image-rendering:${s <= 32 ? 'pixelated' : 'auto'}`; return c; }));
  }, [img, text, fg, bg, shape, padding, source]);

  const pick = async (files: File[]) => {
    setError(null);
    try { const [{ decodeImage }, { scaled }] = await Promise.all([import('../lib/image'), import('../lib/imageOps')]); const d = await decodeImage(files[0], files[0].name); setImg(scaled(d, 1024)); d.close(); setOut(null); }
    catch (e) { setError(friendlyError(e).message); }
  };
  const make = async () => {
    const pngs: { size: number; data: Uint8Array }[] = [];
    for (const s of SIZES) { const c = draw(s); const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), 'image/png')); pngs.push({ size: s, data: new Uint8Array(await b.arrayBuffer()) }); }
    const icoBytes = ico(pngs.filter((p) => p.size <= 48));
    const by = (s: number) => pngs.find((p) => p.size === s)!.data;
    const manifest = JSON.stringify({ name, short_name: name.slice(0, 12), icons: [{ src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' }, { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }], theme_color: bg === 'transparent' ? '#ffffff' : bg, background_color: '#ffffff', display: 'standalone' }, null, 2);
    const html = `<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">\n<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">\n<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">\n`;
    const { makeZip } = await import('../lib/zip');
    const zip = await makeZip([
      { name: 'favicon.ico', data: icoBytes }, { name: 'favicon-16x16.png', data: by(16) }, { name: 'favicon-32x32.png', data: by(32) },
      { name: 'apple-touch-icon.png', data: by(180) }, { name: 'android-chrome-192x192.png', data: by(192) }, { name: 'android-chrome-512x512.png', data: by(512) },
      { name: 'site.webmanifest', data: new TextEncoder().encode(manifest) }, { name: 'html-snippet.txt', data: new TextEncoder().encode(html) },
    ]);
    setOut({ zip, ico: icoBytes.length });
  };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <OptionChips<Source> label="Make it from" value={source} onChange={(v) => v && setSource(v)} options={[{ value: 'image', label: 'Logo / image' }, { value: 'text', label: 'Letters or emoji' }]} />
      {source === 'image' ? <Dropzone compact={!!img} accept="image/*" title={img ? 'Use another image' : 'Drag & drop your logo here'} buttonLabel="Select image" hint={img ? undefined : 'A square PNG or SVG-exported PNG works best.'} onFiles={pick} />
        : <input type="text" value={text} maxLength={6} onInput={(e) => setText((e.target as HTMLInputElement).value)} aria-label="Letters or emoji" class="h-12 w-full rounded-control border border-line bg-white px-3 text-center text-xl font-bold dark:border-white/10 dark:bg-night-2" />}
      {error && <ErrorBox>{error}</ErrorBox>}
      <div class="grid gap-4 sm:grid-cols-2">
        <OptionChips<'square' | 'rounded' | 'circle'> label="Shape" value={shape} onChange={(v) => v && setShape(v)} options={[{ value: 'square', label: 'Square' }, { value: 'rounded', label: 'Rounded' }, { value: 'circle', label: 'Circle' }]} />
        <div class="flex flex-wrap items-center gap-3 text-sm">
          <label class="flex items-center gap-2">Background <input type="color" value={bg === 'transparent' ? '#ffffff' : bg} onInput={(e) => setBg((e.target as HTMLInputElement).value)} class="h-9 w-12 cursor-pointer rounded border border-line" /></label>
          {source === 'image' && <label class="flex items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={bg === 'transparent'} onChange={(e) => setBg((e.target as HTMLInputElement).checked ? 'transparent' : '#ffffff')} />Transparent</label>}
          {source === 'text' && <label class="flex items-center gap-2">Text <input type="color" value={fg} onInput={(e) => setFg((e.target as HTMLInputElement).value)} class="h-9 w-12 cursor-pointer rounded border border-line" /></label>}
        </div>
        <label class="block text-sm font-semibold">Padding {padding}%<input type="range" min={0} max={25} value={padding} onInput={(e) => setPadding(+(e.target as HTMLInputElement).value)} class="mt-1 h-9 w-full accent-brand" /></label>
        <label class="block text-sm"><span class="mb-1 block font-semibold">Site name (for the web app manifest)</span><input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} class="h-11 w-full rounded-control border border-line bg-white px-3 dark:border-white/10 dark:bg-night-2" /></label>
      </div>
      <div><p class="mb-2 text-sm font-semibold">Preview (16, 32, 64, 128 px)</p><div ref={preview} class="flex flex-wrap items-end gap-4 rounded-control bg-surface p-4 dark:bg-white/5" /></div>
      {out ? (
        <ResultCard title="Your favicon pack is ready!" stats={[['Files', '8'], ['favicon.ico', formatBytes(out.ico)], ['Zip', formatBytes(out.zip.size)]]}
          highlight="Upload the files to your site’s root folder and paste the lines from html-snippet.txt into the <head>."
          onDownload={async () => { const { downloadBlob } = await import('../lib/download'); downloadBlob(out.zip, 'favicon.zip', 'application/zip'); }} downloadLabel="Download favicon.zip" onReset={() => setOut(null)} resetLabel="Change the design" />
      ) : <button type="button" class="btn-primary min-h-12 w-full" disabled={source === 'image' && !img} onClick={make}>Create favicon pack</button>}
      <PrivacyNote />
    </div>
  );
}
