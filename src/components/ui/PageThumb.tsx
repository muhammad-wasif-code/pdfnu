import type { ComponentChildren } from 'preact';

interface Props {
  url?: string;
  aspect?: number;
  rotate?: number;
  caption?: ComponentChildren;
  sub?: ComponentChildren;
  selected?: boolean;
  dimmed?: boolean;
  badge?: ComponentChildren;
  children?: ComponentChildren;
}

/** A page/file card with a lazily-filled thumbnail. */
export default function PageThumb({ url, aspect = 1.414, rotate = 0, caption, sub, selected, dimmed, badge, children }: Props) {
  const sideways = Math.abs(rotate % 180) === 90;
  return (
    <div class={`relative rounded-control border bg-white p-2 text-center transition dark:bg-night-2 ${selected ? 'border-brand ring-2 ring-brand' : 'border-line dark:border-white/10'} ${dimmed ? 'opacity-40' : ''}`}>
      <div class="relative mx-auto grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-md bg-surface dark:bg-white/5">
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            class="max-h-full max-w-full shadow-sm transition-transform duration-200"
            style={{ transform: `rotate(${rotate}deg)`, maxWidth: sideways ? `${100 / aspect}%` : undefined, maxHeight: sideways ? `${100 * Math.min(1, aspect) / 1.333}%` : undefined }}
          />
        ) : (
          <span class="h-6 w-6 animate-spin rounded-full border-2 border-brand/30 border-t-brand" aria-hidden="true" />
        )}
        {badge && <span class="absolute left-1.5 top-1.5 rounded-md bg-ink/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">{badge}</span>}
        {children}
      </div>
      {caption && <p class="mt-1.5 truncate text-xs font-semibold text-ink dark:text-gray-100">{caption}</p>}
      {sub && <p class="truncate text-[11px] text-muted dark:text-gray-400">{sub}</p>}
    </div>
  );
}
