import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  title: string;
  /** e.g. [["Before", "2.5 MB"], ["After", "850 KB"]] */
  stats?: [string, string][];
  highlight?: string;
  warnings?: string[];
  onDownload: () => void;
  downloadLabel?: string;
  onReset: () => void;
  resetLabel?: string;
  children?: ComponentChildren;
}

export default function ResultCard({ title, stats, highlight, warnings, onDownload, downloadLabel = 'Download', onReset, resetLabel = 'Process another file', children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Bring the result into view so nobody has to hunt for the download button
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 64 || r.bottom > innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  return (
    <div ref={ref} class="scroll-mt-24 space-y-3">
      <div class="rounded-card border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5 dark:border-emerald-400/20 dark:bg-emerald-400/[.06]" role="status">
        <p class="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-200">
          <svg viewBox="0 0 20 20" class="h-5 w-5 text-success" fill="currentColor" aria-hidden="true"><path d="M10 1.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Zm3.7 6.4-4.4 4.4a.8.8 0 0 1-1.1 0l-2-2a.8.8 0 1 1 1.1-1.1l1.4 1.4 3.9-3.8a.8.8 0 0 1 1.1 1.1Z"/></svg>
          {title}
        </p>
        {stats && stats.length > 0 && (
          <dl class="mt-3 grid grid-cols-3 gap-2">
            {stats.map(([k, v]) => (
              <div key={k} class="rounded-control bg-white/80 px-3 py-2 dark:bg-white/5">
                <dt class="text-xs text-muted dark:text-gray-400">{k}</dt>
                <dd class="mt-0.5 font-semibold tabular-nums text-ink dark:text-white">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {highlight && <p class="mt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">{highlight}</p>}
        {children}
      </div>
      {warnings?.map((w) => (
        <p key={w} class="flex gap-2 rounded-control border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
          <svg viewBox="0 0 20 20" class="mt-0.5 h-4 w-4 shrink-0" fill="currentColor" aria-hidden="true"><path d="M8.6 2.9a1.6 1.6 0 0 1 2.8 0l6.4 11.4a1.6 1.6 0 0 1-1.4 2.4H3.6a1.6 1.6 0 0 1-1.4-2.4L8.6 2.9ZM10 7a.9.9 0 0 0-.9.9v3.3a.9.9 0 0 0 1.8 0V7.9A.9.9 0 0 0 10 7Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>
          <span>{w}</span>
        </p>
      ))}
      <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={onDownload}>
        <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12"/></svg>
        {downloadLabel}
      </button>
      <button type="button" class="btn-secondary min-h-12 w-full" onClick={onReset}>{resetLabel}</button>
    </div>
  );
}
