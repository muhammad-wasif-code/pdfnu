export interface ChipOption<T extends string> { value: T; label: string; sub?: string; }

interface Props<T extends string> {
  label: string;
  options: ChipOption<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
  /** Allow clicking the active chip to clear it */
  clearable?: boolean;
  variant?: 'cards' | 'pills';
  hideLabel?: boolean;
}

export default function OptionChips<T extends string>({ label, options, value, onChange, clearable, variant = 'pills', hideLabel }: Props<T>) {
  const cards = variant === 'cards';
  return (
    <fieldset>
      <legend class={hideLabel ? 'sr-only' : 'mb-2 text-sm font-semibold text-ink dark:text-white'}>{label}</legend>
      <div class={cards ? 'grid grid-cols-3 gap-2 sm:gap-3' : 'flex flex-wrap gap-2 sm:gap-2.5'} role="radiogroup">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={active}
              key={o.value}
              onClick={() => onChange(active && clearable ? null : o.value)}
              class={`border text-center transition-colors ${
                cards ? 'min-h-14 rounded-control px-2 py-2.5' : 'min-h-11 min-w-[4.5rem] flex-1 rounded-control px-3 text-sm font-semibold sm:flex-none sm:px-5'
              } ${
                active
                  ? 'border-brand bg-brand-soft text-brand ring-1 ring-brand dark:bg-brand/15 dark:text-brand-light'
                  : 'border-line bg-surface text-gray-800 hover:border-indigo-300 dark:border-white/10 dark:bg-white/[.03] dark:text-gray-200 dark:hover:border-brand-light/40'
              }`}
            >
              {cards ? (
                <>
                  <span class="block text-[13px] font-semibold sm:text-sm">{o.label}</span>
                  {o.sub && <span class={`mt-0.5 block text-[11px] sm:text-xs ${active ? 'text-brand-dark dark:text-brand-light' : 'text-muted dark:text-gray-400'}`}>{o.sub}</span>}
                </>
              ) : o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
