import type { ComponentChildren } from 'preact';

/**
 * Toolbar that sticks under the site header while the user scrolls through a long page preview,
 * so controls never disappear off-screen on phones.
 */
export function StickyToolbar({ children }: { children: ComponentChildren }) {
  return (
    <div class="sticky top-16 z-20 -mx-4 space-y-2 border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 dark:border-white/10 dark:bg-night-2/95">
      {children}
    </div>
  );
}

/** Primary action pinned to the bottom of the screen while the tool is in view. */
export function StickyActions({ children }: { children: ComponentChildren }) {
  return (
    <div class="sticky bottom-0 z-20 -mx-4 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 dark:border-white/10 dark:bg-night-2/95" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
      {children}
    </div>
  );
}
