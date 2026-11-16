import type { ComponentChildren } from 'preact';

const ICONS: Record<string, string> = {
  rotateRight: 'M15.5 4.5v3.5H12M15.2 8A6 6 0 1 0 16 12',
  rotateLeft: 'M4.5 4.5v3.5H8M4.8 8A6 6 0 1 1 4 12',
  trash: 'M4.5 6h11M8 6V4.5h4V6m-6 0 .7 9.5h6.6L14 6',
  close: 'm5 5 10 10M15 5 5 15',
};

interface Props { icon: keyof typeof ICONS | string; label: string; onClick: () => void; class?: string; tone?: 'default' | 'danger'; children?: ComponentChildren; }

/** Small round overlay button (44px hit area on touch via padding). */
export default function IconButton({ icon, label, onClick, class: cls = '', tone = 'default' }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      title={label}
      class={`grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow ring-1 ring-black/5 dark:bg-night-3 ${tone === 'danger' ? 'text-gray-600 hover:text-danger dark:text-gray-300' : 'text-gray-700 hover:text-brand dark:text-gray-200'} ${cls}`}
    >
      <svg viewBox="0 0 20 20" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS[icon] ?? icon} /></svg>
    </button>
  );
}
