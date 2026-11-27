import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from './Dropzone';
import ProgressBar from './ProgressBar';
import ResultCard from './ResultCard';
import OptionChips from './OptionChips';
import OutputList, { downloadAll, type OutFile } from './OutputList';
import { ErrorBox, PrivacyNote } from './Notice';
import { StickyActions } from './Sticky';
import { formatBytes, stripExt } from '../../lib/format';
import { friendlyError } from '../../lib/errors';
import type { Decoded } from '../../lib/image';

export type OutFmt = 'keep' | 'image/jpeg' | 'image/png' | 'image/webp';
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
interface Item { id: number; file: File; thumb: string; }
let seq = 0;

interface Props {
  /** live preview of the selected image: gets a small canvas (max ~900 px), returns the edited canvas */
  preview: (small: HTMLCanvasElement) => HTMLCanvasElement | null;
  /** full-resolution processing */
  process: (img: Decoded) => HTMLCanvasElement;
  /** re-run the preview when these change */
  deps: unknown[];
  controls: ComponentChildren;
  /** called once with the first image (e.g. to read its size) */
  onFirst?: (img: HTMLCanvasElement) => void;
  action: string; suffix: string; done: string;
  /** PNG keeps transparency (rotated corners, logos) */
  defaultFmt?: OutFmt;
}

export default function ImageBatch({ preview, process, deps, controls, onFirst, action, suffix, done, defaultFmt = 'keep' }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [cur, setCur] = useState(0);
  const [small, setSmall] = useState<HTMLCanvasElement | null>(null);
  const [fmt, setFmt] = useState<OutFmt>(defaultFmt);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState(0);
  const [outs, setOuts] = useState<OutFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const view = useRef<HTMLDivElement>(null);

  const add = async (files: File[]) => {
    setError(null);
    const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
    if (imgs.length < files.length) setError('Some files were skipped: only images (JPG, PNG, WebP, GIF, BMP, AVIF) can be added.');
    setItems((c) => [...c, ...imgs.map((file) => ({ id: seq++, file, thumb: URL.createObjectURL(file) }))]);
  };
  useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.thumb)), []);

  // small working copy of the selected image
  useEffect(() => {
    const it = items[cur];
    if (!it) { setSmall(null); return; }
    let live = true;
    (async () => {
      try {
        const [{ decodeImage }, { scaled }] = await Promise.all([import('../../lib/image'), import('../../lib/imageOps')]);
        const d = await decodeImage(it.file, it.file.name);
        const c = scaled(d, 900);
        d.close();
        if (live) { setSmall(c); if (cur === 0) onFirst?.(c); }
      } catch (e) { setError(friendlyError(e).message); }
    })();
    return () => { live = false; };
  }, [items[cur]?.id]);

  // live preview
  useEffect(() => {
    const el = view.current;
    if (!el || !small) return;
    const out = preview(small);
    el.replaceChildren();
    if (out) { out.style.cssText = 'max-width:100%;max-height:60vh;display:block;margin:auto;background:repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/16px 16px'; el.appendChild(out); }
  }, [small, ...deps]);

  const run = async () => {
    setPhase('working'); setError(null); setProgress(0);
    const res: OutFile[] = [];
    try {
      const [{ decodeImage, toBlob }] = await Promise.all([import('../../lib/image')]);
      for (let i = 0; i < items.length; i++) {
        const f = items[i].file;
        const d = await decodeImage(f, f.name);
        const c = process(d);
        d.close();
        const type = fmt === 'keep' ? (/png|gif|webp/.test(f.type) ? (f.type === 'image/webp' ? 'image/webp' : 'image/png') : 'image/jpeg') : fmt;
        const blob = await toBlob(c, type as any, 0.92);
        c.width = c.height = 0;
        res.push({ name: `${stripExt(f.name)}-${suffix}.${EXT[type]}`, data: new Uint8Array(await blob.arrayBuffer()) });
        setProgress((i + 1) / items.length);
      }
      setOuts(res); setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { items.forEach((i) => URL.revokeObjectURL(i.thumb)); setItems([]); setOuts([]); setCur(0); setPhase('edit'); };

  if (phase === 'done') {
    const total = outs.reduce((t, o) => t + o.data.length, 0);
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={done} stats={[['Images', String(outs.length)], ['Format', (outs[0]?.name.split('.').pop() ?? '').toUpperCase()], ['Size', formatBytes(total)]]}
          onDownload={() => downloadAll(outs.map((o) => ({ ...o })), `images-${suffix}.zip`)} downloadLabel={outs.length > 1 ? 'Download all (.zip)' : 'Download image'} onReset={reset} resetLabel="Edit other images">
          <OutputList files={outs} />
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change settings</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <Dropzone accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif" multiple compact={items.length > 0} title={items.length ? 'Add more images' : 'Drag & drop your images here'} buttonLabel={items.length ? 'Add images' : 'Select images'} hint={items.length ? undefined : 'One photo or many: every image gets the same edit.'} onFiles={add} />
      {error && <ErrorBox>{error}</ErrorBox>}
      {items.length > 0 && (
        <>
          {items.length > 1 && (
            <ul class="flex gap-2 overflow-x-auto pb-1" aria-label="Images">
              {items.map((it, i) => (
                <li key={it.id} class="relative shrink-0">
                  <button type="button" aria-pressed={i === cur} aria-label={`Preview ${it.file.name}`} onClick={() => setCur(i)} class={`block h-16 w-16 overflow-hidden rounded-lg border-2 ${i === cur ? 'border-brand' : 'border-line dark:border-white/10'}`}>
                    <img src={it.thumb} alt="" class="h-full w-full object-cover" />
                  </button>
                  <button type="button" aria-label={`Remove ${it.file.name}`} class="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-xs shadow dark:bg-night-3" onClick={() => { URL.revokeObjectURL(it.thumb); setItems((c) => c.filter((x) => x.id !== it.id)); setCur(0); }}>✕</button>
                </li>
              ))}
            </ul>
          )}
          <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div ref={view} class="grid min-h-48 place-items-center rounded-control border border-line bg-surface p-2 dark:border-white/10 dark:bg-white/5">
              {!small && <span class="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />}
            </div>
            <div class="space-y-4">
              {controls}
              <OptionChips<OutFmt> label="Save as" value={fmt} onChange={(v) => v && setFmt(v)} options={[{ value: 'keep', label: 'Same' }, { value: 'image/jpeg', label: 'JPG' }, { value: 'image/png', label: 'PNG' }, { value: 'image/webp', label: 'WebP' }]} />
            </div>
          </div>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Processing images…" value={progress} detail={`${Math.round(progress * items.length)} of ${items.length}`} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>{action} {items.length} image{items.length === 1 ? '' : 's'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
