import { useRef, useState } from 'preact/hooks';

interface Props {
  accept: string;
  multiple?: boolean;
  title: string;
  buttonLabel: string;
  hint?: string;
  onFiles: (files: File[]) => void;
  compact?: boolean;
}

export default function Dropzone({ accept, multiple, title, buttonLabel, hint, onFiles, compact }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const take = (list: FileList | null | undefined) => {
    const files = list ? Array.from(list) : [];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      class={`relative rounded-card border-2 border-dashed text-center transition-colors ${
        over ? 'border-brand bg-brand-soft dark:bg-brand/10' : 'border-indigo-300/80 bg-white dark:border-brand-light/30 dark:bg-white/[.02]'
      } ${compact ? 'px-4 py-5' : 'px-4 py-9 sm:py-12'}`}
      onDragEnter={(e) => { e.preventDefault(); depth.current++; setOver(true); }}
      onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={() => { if (--depth.current <= 0) { depth.current = 0; setOver(false); } }}
      onDrop={(e) => { e.preventDefault(); depth.current = 0; setOver(false); take(e.dataTransfer?.files); }}
    >
      {!compact && (
        <svg viewBox="0 0 48 48" class="mx-auto h-12 w-12 text-brand dark:text-brand-light" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 34h-2.5A8.5 8.5 0 0 1 10 17.2 12 12 0 0 1 33.3 14 9 9 0 0 1 37 34h-3" />
          <path d="M24 40V23m0 0-6 6m6-6 6 6" />
        </svg>
      )}
      <p class={`${compact ? '' : 'mt-3'} text-[15px] font-semibold text-ink dark:text-white`}>{title}</p>
      <p class="mt-1 text-sm text-muted dark:text-gray-400">or</p>
      <button
        type="button"
        class="btn-primary mt-3 min-h-12 px-8 text-[15px]"
        onClick={() => input.current?.click()}
      >
        {buttonLabel}
      </button>
      {hint && <p class="mt-3 text-xs text-muted dark:text-gray-400">{hint}</p>}
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        class="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => { take((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }}
      />
    </div>
  );
}
