import type { ComponentChildren } from 'preact';

export function PrivacyNote() {
  return (
    <p class="flex items-center justify-center gap-2 rounded-control bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200">
      <svg viewBox="0 0 20 20" class="h-5 w-5 shrink-0 text-success" fill="currentColor" aria-hidden="true"><path d="M10 1.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Zm3.7 6.4-4.4 4.4a.8.8 0 0 1-1.1 0l-2-2a.8.8 0 1 1 1.1-1.1l1.4 1.4 3.9-3.8a.8.8 0 0 1 1.1 1.1Z"/></svg>
      Your files never leave your device
    </p>
  );
}

export function ErrorBox({ children, onRetry }: { children: ComponentChildren; onRetry?: () => void }) {
  return (
    <div role="alert" class="rounded-control border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">
      <p class="flex gap-2">
        <svg viewBox="0 0 20 20" class="mt-0.5 h-4 w-4 shrink-0" fill="currentColor" aria-hidden="true"><path d="M10 1.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4ZM10 5.5a.9.9 0 0 1 .9.9v4a.9.9 0 0 1-1.8 0v-4a.9.9 0 0 1 .9-.9Zm0 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>
        <span>{children}</span>
      </p>
      {onRetry && <button type="button" class="mt-2 min-h-11 font-semibold underline" onClick={onRetry}>Try another file</button>}
    </div>
  );
}

export function FileRow({ name, size, onRemove, kind = 'PDF' }: { name: string; size: string; onRemove?: () => void; kind?: string }) {
  return (
    <div class="flex items-center gap-3 rounded-control border border-line bg-white p-3 dark:border-white/10 dark:bg-white/[.03]">
      <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-rose-50 text-[11px] font-bold text-rose-600 dark:bg-rose-400/10 dark:text-rose-300">{kind}</span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-ink dark:text-white" title={name}>{name}</p>
        <p class="text-xs text-muted dark:text-gray-400">{size}</p>
      </div>
      {onRemove && (
        <button type="button" onClick={onRemove} class="grid h-11 w-11 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" aria-label={`Remove ${name}`}>
          <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>
        </button>
      )}
    </div>
  );
}
