import { useEffect, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { TraceOpts } from '../lib/trace';

export default function ImageToSvg() {
  const [file, setFile] = useState<File | null>(null);
  const [work, setWork] = useState<{ data: Uint8ClampedArray; w: number; h: number; ow: number; oh: number } | null>(null);
  const [o, setO] = useState<TraceOpts>({ mode: 'color', colors: 8, threshold: 140, smooth: true, detail: 55, transparentBg: false });
  const [res, setRes] = useState<{ svg: string; paths: number; colors: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [srcUrl, setSrcUrl] = useState('');

  const open = async (files: File[]) => {
    const f = files[0];
    setError(null);
    try {
      const { decodeImage } = await import('../lib/image');
      const d = await decodeImage(f, f.name);
      // trace at up to 700 px: enough detail, still fast
      const k = Math.min(1, 700 / Math.max(d.width, d.height));
      const c = document.createElement('canvas'); c.width = Math.round(d.width * k); c.height = Math.round(d.height * k);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(d.source, 0, 0, c.width, c.height);
      setWork({ data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, ow: d.width, oh: d.height });
      d.close();
      setFile(f); if (srcUrl) URL.revokeObjectURL(srcUrl); setSrcUrl(URL.createObjectURL(f));
      // logos and signatures with few colours trace best in black & white
      setO((x) => ({ ...x, mode: /sign|logo|scan|bw|black/i.test(f.name) ? 'bw' : x.mode, transparentBg: f.type === 'image/png' }));
    } catch (e) { setError(friendlyError(e).message); }
  };

  useEffect(() => {
    if (!work) return;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const { traceToSvg } = await import('../lib/trace');
        setRes(traceToSvg(work.data, work.w, work.h, o, work.ow, work.oh));
      } catch (e) { setError(friendlyError(e).message); }
      setBusy(false);
    }, 120);
    return () => clearTimeout(t);
  }, [work, JSON.stringify(o)]);

  const set = (p: Partial<TraceOpts>) => setO((x) => ({ ...x, ...p }));
  const reset = () => { setFile(null); setWork(null); setRes(null); if (srcUrl) URL.revokeObjectURL(srcUrl); setSrcUrl(''); };
  const svgUrl = res ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(res.svg) : '';

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="image/*" title="Drag & drop a logo, icon, drawing or photo" buttonLabel="Select image" hint="PNG or JPG. Simple graphics give the cleanest result." onFiles={open} />
        : <FileRow name={file.name} size={`${work?.ow}×${work?.oh} · ${formatBytes(file.size)}`} kind="IMG" onRemove={reset} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {work && (
        <>
          <div class="grid gap-3 sm:grid-cols-2">
            <figure class="rounded-control border border-line p-2 dark:border-white/10"><img src={srcUrl} alt="Original" class="mx-auto max-h-72" /><figcaption class="mt-1 text-center text-xs text-muted">Original</figcaption></figure>
            <figure class="relative rounded-control border border-line p-2 dark:border-white/10" style={{ background: 'repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/16px 16px' }}>
              {res && <img src={svgUrl} alt="Vector preview" class="mx-auto max-h-72" />}
              {busy && <span class="absolute right-2 top-2 h-5 w-5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />}
              <figcaption class="mt-1 text-center text-xs text-muted">SVG {res ? `· ${res.colors} colours · ${res.paths} shapes · ${formatBytes(res.svg.length)}` : ''}</figcaption>
            </figure>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <OptionChips<'color' | 'bw'> label="Style" value={o.mode} onChange={(v) => v && set({ mode: v })} options={[{ value: 'color', label: 'Colour' }, { value: 'bw', label: 'Black & white' }]} />
            {o.mode === 'color'
              ? <label class="block text-sm font-semibold">Colours: {o.colors}<input type="range" min={2} max={24} value={o.colors} onInput={(e) => set({ colors: +(e.target as HTMLInputElement).value })} class="mt-1 h-8 w-full accent-brand" /></label>
              : <label class="block text-sm font-semibold">Threshold<input type="range" min={40} max={230} value={o.threshold} onInput={(e) => set({ threshold: +(e.target as HTMLInputElement).value })} class="mt-1 h-8 w-full accent-brand" /></label>}
            <label class="block text-sm font-semibold">Detail<input type="range" min={0} max={100} value={o.detail} onInput={(e) => set({ detail: +(e.target as HTMLInputElement).value })} class="mt-1 h-8 w-full accent-brand" /></label>
            <div class="space-y-1 text-sm">
              <label class="flex min-h-9 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={o.smooth} onChange={(e) => set({ smooth: (e.target as HTMLInputElement).checked })} />Smooth curves</label>
              <label class="flex min-h-9 items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={o.transparentBg} onChange={(e) => set({ transparentBg: (e.target as HTMLInputElement).checked })} />Transparent background</label>
            </div>
          </div>
          {res ? (
            <ResultCard title="Your SVG is ready" stats={[['Colours', String(res.colors)], ['Shapes', String(res.paths)], ['SVG', formatBytes(res.svg.length)]]}
              onDownload={() => downloadBlob(new Blob([res.svg], { type: 'image/svg+xml' }), `${stripExt(file!.name)}.svg`, 'image/svg+xml')} downloadLabel="Download SVG" onReset={reset} resetLabel="Use another image" />
          ) : <ProgressBar label="Tracing…" value={null} />}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
