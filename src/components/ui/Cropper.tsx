import { useEffect, useRef, useState } from 'preact/hooks';
import type { Rect } from '../../lib/image';

interface Props {
  src: string;
  naturalW: number;
  naturalH: number;
  /** width / height, or null for free */
  aspect: number | null;
  value: Rect;
  onChange: (r: Rect) => void;
  /** optional overlay inside the crop box (e.g. face guide) */
  guide?: 'thirds' | 'face';
}

type Mode = 'move' | 'nw' | 'ne' | 'sw' | 'se';
const MIN = 16;

/** Largest rect with the given aspect, centred in the image. */
export function fitRect(nw: number, nh: number, aspect: number | null, fill = 0.9): Rect {
  if (!aspect) return { x: nw * (1 - fill) / 2, y: nh * (1 - fill) / 2, w: nw * fill, h: nh * fill };
  let w = nw * fill, h = w / aspect;
  if (h > nh * fill) { h = nh * fill; w = h * aspect; }
  return { x: (nw - w) / 2, y: (nh - h) / 2, w, h };
}

/** Touch-friendly crop box: drag inside to move, drag a corner to resize. */
export default function Cropper({ src, naturalW, naturalH, aspect, value, onChange, guide = 'thirds' }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; sx: number; sy: number; start: Rect; scale: number } | null>(null);
  const [active, setActive] = useState(false);

  // keep rect valid when aspect changes
  useEffect(() => {
    if (!aspect) return;
    if (Math.abs(value.w / value.h - aspect) > 0.01) onChange(fitRect(naturalW, naturalH, aspect));
  }, [aspect, naturalW, naturalH]);

  const clamp = (r: Rect): Rect => {
    let { x, y, w, h } = r;
    w = Math.min(Math.max(MIN, w), naturalW); h = Math.min(Math.max(MIN, h), naturalH);
    if (aspect) { if (w / h > aspect) w = h * aspect; else h = w / aspect; }
    x = Math.min(Math.max(0, x), naturalW - w); y = Math.min(Math.max(0, y), naturalH - h);
    return { x, y, w, h };
  };

  const down = (e: PointerEvent, mode: Mode) => {
    e.preventDefault(); e.stopPropagation();
    const rect = box.current!.getBoundingClientRect();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: value, scale: naturalW / rect.width };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setActive(true);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) * d.scale, dy = (e.clientY - d.sy) * d.scale;
    const s = d.start;
    if (d.mode === 'move') { onChange(clamp({ ...s, x: s.x + dx, y: s.y + dy })); return; }
    // resize from the dragged corner, keeping the opposite corner fixed
    const right = s.x + s.w, bottom = s.y + s.h;
    let x1 = d.mode.includes('w') ? s.x + dx : s.x;
    let x2 = d.mode.includes('e') ? right + dx : right;
    let y1 = d.mode.includes('n') ? s.y + dy : s.y;
    let y2 = d.mode.includes('s') ? bottom + dy : bottom;
    x1 = Math.max(0, Math.min(x1, x2 - MIN)); x2 = Math.min(naturalW, Math.max(x2, x1 + MIN));
    y1 = Math.max(0, Math.min(y1, y2 - MIN)); y2 = Math.min(naturalH, Math.max(y2, y1 + MIN));
    let w = x2 - x1, h = y2 - y1;
    if (aspect) {
      if (w / h > aspect) w = h * aspect; else h = w / aspect;
      if (d.mode.includes('w')) x1 = x2 - w;
      if (d.mode.includes('n')) y1 = y2 - h;
    }
    onChange(clamp({ x: x1, y: y1, w, h }));
  };
  const up = () => { drag.current = null; setActive(false); };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const handle = (m: Mode, pos: string) => (
    <span
      onPointerDown={(e) => down(e as unknown as PointerEvent, m)}
      class={`absolute ${pos} z-10 grid h-11 w-11 place-items-center`}
      style={{ touchAction: 'none', cursor: m === 'nw' || m === 'se' ? 'nwse-resize' : 'nesw-resize' }}
      aria-hidden="true"
    >
      <span class="h-4 w-4 rounded-full border-2 border-white bg-brand shadow" />
    </span>
  );

  return (
    <div
      ref={box}
      class="relative mx-auto w-full select-none overflow-hidden rounded-md bg-[repeating-conic-gradient(#e5e7eb_0_25%,#fff_0_50%)] bg-[length:16px_16px]"
      style={{ aspectRatio: `${naturalW} / ${naturalH}`, maxHeight: '60vh', maxWidth: `calc(60vh * ${naturalW / naturalH})`, touchAction: active ? 'none' : 'pan-y' }}
      onPointerMove={(e) => move(e as unknown as PointerEvent)}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <img src={src} alt="" draggable={false} class="pointer-events-none absolute inset-0 h-full w-full" />
      <div
        class="absolute cursor-move outline outline-2 outline-white"
        style={{ left: pct(value.x, naturalW), top: pct(value.y, naturalH), width: pct(value.w, naturalW), height: pct(value.h, naturalH), boxShadow: '0 0 0 9999px rgba(17,24,39,.55)', touchAction: 'none' }}
        onPointerDown={(e) => down(e as unknown as PointerEvent, 'move')}
        role="group"
        aria-label="Crop area"
      >
        {guide === 'thirds' && (
          <div class="pointer-events-none absolute inset-0" aria-hidden="true">
            <div class="absolute inset-y-0 left-1/3 w-px bg-white/50" /><div class="absolute inset-y-0 left-2/3 w-px bg-white/50" />
            <div class="absolute inset-x-0 top-1/3 h-px bg-white/50" /><div class="absolute inset-x-0 top-2/3 h-px bg-white/50" />
          </div>
        )}
        {guide === 'face' && (
          <div class="pointer-events-none absolute inset-0" aria-hidden="true">
            <div class="absolute left-1/2 top-[12%] h-[62%] w-[52%] -translate-x-1/2 rounded-[50%] border-2 border-dashed border-white/80" />
            <div class="absolute inset-x-0 top-1/2 h-px bg-white/40" />
          </div>
        )}
        {handle('nw', '-left-[22px] -top-[22px]')}
        {handle('ne', '-right-[22px] -top-[22px]')}
        {handle('sw', '-left-[22px] -bottom-[22px]')}
        {handle('se', '-right-[22px] -bottom-[22px]')}
      </div>
    </div>
  );
}
