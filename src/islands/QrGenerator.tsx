import { useEffect, useMemo, useState } from 'preact/hooks';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { downloadBlob } from '../lib/download';
import { encodeQr, qrToSvg, payload, type Ecc } from '../lib/qr';

type Kind = 'url' | 'text' | 'wifi' | 'vcard' | 'email' | 'phone' | 'sms' | 'whatsapp';
const KINDS: { v: Kind; l: string }[] = [{ v: 'url', l: 'Link' }, { v: 'text', l: 'Text' }, { v: 'wifi', l: 'Wi-Fi' }, { v: 'vcard', l: 'Contact' }, { v: 'email', l: 'E-mail' }, { v: 'phone', l: 'Phone' }, { v: 'sms', l: 'SMS' }, { v: 'whatsapp', l: 'WhatsApp' }];

export default function QrGenerator() {
  const [kind, setKind] = useState<Kind>('url');
  const [f, setF] = useState<Record<string, string>>({ url: 'https://', sec: 'WPA' });
  const [hidden, setHidden] = useState(false);
  const [ecc, setEcc] = useState<Ecc>('M');
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState('#ffffff');
  const [transparent, setTransparent] = useState(false);
  const [dots, setDots] = useState<'square' | 'round'>('square');
  const [logo, setLogo] = useState<string | null>(null);
  const [px, setPx] = useState<'512' | '1024' | '2048'>('1024');
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  const text = useMemo(() => {
    switch (kind) {
      case 'url': return (f.url ?? '').trim() === 'https://' ? '' : (f.url ?? '').trim();
      case 'text': return f.text ?? '';
      case 'wifi': return f.ssid ? payload.wifi(f.ssid, f.pass ?? '', (f.sec as any) ?? 'WPA', hidden) : '';
      case 'vcard': return f.name ? payload.vcard({ name: f.name ?? '', phone: f.phone ?? '', email: f.email ?? '', org: f.org ?? '', url: f.web ?? '', address: f.addr ?? '' }) : '';
      case 'email': return f.to ? payload.email(f.to, f.subject ?? '', f.body ?? '') : '';
      case 'phone': return f.tel ? payload.phone(f.tel) : '';
      case 'sms': return f.tel ? payload.sms(f.tel, f.body ?? '') : '';
      case 'whatsapp': return f.tel ? payload.whatsapp(f.tel, f.body ?? '') : '';
    }
  }, [kind, f, hidden]);

  let error: string | null = null;
  let svg = '';
  try {
    if (text) { const q = encodeQr(text, { ecc: logo && ecc !== 'H' ? 'Q' : ecc }); svg = qrToSvg(q, { fg, bg: transparent ? null : bg, margin: 4, dots }, logo ?? undefined); }
  } catch (e) { error = (e as Error).message === 'TOO_LONG' ? 'That is too much for one QR code (about 2,900 characters at most). Shorten the text or use a link.' : 'This QR code couldn’t be created.'; }
  const lowContrast = (() => { const l = (h: string) => { const n = parseInt(h.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000; }; return !transparent && Math.abs(l(fg) - l(bg)) < 90; })();

  const pickLogo = async (file?: File) => {
    if (!file) return;
    const { decodeImage } = await import('../lib/image');
    const { scaled } = await import('../lib/imageOps');
    const d = await decodeImage(file, file.name); const c = scaled(d, 400); d.close();
    setLogo(c.toDataURL('image/png'));
    if (ecc === 'L' || ecc === 'M') setEcc('H');
  };
  const png = async () => {
    const size = +px;
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 0, 0, size, size);
    c.toBlob((b) => b && downloadBlob(b, 'qr-code.png', 'image/png'), 'image/png');
  };
  useEffect(() => { if (kind === 'wifi' && !f.sec) set('sec', 'WPA'); }, [kind]);

  const input = (k: string, label: string, type = 'text', ph = '') => (
    <label class="block text-sm"><span class="mb-1 block font-semibold text-ink dark:text-white">{label}</span>
      <input type={type} value={f[k] ?? ''} placeholder={ph} onInput={(e) => set(k, (e.target as HTMLInputElement).value)} class="h-11 w-full rounded-control border border-line bg-white px-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" />
    </label>
  );
  const area = (k: string, label: string, ph = '') => (
    <label class="block text-sm"><span class="mb-1 block font-semibold text-ink dark:text-white">{label}</span>
      <textarea rows={3} value={f[k] ?? ''} placeholder={ph} onInput={(e) => set(k, (e.target as HTMLTextAreaElement).value)} class="w-full rounded-control border border-line bg-white p-3 text-[15px] outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" />
    </label>
  );
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="QR code type">
        {KINDS.map((k) => <button key={k.v} type="button" role="tab" aria-selected={kind === k.v} onClick={() => setKind(k.v)} class={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${kind === k.v ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-surface dark:border-white/10 dark:bg-white/[.03]'}`}>{k.l}</button>)}
      </div>
      <div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
        <div class="space-y-3">
          {kind === 'url' && input('url', 'Web address', 'url', 'https://example.com')}
          {kind === 'text' && area('text', 'Text', 'Any text, in any language')}
          {kind === 'wifi' && <>{input('ssid', 'Network name (SSID)')}{f.sec !== 'nopass' && input('pass', 'Password')}
            <OptionChips<string> label="Security" value={f.sec ?? 'WPA'} onChange={(v) => v && set('sec', v)} options={[{ value: 'WPA', label: 'WPA/WPA2/WPA3' }, { value: 'WEP', label: 'WEP' }, { value: 'nopass', label: 'None' }]} />
            <label class="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={hidden} onChange={(e) => setHidden((e.target as HTMLInputElement).checked)} />Hidden network</label></>}
          {kind === 'vcard' && <div class="grid gap-3 sm:grid-cols-2">{input('name', 'Full name')}{input('phone', 'Phone', 'tel')}{input('email', 'E-mail', 'email')}{input('org', 'Company')}{input('web', 'Website', 'url')}{input('addr', 'Address')}</div>}
          {kind === 'email' && <>{input('to', 'To', 'email')}{input('subject', 'Subject')}{area('body', 'Message')}</>}
          {(kind === 'phone' || kind === 'sms' || kind === 'whatsapp') && input('tel', kind === 'whatsapp' ? 'WhatsApp number with country code' : 'Phone number', 'tel', '+92 300 1234567')}
          {(kind === 'sms' || kind === 'whatsapp') && area('body', 'Message (optional)')}
          <details class="rounded-control border border-line p-3 dark:border-white/10">
            <summary class="cursor-pointer text-sm font-semibold">Design</summary>
            <div class="mt-3 space-y-3">
              <div class="flex flex-wrap items-center gap-3 text-sm">
                <label class="flex items-center gap-2">Colour <input type="color" value={fg} onInput={(e) => setFg((e.target as HTMLInputElement).value)} class="h-9 w-12 cursor-pointer rounded border border-line" /></label>
                <label class="flex items-center gap-2">Background <input type="color" value={bg} disabled={transparent} onInput={(e) => setBg((e.target as HTMLInputElement).value)} class="h-9 w-12 cursor-pointer rounded border border-line" /></label>
                <label class="flex items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={transparent} onChange={(e) => setTransparent((e.target as HTMLInputElement).checked)} />Transparent</label>
              </div>
              <OptionChips<'square' | 'round'> label="Dots" value={dots} onChange={(v) => v && setDots(v)} options={[{ value: 'square', label: 'Square' }, { value: 'round', label: 'Round' }]} />
              <OptionChips<Ecc> label="Error correction" value={ecc} onChange={(v) => v && setEcc(v)} options={[{ value: 'L', label: 'Low 7%' }, { value: 'M', label: 'Medium 15%' }, { value: 'Q', label: 'High 25%' }, { value: 'H', label: 'Max 30%' }]} />
              <div class="flex items-center gap-2 text-sm">
                <label class="btn-secondary min-h-10 cursor-pointer px-3 text-sm">{logo ? 'Change logo' : 'Add logo in the middle'}<input type="file" accept="image/*" class="sr-only" onChange={(e) => pickLogo((e.target as HTMLInputElement).files?.[0])} /></label>
                {logo && <button type="button" class="text-sm font-semibold text-danger" onClick={() => setLogo(null)}>Remove logo</button>}
              </div>
            </div>
          </details>
        </div>
        <div class="space-y-3">
          <div class="grid aspect-square place-items-center rounded-control border border-line p-3 dark:border-white/10" style={{ background: 'repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/16px 16px' }}>
            {svg ? <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} alt="QR code preview" class="h-full w-full" style={{ imageRendering: 'pixelated' }} /> : <p class="text-center text-sm text-muted">Fill in the details to see your QR code</p>}
          </div>
          {error && <ErrorBox>{error}</ErrorBox>}
          {lowContrast && svg && <p class="text-xs text-amber-800 dark:text-amber-200">Low contrast: some phones may not read this code. Use a dark colour on a light background.</p>}
          <OptionChips<'512' | '1024' | '2048'> label="PNG size" value={px} onChange={(v) => v && setPx(v)} options={[{ value: '512', label: '512' }, { value: '1024', label: '1024' }, { value: '2048', label: '2048' }]} />
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn-primary min-h-12" disabled={!svg} onClick={png}>Download PNG</button>
            <button type="button" class="btn-secondary min-h-12" disabled={!svg} onClick={() => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'qr-code.svg', 'image/svg+xml')}>SVG (print)</button>
          </div>
          <p class="text-xs text-muted dark:text-gray-400">Static code: it never expires and has no tracking. Test it with your phone before printing.</p>
        </div>
      </div>
      <PrivacyNote />
    </div>
  );
}
