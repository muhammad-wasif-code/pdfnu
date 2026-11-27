import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';

interface Hit { text: string; from: string; }

/** What the decoded text is, with a safe action. Links are never opened automatically. */
function describe(t: string): { type: string; action?: { label: string; href: string } ; details?: [string, string][] } {
  if (/^https?:\/\//i.test(t)) return { type: 'Web link', action: { label: 'Open link', href: t } };
  if (/^WIFI:/i.test(t)) {
    const g = (k: string) => (new RegExp(`[;:]${k}:((?:\\\\.|[^;])*)`).exec(t)?.[1] ?? '').replace(/\\(.)/g, '$1');
    return { type: 'Wi-Fi network', details: [['Network', g('S')], ['Password', g('P') || '(none)'], ['Security', g('T') || 'none']] };
  }
  if (/^BEGIN:VCARD/i.test(t)) { const g = (k: string) => new RegExp(`^${k}[^:]*:(.*)$`, 'mi').exec(t)?.[1] ?? ''; return { type: 'Contact card', details: [['Name', g('FN')], ['Phone', g('TEL')], ['E-mail', g('EMAIL')], ['Company', g('ORG')]].filter(([, v]) => v) as [string, string][] }; }
  if (/^mailto:/i.test(t)) return { type: 'E-mail', action: { label: 'Write e-mail', href: t } };
  if (/^tel:/i.test(t)) return { type: 'Phone number', action: { label: 'Call', href: t } };
  if (/^SMSTO:/i.test(t)) { const [, num, body] = t.split(':'); return { type: 'Text message', details: [['To', num], ['Message', body ?? '']] }; }
  if (/^geo:/i.test(t)) return { type: 'Location', action: { label: 'Open map', href: `https://www.openstreetmap.org/?mlat=${t.slice(4).split(',')[0]}&mlon=${t.slice(4).split(',')[1]}` } };
  return { type: 'Text' };
}

async function decodeCanvas(c: HTMLCanvasElement): Promise<string | null> {
  // the browser's own detector is fastest where it exists; our decoder works everywhere
  const BD = (globalThis as any).BarcodeDetector;
  if (BD) { try { const d = new BD({ formats: ['qr_code'] }); const r = await d.detect(c); if (r[0]?.rawValue) return r[0].rawValue; } catch { /* fall back */ } }
  const { decodeQr } = await import('../lib/qrDecode');
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return decodeQr(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}

export default function QrScanner() {
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const running = useRef(false);

  const addHit = (h: Hit) => setHits((c) => (c.some((x) => x.text === h.text) ? c : [h, ...c]));

  const fromFiles = async (files: File[]) => {
    setError(null); setBusy(true);
    const { decodeImage } = await import('../lib/image');
    let found = 0;
    for (const f of files) {
      try {
        const d = await decodeImage(f, f.name);
        // try full size (capped) and a smaller copy: small codes and huge photos both decode
        let text: string | null = null;
        for (const max of [1600, 800, 2400]) {
          const k = Math.min(1, max / Math.max(d.width, d.height));
          const c = document.createElement('canvas'); c.width = Math.round(d.width * k); c.height = Math.round(d.height * k);
          c.getContext('2d')!.drawImage(d.source, 0, 0, c.width, c.height);
          text = await decodeCanvas(c);
          c.width = c.height = 0;
          if (text !== null) break;
        }
        d.close();
        if (text !== null) { addHit({ text, from: f.name }); found++; }
      } catch { /* unreadable image */ }
    }
    setBusy(false);
    if (!found) setError('No QR code was found. Make sure the whole code is in the picture, sharp and not too small.');
  };

  const stop = () => { running.current = false; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setCamera(false); };
  useEffect(() => stop, []);
  const start = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
      stream.current = s; setCamera(true);
      await new Promise((r) => setTimeout(r, 50));
      const v = video.current!; v.srcObject = s; await v.play();
      running.current = true;
      const c = document.createElement('canvas');
      const loop = async () => {
        if (!running.current) return;
        if (v.videoWidth) {
          const k = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight));
          c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
          c.getContext('2d', { willReadFrequently: true })!.drawImage(v, 0, 0, c.width, c.height);
          const t = await decodeCanvas(c);
          if (t !== null) { addHit({ text: t, from: 'Camera' }); navigator.vibrate?.(60); stop(); return; }
        }
        setTimeout(loop, 180);
      };
      loop();
    } catch (e) {
      setCamera(false);
      setError((e as Error)?.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera in your browser settings, or upload a photo of the code instead.' : 'No camera is available. Upload a photo or screenshot of the code instead.');
    }
  };

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <div class="grid gap-3 sm:grid-cols-2">
        <button type="button" class="btn-primary min-h-14 text-[15px]" onClick={camera ? stop : start}>{camera ? '■ Stop camera' : '📷 Scan with camera'}</button>
        <div class="sm:hidden" />
      </div>
      {camera && (
        <div class="relative mx-auto w-full max-w-md overflow-hidden rounded-card bg-black">
          <video ref={video} playsInline muted class="block w-full" />
          <span class="pointer-events-none absolute inset-[18%] rounded-xl border-4 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,.35)]" />
        </div>
      )}
      <Dropzone accept="image/*" multiple compact={hits.length > 0} title="Or drop a photo or screenshot of a QR code" buttonLabel="Select images" onFiles={fromFiles} />
      {busy && <p class="text-sm text-muted">Reading…</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
      {hits.map((h, i) => {
        const d = describe(h.text);
        return (
          <div key={h.text} class="space-y-2 rounded-card border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-400/20 dark:bg-emerald-400/[.06]" role="status">
            <p class="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">{d.type} · {h.from}</p>
            {d.details ? <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">{d.details.map(([k, v]) => <><dt class="font-semibold">{k}</dt><dd class="break-all">{v}</dd></>)}</dl>
              : <p class="whitespace-pre-wrap break-all text-[15px] text-ink dark:text-white">{h.text}</p>}
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-secondary min-h-10 px-3 text-sm" onClick={() => { navigator.clipboard?.writeText(d.type === 'Wi-Fi network' ? d.details![1][1] : h.text); setCopied(i); setTimeout(() => setCopied(null), 1500); }}>{copied === i ? 'Copied!' : d.type === 'Wi-Fi network' ? 'Copy password' : 'Copy'}</button>
              {d.action && <a class="btn-secondary min-h-10 px-3 text-sm" href={d.action.href} target="_blank" rel="noopener noreferrer nofollow">{d.action.label} ↗</a>}
            </div>
            {d.action?.href.startsWith('http') && <p class="text-xs text-muted dark:text-gray-400">Check the address before opening: QR codes can point anywhere.</p>}
          </div>
        );
      })}
      <PrivacyNote />
    </div>
  );
}
