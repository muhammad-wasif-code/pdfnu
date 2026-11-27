import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ResultCard from '../components/ui/ResultCard';
import OutputList, { downloadAll, type OutFile } from '../components/ui/OutputList';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { StickyActions } from '../components/ui/Sticky';
import { formatBytes, stripExt } from '../lib/format';

interface Item { id: number; file: File; bytes: Uint8Array; w: number; h: number; dpi: number | null; }
let seq = 0;
const PRESETS = [72, 96, 150, 200, 300, 600];

export default function ChangeDpi() {
  const [items, setItems] = useState<Item[]>([]);
  const [dpi, setDpiV] = useState(300);
  const [outs, setOuts] = useState<OutFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (files: File[]) => {
    setError(null);
    const [{ readDpi }, { decodeImage }] = await Promise.all([import('../lib/dpi'), import('../lib/image')]);
    const fresh: Item[] = [];
    for (const f of files) {
      if (!/\.(jpe?g|png)$/i.test(f.name) && !/jpeg|png/.test(f.type)) { setError('Only JPG and PNG files store a DPI value. Convert other formats first with Image Converter.'); continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      const d = await decodeImage(f, f.name); const w = d.width, h = d.height; d.close();
      fresh.push({ id: seq++, file: f, bytes, w, h, dpi: readDpi(bytes) });
    }
    setItems((c) => [...c, ...fresh]); setOuts(null);
  };
  const run = async () => {
    const { setDpi } = await import('../lib/dpi');
    setOuts(items.map((it) => ({ name: `${stripExt(it.file.name)}-${dpi}dpi.${/png/i.test(it.file.type) || /\.png$/i.test(it.file.name) ? 'png' : 'jpg'}`, data: setDpi(it.bytes, dpi), note: `${((it.w / dpi) * 2.54).toFixed(1)} × ${((it.h / dpi) * 2.54).toFixed(1)} cm when printed` })));
  };
  const cm = (px: number) => ((px / dpi) * 2.54).toFixed(1), inch = (px: number) => (px / dpi).toFixed(2);

  if (outs) return (
    <div class="card p-4 sm:p-6">
      <ResultCard title={`DPI set to ${dpi}!`} stats={[['Images', String(outs.length)], ['DPI', String(dpi)], ['Size', formatBytes(outs.reduce((t, o) => t + o.data.length, 0))]]}
        highlight="Only the DPI value changed: the pixels and the picture quality are exactly the same."
        onDownload={() => downloadAll(outs, `images-${dpi}dpi.zip`)} downloadLabel={outs.length > 1 ? 'Download all (.zip)' : 'Download image'} onReset={() => { setItems([]); setOuts(null); }} resetLabel="Change other images">
        <OutputList files={outs} />
        <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setOuts(null)}>← Change DPI</button>
      </ResultCard>
    </div>
  );
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <Dropzone accept=".jpg,.jpeg,.png,image/jpeg,image/png" multiple compact={items.length > 0} title={items.length ? 'Add more images' : 'Drag & drop your JPG or PNG images'} buttonLabel={items.length ? 'Add images' : 'Select images'} hint={items.length ? undefined : 'For forms that ask for 200 or 300 DPI photos.'} onFiles={add} />
      {error && <ErrorBox>{error}</ErrorBox>}
      {items.length > 0 && (
        <>
          <fieldset>
            <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">New DPI</legend>
            <div class="flex flex-wrap items-center gap-2">
              {PRESETS.map((p) => <button key={p} type="button" aria-pressed={dpi === p} onClick={() => setDpiV(p)} class={`min-h-11 rounded-control border px-4 text-sm font-semibold ${dpi === p ? 'border-brand bg-brand-soft text-brand ring-1 ring-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-surface dark:border-white/10 dark:bg-white/[.03]'}`}>{p}</button>)}
              <input type="number" min={1} max={9600} value={dpi} onInput={(e) => setDpiV(Math.max(1, +(e.target as HTMLInputElement).value || 1))} aria-label="Custom DPI" class="h-11 w-24 rounded-control border border-line bg-white px-3 dark:border-white/10 dark:bg-night-2" />
            </div>
          </fieldset>
          <ul class="space-y-1 text-sm">
            {items.map((it) => (
              <li key={it.id} class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 dark:bg-white/5">
                <span class="min-w-0 truncate font-semibold">{it.file.name}</span>
                <span class="text-xs text-muted dark:text-gray-400">{it.w}×{it.h} px · now {it.dpi ?? 'not set (72)'} DPI → prints at {cm(it.w)} × {cm(it.h)} cm ({inch(it.w)}″ × {inch(it.h)}″)</span>
              </li>
            ))}
          </ul>
          <StickyActions><button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Set {dpi} DPI on {items.length} image{items.length === 1 ? '' : 's'}</button></StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
