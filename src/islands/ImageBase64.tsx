import { useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { downloadBlob } from '../lib/download';

export default function ImageBase64() {
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [file, setFile] = useState<File | null>(null);
  const [uri, setUri] = useState('');
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState('');
  const [error, setError] = useState<string | null>(null);

  const encode = async (files: File[]) => {
    const f = files[0]; setError(null);
    if (f.size > 20 * 1024 * 1024) { setError('Choose an image under 20 MB: Base64 text for larger files is impractical.'); return; }
    const r = new FileReader();
    r.onload = () => { setUri(String(r.result)); setFile(f); };
    r.readAsDataURL(f);
  };
  const decoded = (() => {
    const t = input.trim().replace(/\s+/g, '');
    if (!t) return null;
    const m = /^data:([\w/+.-]+);base64,(.*)$/i.exec(t);
    const b64 = m ? m[2] : t;
    try {
      const bin = atob(b64);
      const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const type = m?.[1] ?? (u8[0] === 0x89 ? 'image/png' : u8[0] === 0xff ? 'image/jpeg' : u8[0] === 0x47 ? 'image/gif' : /^<svg|^<\?xml/.test(bin.slice(0, 20)) ? 'image/svg+xml' : String.fromCharCode(...u8.slice(8, 12)) === 'WEBP' ? 'image/webp' : 'application/octet-stream');
      return { blob: new Blob([u8], { type }), type, url: `data:${type};base64,${b64}` };
    } catch { return 'bad' as const; }
  })();
  const copy = (k: string, v: string) => { navigator.clipboard?.writeText(v); setCopied(k); setTimeout(() => setCopied(''), 1200); };
  const b64 = uri.split(',')[1] ?? '';
  const snippets: [string, string][] = file ? [
    ['Data URI', uri], ['Base64 only', b64], ['HTML <img>', `<img src="${uri}" alt="">`], ['CSS background', `background-image: url("${uri}");`], ['Markdown', `![image](${uri})`],
  ] : [];
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <OptionChips<'encode' | 'decode'> label="Mode" hideLabel value={mode} onChange={(v) => v && setMode(v)} options={[{ value: 'encode', label: 'Image → Base64' }, { value: 'decode', label: 'Base64 → Image' }]} />
      {error && <ErrorBox>{error}</ErrorBox>}
      {mode === 'encode' ? (
        <>
          <Dropzone compact={!!file} accept="image/*,.svg,.ico" title={file ? 'Use another image' : 'Drag & drop an image here'} buttonLabel="Select image" hint={file ? undefined : 'PNG, JPG, GIF, WebP, SVG or ICO.'} onFiles={encode} />
          {file && (
            <>
              <div class="flex items-center gap-3 text-sm"><img src={uri} alt="" class="h-14 w-14 rounded border border-line object-contain" /><span><strong>{file.name}</strong> · {formatBytes(file.size)} → {formatBytes(uri.length)} of text (+{Math.round((uri.length / file.size - 1) * 100)}%)</span></div>
              {snippets.map(([k, v]) => (
                <div key={k}>
                  <div class="mb-1 flex items-center justify-between"><span class="text-sm font-semibold">{k}</span><button type="button" class="text-sm font-semibold text-brand dark:text-brand-light" onClick={() => copy(k, v)}>{copied === k ? 'Copied!' : 'Copy'}</button></div>
                  <textarea readOnly rows={k === 'Data URI' ? 4 : 2} value={v.length > 4000 ? v.slice(0, 4000) + '… (copy to get all of it)' : v} class="block w-full rounded-control border border-line bg-surface p-2 font-mono text-xs dark:border-white/10 dark:bg-white/5" />
                </div>
              ))}
              <button type="button" class="btn-secondary min-h-11 px-4 text-sm" onClick={() => downloadBlob(new Blob([uri], { type: 'text/plain' }), `${stripExt(file.name)}-base64.txt`, 'text/plain')}>Download as .txt</button>
            </>
          )}
        </>
      ) : (
        <>
          <textarea rows={8} value={input} onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)} placeholder="Paste a data:image/…;base64,… string or plain Base64" aria-label="Base64 text"
            class="block w-full rounded-control border border-line bg-white p-3 font-mono text-xs outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" />
          {decoded === 'bad' && <ErrorBox>This isn’t valid Base64.</ErrorBox>}
          {decoded && decoded !== 'bad' && (
            <div class="space-y-3">
              <div class="grid place-items-center rounded-control border border-line p-3 dark:border-white/10" style={{ background: 'repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/16px 16px' }}><img src={decoded.url} alt="Decoded" class="max-h-72 max-w-full" /></div>
              <p class="text-sm text-muted">{decoded.type} · {formatBytes(decoded.blob.size)}</p>
              <button type="button" class="btn-primary min-h-12 w-full" onClick={() => downloadBlob(decoded.blob, `image.${(decoded.type.split('/')[1] ?? 'bin').replace('svg+xml', 'svg').replace('jpeg', 'jpg')}`, decoded.type)}>Download image</button>
            </div>
          )}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
