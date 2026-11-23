import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { FieldInfo } from '../lib/pdfOps';
import { StickyActions } from '../components/ui/Sticky';

type Value = string | boolean | string[];

/** "applicant.firstName_1" → "Applicant first name 1" */
function prettify(name: string) {
  const last = name.split('.').filter(Boolean).slice(-2).join(' ');
  const s = last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : name;
}

export default function FillPdfForm() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [hasXfa, setHasXfa] = useState(false);
  const [flatten, setFlatten] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'loading' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (files: File[]) => {
    setError(null); setPhase('loading');
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const { pdfOp } = await import('../lib/pdfWorker');
      const pdf = await readPdf(files[0]);
      const res = await pdfOp('formFields', [pdf.bytes.slice().buffer]);
      setFile(files[0]); setBytes(pdf.bytes); setFields(res.fields); setHasXfa(res.hasXfa);
      setValues(Object.fromEntries(res.fields.map((f) => [f.name, f.value])));
      setPhase('edit');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };

  const set = (name: string, v: Value) => setValues((c) => ({ ...c, [name]: v }));

  const save = async () => {
    if (!bytes) return;
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      const editable = Object.fromEntries(fields.filter((f) => !f.readOnly && ['text', 'checkbox', 'radio', 'dropdown', 'list'].includes(f.kind)).map((f) => [f.name, values[f.name]]));
      const res = await pdfOp('fillForm', [bytes.slice().buffer, editable, flatten]);
      if (res.bad.length) {
        const labels = res.bad.map((n) => prettify(n)).join(', ');
        setError(`These fields couldn’t be filled: ${labels}. Try shorter text, or add it with Edit PDF.`);
        setPhase('edit');
        return;
      }
      setOut(res.bytes); setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };

  const reset = () => { setFile(null); setBytes(null); setFields([]); setValues({}); setOut(null); setPhase('edit'); };
  const fillable = fields.filter((f) => ['text', 'checkbox', 'radio', 'dropdown', 'list'].includes(f.kind));
  const filled = fillable.filter((f) => { const v = values[f.name]; return Array.isArray(v) ? v.length > 0 : !!v; }).length;

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Your form is filled!" stats={[['Fields', String(fillable.length)], ['Filled', String(filled)], ['Locked', flatten ? 'Yes' : 'No']]}
          highlight={flatten ? 'Answers are locked into the page and can’t be changed.' : 'Fields stay editable, so you can open the PDF here again to change answers.'}
          onDownload={() => downloadBlob(out, file.name)} downloadLabel={`Download ${file.name.length > 30 ? 'filled form' : file.name}`} onReset={reset} resetLabel="Fill another form">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change answers</button>
        </ResultCard>
      </div>
    );
  }

  const inputCls = 'h-12 w-full rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:opacity-60 dark:border-white/10 dark:bg-night-2';
  const pages = [...new Set(fields.map((f) => f.page ?? -1))].sort((a, b) => a - b);

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF form here" buttonLabel="Select PDF" hint="Works with fillable (interactive) PDF forms" onFiles={open} />
        : <FileRow name={file.name} size={`${fillable.length} fillable fields · ${formatBytes(file.size)}`} onRemove={phase === 'working' ? undefined : reset} />}
      {phase === 'loading' && <ProgressBar label="Reading form fields…" value={null} />}
      {error && <ErrorBox onRetry={!file ? () => setError(null) : undefined}>{error}</ErrorBox>}

      {file && phase !== 'loading' && fillable.length === 0 && (
        <p class="rounded-control bg-surface px-4 py-3 text-sm text-gray-700 dark:bg-white/5 dark:text-gray-300">
          {hasXfa
            ? 'This PDF uses an older XFA form format that browsers can’t fill. Open it in Adobe Acrobat Reader, or print it and fill it by hand.'
            : <>This PDF has no fillable fields. You can still type on it with <a class="font-semibold text-brand underline dark:text-brand-light" href="/edit-pdf">Edit PDF</a>, which places text anywhere on the page.</>}
        </p>
      )}

      {fillable.length > 0 && (
        <form class="space-y-6" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {pages.map((pg) => (
            <fieldset key={pg} class="space-y-4">
              {pages.length > 1 && <legend class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted dark:text-gray-400">{pg >= 0 ? `Page ${pg + 1}` : 'Other fields'}</legend>}
              {fields.filter((f) => (f.page ?? -1) === pg).map((f) => {
                const label = prettify(f.name);
                const id = `fld-${f.name}`;
                const v = values[f.name];
                if (f.kind === 'text') return (
                  <label key={f.name} class="block" for={id}>
                    <span class="mb-1 block text-sm font-semibold text-ink dark:text-white">{label}{f.readOnly && <span class="ml-1 font-normal text-muted"> (locked)</span>}</span>
                    {f.multiline
                      ? <textarea id={id} rows={3} disabled={f.readOnly} maxLength={f.maxLength} value={String(v ?? '')} onInput={(e) => set(f.name, (e.target as HTMLTextAreaElement).value)} class={`${inputCls} h-auto py-2`} />
                      : <input id={id} type="text" disabled={f.readOnly} maxLength={f.maxLength} value={String(v ?? '')} onInput={(e) => set(f.name, (e.target as HTMLInputElement).value)} class={inputCls} />}
                  </label>
                );
                if (f.kind === 'checkbox') return (
                  <label key={f.name} class="flex min-h-11 items-center gap-3 text-[15px]">
                    <input type="checkbox" class="h-5 w-5 accent-brand" disabled={f.readOnly} checked={!!v} onChange={(e) => set(f.name, (e.target as HTMLInputElement).checked)} /> {label}
                  </label>
                );
                if (f.kind === 'radio') return (
                  <div key={f.name} role="radiogroup" aria-label={label}>
                    <p class="mb-1 text-sm font-semibold text-ink dark:text-white">{label}</p>
                    <div class="flex flex-wrap gap-2">
                      {f.options!.map((o) => (
                        <label key={o} class={`flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm ${v === o ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line dark:border-white/10'}`}>
                          <input type="radio" name={id} class="accent-brand" disabled={f.readOnly} checked={v === o} onChange={() => set(f.name, o)} /> {o}
                        </label>
                      ))}
                    </div>
                  </div>
                );
                if (f.kind === 'dropdown') return (
                  <label key={f.name} class="block" for={id}>
                    <span class="mb-1 block text-sm font-semibold text-ink dark:text-white">{label}</span>
                    <select id={id} disabled={f.readOnly} value={String(v ?? '')} onChange={(e) => set(f.name, (e.target as HTMLSelectElement).value)} class={inputCls}>
                      <option value="">Choose…</option>
                      {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                );
                if (f.kind === 'list') return (
                  <label key={f.name} class="block" for={id}>
                    <span class="mb-1 block text-sm font-semibold text-ink dark:text-white">{label}</span>
                    <select id={id} multiple disabled={f.readOnly} class={`${inputCls} h-auto py-2`} onChange={(e) => set(f.name, [...(e.target as HTMLSelectElement).selectedOptions].map((o) => o.value))}>
                      {f.options!.map((o) => <option key={o} value={o} selected={Array.isArray(v) && v.includes(o)}>{o}</option>)}
                    </select>
                  </label>
                );
                if (f.kind === 'signature') return (
                  <p key={f.name} class="text-sm text-muted dark:text-gray-400">✍️ <strong>{label}</strong> is a signature field. After filling, sign with <a class="font-semibold text-brand underline dark:text-brand-light" href="/sign-pdf">Sign PDF</a>.</p>
                );
                return null;
              })}
            </fieldset>
          ))}
          <label class="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" class="h-5 w-5 accent-brand" checked={flatten} onChange={(e) => setFlatten((e.target as HTMLInputElement).checked)} />
            Lock answers (flatten), so they can’t be edited after sending
          </label>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Filling your form…" value={null} /> : (
              <button type="submit" class="btn-primary min-h-12 w-full text-[15px]">Save filled PDF ({filled}/{fillable.length})</button>
            )}
          </StickyActions>
        </form>
      )}
      <PrivacyNote />
    </div>
  );
}
