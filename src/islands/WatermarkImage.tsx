import { useState } from 'preact/hooks';
import ImageBatch from '../components/ui/ImageBatch';
import OptionChips from '../components/ui/OptionChips';
import { watermark, type Mark } from '../lib/imageOps';

const COLORS = ['#ffffff', '#111827', '#dc2626', '#2563eb', '#facc15'];

export default function WatermarkImage() {
  const [m, setM] = useState<Mark>({ kind: 'text', text: '© Your Name', logo: null, color: '#ffffff', size: 0.06, opacity: 0.5, angle: -30, position: 'tile', bold: true });
  const [logoName, setLogoName] = useState('');
  const set = (p: Partial<Mark>) => setM((x) => ({ ...x, ...p }));
  const pickLogo = async (f?: File) => {
    if (!f) return;
    const { decodeImage } = await import('../lib/image');
    const { scaled } = await import('../lib/imageOps');
    const d = await decodeImage(f, f.name);
    set({ logo: scaled(d, 1200), kind: 'logo', angle: 0, position: 'bottom-right', opacity: 0.8, size: 0.12 });
    d.close(); setLogoName(f.name);
  };
  const scale = (s: HTMLCanvasElement) => watermark(s, m);
  return (
    <ImageBatch preview={scale} process={(d) => watermark(d, m)} deps={[JSON.stringify({ ...m, logo: !!m.logo }), m.logo]} action="Watermark" suffix="watermarked" done="Watermark added!"
      controls={
        <div class="space-y-4">
          <OptionChips<'text' | 'logo'> label="Watermark" value={m.kind} onChange={(v) => v && set({ kind: v })} options={[{ value: 'text', label: 'Text' }, { value: 'logo', label: 'Logo image' }]} />
          {m.kind === 'text' ? (
            <>
              <input type="text" value={m.text} maxLength={80} onInput={(e) => set({ text: (e.target as HTMLInputElement).value })} aria-label="Watermark text" class="h-11 w-full rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" />
              <div class="flex flex-wrap items-center gap-1.5">
                {COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={m.color === c} onClick={() => set({ color: c })} class={`h-8 w-8 rounded-full border-[3px] ring-1 ring-black/20 ${m.color === c ? 'border-brand' : 'border-white dark:border-night-3'}`} style={{ background: c }} />)}
                <input type="color" value={m.color} onInput={(e) => set({ color: (e.target as HTMLInputElement).value })} aria-label="Custom colour" class="h-8 w-10 cursor-pointer rounded border border-line" />
              </div>
            </>
          ) : (
            <label class="btn-secondary min-h-11 w-full cursor-pointer px-3 text-sm">{logoName ? `Logo: ${logoName}` : 'Choose logo (PNG with transparency works best)'}
              <input type="file" accept="image/*" class="sr-only" onChange={(e) => pickLogo((e.target as HTMLInputElement).files?.[0])} />
            </label>
          )}
          <OptionChips<Mark['position']> label="Position" value={m.position} onChange={(v) => v && set({ position: v })} options={[{ value: 'tile', label: 'Repeat' }, { value: 'center', label: 'Centre' }, { value: 'bottom-right', label: '↘' }, { value: 'bottom-left', label: '↙' }, { value: 'top-right', label: '↗' }, { value: 'top-left', label: '↖' }, { value: 'bottom-center', label: '↓' }]} />
          <label class="flex items-center gap-2 text-sm font-semibold">Size <input type="range" min={2} max={25} value={Math.round(m.size * 100)} onInput={(e) => set({ size: +(e.target as HTMLInputElement).value / 100 })} class="h-9 min-w-0 flex-1 accent-brand" /></label>
          <label class="flex items-center gap-2 text-sm font-semibold">Opacity <input type="range" min={10} max={100} step={5} value={Math.round(m.opacity * 100)} onInput={(e) => set({ opacity: +(e.target as HTMLInputElement).value / 100 })} class="h-9 min-w-0 flex-1 accent-brand" /><span class="w-10 text-right tabular-nums">{Math.round(m.opacity * 100)}%</span></label>
          <label class="flex items-center gap-2 text-sm font-semibold">Angle <input type="range" min={-90} max={90} value={m.angle} onInput={(e) => set({ angle: +(e.target as HTMLInputElement).value })} class="h-9 min-w-0 flex-1 accent-brand" /><span class="w-10 text-right tabular-nums">{m.angle}°</span></label>
        </div>
      } />
  );
}
