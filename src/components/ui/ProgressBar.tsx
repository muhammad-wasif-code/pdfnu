interface Props { value?: number | null; label: string; detail?: string; }

/** value: 0..1, or null/undefined for indeterminate */
export default function ProgressBar({ value, label, detail }: Props) {
  const det = typeof value === 'number';
  const pct = det ? Math.round(Math.min(1, Math.max(0, value!)) * 100) : undefined;
  return (
    <div class="rounded-card border border-line bg-white p-4 dark:border-white/10 dark:bg-white/[.03]" aria-live="polite">
      <div class="mb-2 flex items-center justify-between gap-3 text-sm">
        <span class="font-medium text-ink dark:text-white">{label}</span>
        {det && <span class="tabular-nums text-muted dark:text-gray-400">{pct}%</span>}
      </div>
      <div
        class="relative h-2.5 overflow-hidden rounded-full bg-brand-soft dark:bg-white/10"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        {det ? (
          <div class="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${pct}%` }} />
        ) : (
          <div class="pdfnu-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-brand" />
        )}
      </div>
      {detail && <p class="mt-2 text-xs text-muted dark:text-gray-400">{detail}</p>}
    </div>
  );
}
