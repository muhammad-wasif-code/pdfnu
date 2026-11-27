import { useState } from 'preact/hooks';
import ImageBatch from '../components/ui/ImageBatch';
import { adjust, autoAdjust, NO_ADJUST, type Adjust, type FilterName } from '../lib/imageOps';

const FILTERS: { id: FilterName; label: string }[] = [
  { id: 'none', label: 'Original' }, { id: 'vivid', label: 'Vivid' }, { id: 'warm', label: 'Warm' }, { id: 'cool', label: 'Cool' }, { id: 'mono', label: 'B&W' },
  { id: 'noir', label: 'Noir' }, { id: 'sepia', label: 'Sepia' }, { id: 'vintage', label: 'Vintage' }, { id: 'fade', label: 'Fade' }, { id: 'dramatic', label: 'Dramatic' },
];
const SLIDERS: { k: keyof Adjust; label: string; min: number }[] = [
  { k: 'exposure', label: 'Exposure', min: -100 }, { k: 'brightness', label: 'Brightness', min: -100 }, { k: 'contrast', label: 'Contrast', min: -100 },
  { k: 'highlights', label: 'Highlights', min: -100 }, { k: 'shadows', label: 'Shadows', min: -100 }, { k: 'saturation', label: 'Saturation', min: -100 },
  { k: 'warmth', label: 'Warmth', min: -100 }, { k: 'sharpen', label: 'Sharpen', min: 0 }, { k: 'vignette', label: 'Vignette', min: 0 },
];

export default function PhotoEditor() {
  const [a, setA] = useState<Adjust>(NO_ADJUST);
  const [first, setFirst] = useState<HTMLCanvasElement | null>(null);
  const set = (k: keyof Adjust, v: number | string) => setA((x) => ({ ...x, [k]: v }));
  const changed = JSON.stringify(a) !== JSON.stringify(NO_ADJUST);
  return (
    <ImageBatch onFirst={setFirst} preview={(s) => adjust(s, a)} process={(d) => adjust(d, a)} deps={[JSON.stringify(a)]} action="Save" suffix="edited" done="Photos edited!"
      controls={
        <div class="space-y-4">
          <div class="flex gap-2">
            <button type="button" class="btn-secondary min-h-11 flex-1 px-3 text-sm" disabled={!first} onClick={() => first && setA({ ...autoAdjust(first), filter: a.filter })}>✨ Auto enhance</button>
            <button type="button" class="btn-secondary min-h-11 px-3 text-sm" disabled={!changed} onClick={() => setA(NO_ADJUST)}>Reset</button>
          </div>
          <fieldset>
            <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Filter</legend>
            <div class="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => <button key={f.id} type="button" aria-pressed={a.filter === f.id} onClick={() => set('filter', f.id)} class={`min-h-9 rounded-lg border px-2.5 text-xs font-semibold ${a.filter === f.id ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-surface dark:border-white/10 dark:bg-white/[.03]'}`}>{f.label}</button>)}
            </div>
          </fieldset>
          <div class="space-y-1">
            {SLIDERS.map((s) => (
              <label key={s.k} class="flex items-center gap-2 text-sm">
                <span class="w-24 shrink-0 font-semibold">{s.label}</span>
                <input type="range" min={s.min} max={100} value={a[s.k] as number} onInput={(e) => set(s.k, +(e.target as HTMLInputElement).value)} onDblClick={() => set(s.k, 0)} class="h-8 min-w-0 flex-1 accent-brand" />
                <span class="w-9 text-right text-xs tabular-nums">{a[s.k] as number}</span>
              </label>
            ))}
          </div>
        </div>
      } />
  );
}
