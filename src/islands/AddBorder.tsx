import { useState } from 'preact/hooks';
import ImageBatch from '../components/ui/ImageBatch';
import OptionChips from '../components/ui/OptionChips';
import { addBorder, type Border } from '../lib/imageOps';

const COLORS = ['#ffffff', '#111827', '#f5f0e6', '#dc2626', '#2563eb', '#16a34a', '#facc15', '#f472b6'];
export default function AddBorder() {
  const [b, setB] = useState<Border>({ width: 0.04, color: '#ffffff', radius: 0, style: 'solid' });
  const set = (p: Partial<Border>) => setB((x) => ({ ...x, ...p }));
  return (
    <ImageBatch preview={(s) => addBorder(s, b)} process={(d) => addBorder(d, b)} deps={[JSON.stringify(b)]} action="Add border to" suffix="border" done="Border added!"
      controls={
        <div class="space-y-4">
          <OptionChips<Border['style']> label="Style" value={b.style} onChange={(v) => v && set({ style: v })} options={[{ value: 'solid', label: 'Solid' }, { value: 'double', label: 'Double line' }, { value: 'polaroid', label: 'Polaroid' }, { value: 'shadow', label: 'Shadow' }]} />
          <label class="block text-sm font-semibold">Thickness<input type="range" min={0} max={20} step={0.5} value={b.width * 100} onInput={(e) => set({ width: +(e.target as HTMLInputElement).value / 100 })} class="mt-1 h-9 w-full accent-brand" /></label>
          <label class="block text-sm font-semibold">Rounded corners<input type="range" min={0} max={20} value={b.radius * 100} onInput={(e) => set({ radius: +(e.target as HTMLInputElement).value / 100 })} class="mt-1 h-9 w-full accent-brand" /></label>
          <div class="flex flex-wrap items-center gap-1.5"><span class="text-sm font-semibold">Colour</span>
            {COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={b.color === c} onClick={() => set({ color: c })} class={`h-8 w-8 rounded-full border-[3px] ring-1 ring-black/20 ${b.color === c ? 'border-brand' : 'border-white dark:border-night-3'}`} style={{ background: c }} />)}
            <input type="color" value={b.color} aria-label="Custom colour" onInput={(e) => set({ color: (e.target as HTMLInputElement).value })} class="h-8 w-10 cursor-pointer rounded border border-line" />
          </div>
          {b.radius > 0 && <p class="text-xs text-muted dark:text-gray-400">Save as PNG to keep the rounded corners transparent.</p>}
        </div>
      } />
  );
}
