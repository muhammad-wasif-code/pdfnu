import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  onReorder: (items: T[]) => void;
  render: (item: T, index: number, dragging: boolean) => ComponentChildren;
  /** accessible name for an item, used by move buttons */
  label: (item: T, index: number) => string;
  class?: string;
}

/**
 * Pointer-based drag-to-reorder grid. Mouse/pen: drag immediately. Touch: long-press (250ms)
 * to pick up, so normal scrolling still works. Each item also gets ←/→ buttons for keyboard users.
 */
export default function SortableGrid<T>({ items, getKey, onReorder, render, label, class: cls = '' }: Props<T>) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number; key: string } | null>(null);
  const state = useRef<{ key: string; startX: number; startY: number; offX: number; offY: number; timer?: number; active: boolean; pointerId: number; touch: boolean } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = items.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onReorder(next);
  };

  const begin = (key: string, el: HTMLElement, x: number, y: number) => {
    const r = el.getBoundingClientRect();
    const s = state.current!;
    s.active = true; s.offX = x - r.left; s.offY = y - r.top;
    setDragKey(key);
    setGhost({ x: r.left, y: r.top, w: r.width, h: r.height, key });
    navigator.vibrate?.(10);
  };

  const onPointerDown = (e: PointerEvent, key: string) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const touch = e.pointerType === 'touch';
    state.current = { key, startX: e.clientX, startY: e.clientY, offX: 0, offY: 0, active: false, pointerId: e.pointerId, touch };
    if (touch) state.current.timer = window.setTimeout(() => { if (state.current) { el.setPointerCapture?.(e.pointerId); begin(key, el, state.current.startX, state.current.startY); } }, 250);
    const onMove = (ev: PointerEvent) => {
      const s = state.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      if (!s.active) {
        const dist = Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY);
        if (s.touch) { if (dist > 8) cleanup(); return; } // user is scrolling
        if (dist < 5) return;
        begin(key, el, ev.clientX, ev.clientY);
      }
      ev.preventDefault();
      setGhost((g) => (g ? { ...g, x: ev.clientX - s.offX, y: ev.clientY - s.offY } : g));
      // find item under pointer
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-sort-key]');
      const overKey = under?.dataset.sortKey;
      if (overKey && overKey !== s.key) {
        const cur = itemsRef.current;
        const from = cur.findIndex((i) => getKey(i) === s.key);
        const to = cur.findIndex((i) => getKey(i) === overKey);
        if (from > -1 && to > -1) {
          const next = cur.slice();
          const [it] = next.splice(from, 1);
          next.splice(to, 0, it);
          itemsRef.current = next;
          onReorder(next);
        }
      }
      // auto-scroll near viewport edges
      if (ev.clientY < 70) window.scrollBy(0, -12); else if (ev.clientY > innerHeight - 70) window.scrollBy(0, 12);
    };
    const cleanup = () => {
      if (state.current?.timer) clearTimeout(state.current.timer);
      state.current = null;
      setDragKey(null); setGhost(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('touchmove', block);
    };
    // While dragging on touch, stop the page from scrolling
    const block = (ev: TouchEvent) => { if (state.current?.active) ev.preventDefault(); };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    window.addEventListener('touchmove', block, { passive: false });
  };

  const ghostItem = ghost ? items.find((i) => getKey(i) === ghost.key) : undefined;

  return (
    <>
      <ul ref={listRef} class={`grid select-none gap-3 ${cls}`} role="list">
        {items.map((item, i) => {
          const key = getKey(item);
          const dragging = key === dragKey;
          return (
            <li
              key={key}
              data-sort-key={key}
              class={`group relative cursor-grab touch-manipulation rounded-control transition-opacity ${dragging ? 'opacity-30' : ''}`}
              onPointerDown={(e) => onPointerDown(e as unknown as PointerEvent, key)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {render(item, i, dragging)}
              <div class="mt-1.5 flex justify-center gap-1">
                <button type="button" class="grid h-9 w-9 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/10" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move ${label(item, i)} earlier`}>
                  <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg>
                </button>
                <button type="button" class="grid h-9 w-9 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/10" disabled={i === items.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move ${label(item, i)} later`}>
                  <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {ghost && ghostItem && (
        <div class="pointer-events-none fixed z-50 rotate-2 opacity-95 shadow-2xl" style={{ left: ghost.x, top: ghost.y, width: ghost.w }} aria-hidden="true">
          {render(ghostItem, -1, false)}
        </div>
      )}
    </>
  );
}
