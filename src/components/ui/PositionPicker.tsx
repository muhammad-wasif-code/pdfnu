import type { Position } from '../../lib/pdfOps';

const GRID: (Position | null)[] = ['top-left', 'top-center', 'top-right', null, 'center', null, 'bottom-left', 'bottom-center', 'bottom-right'];
const NAMES: Record<string, string> = {
  'top-left': 'Top left', 'top-center': 'Top center', 'top-right': 'Top right', center: 'Center',
  'bottom-left': 'Bottom left', 'bottom-center': 'Bottom center', 'bottom-right': 'Bottom right',
};

interface Props { value: Position; onChange: (p: Position) => void; allowCenter?: boolean; label?: string; }

export default function PositionPicker({ value, onChange, allowCenter = true, label = 'Position' }: Props) {
  return (
    <fieldset>
      <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">{label}</legend>
      <div class="grid w-36 grid-cols-3 gap-1.5 rounded-control border border-line bg-surface p-1.5 dark:border-white/10 dark:bg-white/[.03]" role="radiogroup">
        {GRID.map((p, i) => {
          const usable = p && (p !== 'center' || allowCenter);
          if (!usable) return <span key={i} class="h-11" />;
          const active = value === p;
          return (
            <button key={p} type="button" role="radio" aria-checked={active} aria-label={NAMES[p!]} title={NAMES[p!]} onClick={() => onChange(p!)}
              class={`grid h-11 place-items-center rounded-lg transition-colors ${active ? 'bg-brand text-white' : 'bg-white text-gray-400 hover:text-brand dark:bg-night-2'}`}>
              <span class={`h-2.5 w-2.5 rounded-full ${active ? 'bg-white' : 'bg-current'}`} />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** CSS placement for previews */
export function previewStyle(p: Position, angle = 0): Record<string, string> {
  const [v, h] = p === 'center' ? ['center', 'center'] : p.split('-');
  return {
    position: 'absolute',
    top: v === 'top' ? '6%' : v === 'center' ? '50%' : 'auto',
    bottom: v === 'bottom' ? '6%' : 'auto',
    left: h === 'left' ? '6%' : h === 'center' ? '50%' : 'auto',
    right: h === 'right' ? '6%' : 'auto',
    transform: `${h === 'center' ? 'translateX(-50%) ' : ''}${v === 'center' ? 'translateY(-50%) ' : ''}rotate(${-angle}deg)`,
  };
}
