import { useState } from 'preact/hooks';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, PrivacyNote } from '../components/ui/Notice';
import { downloadBlob } from '../lib/download';
import { makeBarcode, barcodeSvg, type Symbology } from '../lib/barcode';

const SYMS: { v: Symbology; l: string; hint: string; sample: string }[] = [
  { v: 'code128', l: 'Code 128', hint: 'Letters, numbers and symbols: shipping labels, inventory, IDs', sample: 'PDFSHERPA-2026' },
  { v: 'ean13', l: 'EAN-13', hint: '12 digits (the check digit is added): retail products worldwide', sample: '590123412345' },
  { v: 'upca', l: 'UPC-A', hint: '11 digits (the check digit is added): retail products in North America', sample: '03600029145' },
  { v: 'ean8', l: 'EAN-8', hint: '7 digits: small packages', sample: '9638507' },
  { v: 'code39', l: 'Code 39', hint: 'A–Z, 0–9 and - . $ / + %: industry, badges', sample: 'ABC-123' },
  { v: 'itf14', l: 'ITF-14', hint: '13 digits: cartons and outer packaging', sample: '1540014128876' },
];
const ERR: Record<string, string> = { DIGITS: 'Enter the right number of digits for this barcode type.', CHECK: 'The last digit is not a valid check digit. Leave it out and it will be calculated.', CODE128_CHARS: 'Code 128 supports standard keyboard characters only (no accents or emoji).', CODE39_CHARS: 'Code 39 supports A–Z, 0–9, space and - . $ / + % only.', EMPTY: 'Enter the value to encode.' };

export default function BarcodeGenerator() {
  const [sym, setSym] = useState<Symbology>('code128');
  const [value, setValue] = useState(SYMS[0].sample);
  const [height, setHeight] = useState(80);
  const [showText, setShowText] = useState(true);
  const [fg, setFg] = useState('#000000');
  const [transparent, setTransparent] = useState(false);
  let svg = '', error: string | null = null, w = 0, h = 0, text = '';
  try { const b = makeBarcode(sym, value); text = b.text; const r = barcodeSvg(b, { height, module: 2, showText, fg, bg: transparent ? null : '#ffffff', quiet: 10 }); svg = r.svg; w = r.w; h = r.h; }
  catch (e) { error = ERR[(e as Error).message] ?? 'This value can’t be encoded.'; }
  const png = async (scale: number) => {
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
    const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => b && downloadBlob(b, `barcode-${text}.png`, 'image/png'), 'image/png');
  };
  const cur = SYMS.find((s) => s.v === sym)!;
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      <OptionChips<Symbology> label="Barcode type" value={sym} onChange={(v) => { if (v) { setSym(v); setValue(SYMS.find((s) => s.v === v)!.sample); } }} options={SYMS.map((s) => ({ value: s.v, label: s.l }))} />
      <p class="text-xs text-muted dark:text-gray-400">{cur.hint}</p>
      <input type="text" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} aria-label="Value" inputMode={/ean|upc|itf/.test(sym) ? 'numeric' : 'text'}
        class="h-12 w-full rounded-control border border-line bg-white px-3 font-mono text-lg outline-none focus:border-brand dark:border-white/10 dark:bg-night-2" />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div class="grid min-h-40 place-items-center overflow-x-auto rounded-control border border-line p-4 dark:border-white/10" style={{ background: 'repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/16px 16px' }}>
        {svg && <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} alt={`Barcode ${text}`} style={{ maxWidth: '100%', imageRendering: 'pixelated' }} />}
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block text-sm font-semibold">Bar height<input type="range" min={30} max={200} value={height} onInput={(e) => setHeight(+(e.target as HTMLInputElement).value)} class="mt-1 h-9 w-full accent-brand" /></label>
        <div class="flex flex-wrap items-center gap-3 text-sm">
          <label class="flex items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={showText} onChange={(e) => setShowText((e.target as HTMLInputElement).checked)} />Show numbers</label>
          <label class="flex items-center gap-2"><input type="checkbox" class="h-5 w-5 accent-brand" checked={transparent} onChange={(e) => setTransparent((e.target as HTMLInputElement).checked)} />Transparent</label>
          <label class="flex items-center gap-2">Colour <input type="color" value={fg} onInput={(e) => setFg((e.target as HTMLInputElement).value)} class="h-9 w-12 cursor-pointer rounded border border-line" /></label>
        </div>
      </div>
      <div class="grid gap-2 sm:grid-cols-3">
        <button type="button" class="btn-primary min-h-12" disabled={!svg} onClick={() => png(3)}>Download PNG</button>
        <button type="button" class="btn-secondary min-h-12" disabled={!svg} onClick={() => png(8)}>PNG (high-res print)</button>
        <button type="button" class="btn-secondary min-h-12" disabled={!svg} onClick={() => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `barcode-${text}.svg`, 'image/svg+xml')}>SVG (vector)</button>
      </div>
      <p class="text-xs text-muted dark:text-gray-400">Selling in shops? Retail EAN/UPC numbers must be registered with GS1; this tool draws the barcode for a number you already have.</p>
      <PrivacyNote />
    </div>
  );
}
