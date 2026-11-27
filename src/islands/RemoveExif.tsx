import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ResultCard from '../components/ui/ResultCard';
import OutputList, { downloadAll, type OutFile } from '../components/ui/OutputList';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { StickyActions } from '../components/ui/Sticky';
import { formatBytes, stripExt } from '../lib/format';
import type { MetaInfo } from '../lib/exif';

interface Item { id: number; file: File; bytes: Uint8Array; meta: MetaInfo | null; thumb: string; }
let seq = 0;

export default function RemoveExif() {
  const [items, setItems] = useState<Item[]>([]);
  const [keepIcc, setKeepIcc] = useState(true);
  const [outs, setOuts] = useState<OutFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (files: File[]) => {
    setError(null);
    const { readMeta } = await import('../lib/exif');
    const fresh: Item[] = [];
    for (const f of files) {
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(f.name)) continue;
      const bytes = new Uint8Array(await f.arrayBuffer());
      let meta: MetaInfo | null = null; try { meta = readMeta(bytes); } catch { meta = null; }
      fresh.push({ id: seq++, file: f, bytes, meta, thumb: URL.createObjectURL(f) });
    }
    if (fresh.length < files.length) setError('Some files were skipped: only images can be cleaned.');
    setItems((c) => [...c, ...fresh]); setOuts(null);
  };

  const run = async () => {
    const [{ stripMeta }, { decodeImage, toBlob }] = await Promise.all([import('../lib/exif'), import('../lib/image')]);
    const res: OutFile[] = [];
    for (const it of items) {
      if (it.meta && it.meta.format !== 'other') res.push({ name: it.file.name, data: stripMeta(it.bytes, keepIcc), note: 'lossless' });
      else {
        // HEIC, TIFF, GIF…: re-save as JPEG, which never carries the original metadata
        try { const d = await decodeImage(it.file, it.file.name); const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d')!.drawImage(d.source, 0, 0); d.close(); const b = await toBlob(c, 'image/jpeg', 0.95); res.push({ name: `${stripExt(it.file.name)}.jpg`, data: new Uint8Array(await b.arrayBuffer()), note: 'converted to JPG' }); }
        catch { setError(`“${it.file.name}” couldn’t be read.`); }
      }
    }
    setOuts(res);
  };
  const reset = () => { items.forEach((i) => URL.revokeObjectURL(i.thumb)); setItems([]); setOuts(null); };

  if (outs) {
    const before = items.reduce((t, i) => t + i.bytes.length, 0), after = outs.reduce((t, o) => t + o.data.length, 0);
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Metadata removed!" stats={[['Photos', String(outs.length)], ['Removed', formatBytes(Math.max(0, before - after))], ['Size', formatBytes(after)]]}
          highlight="Location, camera, dates and other hidden details are gone. The picture itself was not re-compressed."
          onDownload={() => downloadAll(outs, 'clean-photos.zip')} downloadLabel={outs.length > 1 ? 'Download all (.zip)' : 'Download photo'} onReset={reset} resetLabel="Clean more photos">
          <OutputList files={outs} />
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <Dropzone accept="image/*,.heic,.heif" multiple compact={items.length > 0} title={items.length ? 'Add more photos' : 'Drag & drop your photos here'} buttonLabel={items.length ? 'Add photos' : 'Select photos'} hint={items.length ? undefined : 'See and remove GPS location, camera details and dates.'} onFiles={add} />
      {error && <ErrorBox>{error}</ErrorBox>}
      {items.map((it) => {
        const m = it.meta;
        const has = m && (m.fields.length || m.gps || m.hasExif || m.hasXmp || m.hasIptc || m.hasComment);
        return (
          <div key={it.id} class="flex gap-3 rounded-control border border-line p-3 dark:border-white/10">
            <img src={it.thumb} alt="" class="h-16 w-16 shrink-0 rounded-md object-cover" />
            <div class="min-w-0 flex-1 text-sm">
              <p class="truncate font-semibold text-ink dark:text-white">{it.file.name} <span class="font-normal text-muted">· {formatBytes(it.file.size)}</span></p>
              {m?.gps && <p class="mt-1 rounded bg-red-50 px-2 py-1 text-red-800 dark:bg-red-400/10 dark:text-red-200">📍 Contains the GPS location where it was taken ({m.gps.lat.toFixed(4)}, {m.gps.lon.toFixed(4)})</p>}
              {m?.fields.length ? <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs">{m.fields.slice(0, 10).map(([k, v], i) => <><dt key={`k${i}`} class="text-muted">{k}</dt><dd key={`v${i}`} class="truncate">{v}</dd></>)}</dl> : null}
              <p class="mt-1 text-xs text-muted">{!m || m.format === 'other' ? 'Will be re-saved as JPG without metadata.' : has ? [m.hasExif && 'EXIF', m.hasXmp && 'XMP', m.hasIptc && 'IPTC', m.hasComment && 'comments'].filter(Boolean).join(' · ') + ' found' : 'No hidden metadata found.'}</p>
            </div>
            <button type="button" class="grid h-8 w-8 shrink-0 place-items-center text-muted hover:text-danger" aria-label={`Remove ${it.file.name}`} onClick={() => { URL.revokeObjectURL(it.thumb); setItems((c) => c.filter((x) => x.id !== it.id)); }}>✕</button>
          </div>
        );
      })}
      {items.length > 0 && (
        <>
          <label class="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" class="mt-0.5 h-5 w-5 accent-brand" checked={keepIcc} onChange={(e) => setKeepIcc((e.target as HTMLInputElement).checked)} />
            <span><span class="font-semibold text-ink dark:text-white">Keep colour profile</span><br /><span class="text-muted dark:text-gray-400">It contains no personal data and keeps colours exactly the same.</span></span></label>
          <StickyActions><button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Remove metadata from {items.length} photo{items.length === 1 ? '' : 's'}</button></StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
