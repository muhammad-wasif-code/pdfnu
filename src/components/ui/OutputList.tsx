import { downloadBlob } from '../../lib/download';
import { formatBytes } from '../../lib/format';

export interface OutFile { name: string; data: Uint8Array; note?: string; warn?: boolean; }

/** List of generated files with a Save button each (used when a tool produces several PDFs). */
export default function OutputList({ files }: { files: OutFile[] }) {
  if (files.length < 2) return null;
  return (
    <ul class="mt-3 max-h-56 space-y-1 overflow-auto text-sm">
      {files.map((o) => (
        <li key={o.name} class="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-1.5 dark:bg-white/5">
          <span class="min-w-0"><span class="block truncate">{o.name}</span><span class={`block text-xs ${o.warn ? 'text-amber-700 dark:text-amber-300' : 'text-muted dark:text-gray-400'}`}>{o.note ? `${o.note} · ` : ''}{formatBytes(o.data.length)}</span></span>
          <button type="button" class="min-h-9 shrink-0 font-semibold text-brand dark:text-brand-light" onClick={() => downloadBlob(o.data, o.name)}>Save</button>
        </li>
      ))}
    </ul>
  );
}

/** Download one file directly, or several as a .zip. */
export async function downloadAll(files: OutFile[], zipName: string) {
  if (files.length === 1) return downloadBlob(files[0].data, files[0].name);
  const { makeZip } = await import('../../lib/zip');
  downloadBlob(await makeZip(files), zipName, 'application/zip');
}

/** File-name-safe version of a title. */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'part';
