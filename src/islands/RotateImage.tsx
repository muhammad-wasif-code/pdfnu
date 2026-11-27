import { useState } from 'preact/hooks';
import ImageBatch from '../components/ui/ImageBatch';
import OptionChips from '../components/ui/OptionChips';
import { rotate, flip } from '../lib/imageOps';

/** Rotate and/or flip. `mode` sets which controls come first (one island for Rotate Image and Flip Image). */
export default function RotateImage({ mode }: { mode: 'rotate' | 'flip' }) {
  const [quarter, setQuarter] = useState(mode === 'rotate' ? 90 : 0);
  const [fine, setFine] = useState(0);
  const [fh, setFh] = useState(mode === 'flip');
  const [fv, setFv] = useState(false);
  const [fit, setFit] = useState<'expand' | 'crop'>('crop');
  const [bg, setBg] = useState<'transparent' | '#ffffff' | '#000000'>('#ffffff');

  const angle = quarter + fine;
  const apply = (src: any) => {
    let c = fh || fv ? flip(src, fh, fv) : src;
    if (angle % 360) c = rotate(c, angle, { expand: fine === 0 || fit === 'expand', background: bg === 'transparent' ? null : bg });
    return c;
  };
  const btn = (active: boolean) => `min-h-11 flex-1 rounded-control border px-3 text-sm font-semibold ${active ? 'border-brand bg-brand-soft text-brand ring-1 ring-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-surface dark:border-white/10 dark:bg-white/[.03]'}`;

  const rotateCtl = (
    <div class="space-y-3" key="r">
      <p class="text-sm font-semibold text-ink dark:text-white">Rotate</p>
      <div class="flex gap-2">
        <button type="button" class={btn(false)} onClick={() => setQuarter((q) => (q + 270) % 360)} aria-label="Rotate left 90 degrees">↺ Left</button>
        <button type="button" class={btn(false)} onClick={() => setQuarter((q) => (q + 90) % 360)} aria-label="Rotate right 90 degrees">↻ Right</button>
        <button type="button" class={btn(quarter === 180)} onClick={() => setQuarter((q) => (q + 180) % 360)}>180°</button>
      </div>
      <label class="flex items-center gap-2 text-sm font-semibold">Straighten
        <input type="range" min={-45} max={45} step={0.5} value={fine} onInput={(e) => setFine(+(e.target as HTMLInputElement).value)} class="h-9 min-w-0 flex-1 accent-brand" />
        <span class="w-12 text-right tabular-nums">{fine}°</span>
      </label>
      {fine !== 0 && (
        <>
          <OptionChips<'expand' | 'crop'> label="Corners" value={fit} onChange={(v) => v && setFit(v)} options={[{ value: 'crop', label: 'Crop to fill' }, { value: 'expand', label: 'Keep all (add background)' }]} />
          {fit === 'expand' && <OptionChips<typeof bg> label="Background" value={bg} onChange={(v) => v && setBg(v)} options={[{ value: '#ffffff', label: 'White' }, { value: '#000000', label: 'Black' }, { value: 'transparent', label: 'Transparent (PNG)' }]} />}
        </>
      )}
    </div>
  );
  const flipCtl = (
    <div class="space-y-3" key="f">
      <p class="text-sm font-semibold text-ink dark:text-white">Flip (mirror)</p>
      <div class="flex gap-2">
        <button type="button" aria-pressed={fh} class={btn(fh)} onClick={() => setFh(!fh)}>⇋ Horizontal</button>
        <button type="button" aria-pressed={fv} class={btn(fv)} onClick={() => setFv(!fv)}>⇅ Vertical</button>
      </div>
    </div>
  );
  return (
    <ImageBatch preview={apply} process={apply} deps={[quarter, fine, fh, fv, fit, bg]}
      controls={<>{mode === 'rotate' ? [rotateCtl, flipCtl] : [flipCtl, rotateCtl]}<p class="text-xs text-muted dark:text-gray-400">Angle: {angle % 360}°{fh ? ' · mirrored' : ''}{fv ? ' · flipped' : ''}</p></>}
      action={mode === 'rotate' ? 'Rotate' : 'Flip'} suffix={mode === 'rotate' ? 'rotated' : 'flipped'} done={mode === 'rotate' ? 'Images rotated!' : 'Images flipped!'} />
  );
}
