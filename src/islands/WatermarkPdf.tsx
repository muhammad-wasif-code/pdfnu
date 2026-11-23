import { useEffect, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import OptionChips from '../components/ui/OptionChips';
import PositionPicker, { previewStyle } from '../components/ui/PositionPicker';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import { IMAGE_ACCEPT, isImage } from '../lib/image';
import type { Position } from '../lib/pdfOps';
import { usePdfDoc } from './usePdfDoc';

const COLORS = [
  { v: '#6b7280', n: 'Gray' }, { v: '#dc2626', n: 'Red' }, { v: '#2563eb', n: 'Blue' }, { v: '#111827', n: 'Black' }, { v: '#16a34a', n: 'Green' },
];
type Kind = 'text' | 'image';
type Size = 'auto' | '24' | '40' | '64';
type Angle = '0' | '45' | '-45';

export default function WatermarkPdf() {
  const doc = usePdfDoc(320, true);
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('CONFIDENTIAL');
  const [size, setSize] = useState<Size>('auto');
  const [color, setColor] = useState('#6b7280');
  const [opacity, setOpacity] = useState(30);
  const [position, setPosition] = useState<Position>('center');
  const [angle, setAngle] = useState<Angle>('45');
  const [img, setImg] = useState<{ file: File; url: string } | null>(null);
  const [imgScale, setImgScale] = useState<'0.2' | '0.35' | '0.5'>('0.35');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (img) URL.revokeObjectURL(img.url); }, [img]);

  const pickImage = (files: File[]) => {
    const f = files[0];
    if (!f || !isImage(f)) { setError('Choose a PNG, JPG or WebP image for the watermark.'); return; }
    setError(null);
    setImg({ file: f, url: URL.createObjectURL(f) });
    setAngle('0');
  };

  const run = async () => {
    if (!doc.bytes) return;
    if (kind === 'text' && !text.trim()) { setError('Type the watermark text first.'); return; }
    if (kind === 'image' && !img) { setError('Choose an image for the watermark.'); return; }
    setPhase('working'); setError(null);
    try {
      const { pdfOp } = await import('../lib/pdfWorker');
      let image: ArrayBuffer | undefined;
      if (kind === 'image' && img) {
        // Normalise to PNG (keeps transparency, supports WebP input)
        const { decodeImage, draw, toBlob } = await import('../lib/image');
        const d = await decodeImage(img.file, img.file.name);
        const scale = Math.min(1, 1600 / Math.max(d.width, d.height));
        const c = draw(d, d.width * scale, d.height * scale, 'stretch', null);
        image = await (await toBlob(c, 'image/png')).arrayBuffer();
        d.close();
      }
      const res = await pdfOp('watermark', [doc.bytes.slice().buffer, {
        kind, text: text.trim(), fontSize: size === 'auto' ? undefined : Number(size), color, opacity: opacity / 100,
        position, angle: Number(angle), image, imageType: 'png', imageScale: Number(imgScale),
      }]);
      setOut(res); setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { doc.clear(); setOut(null); setPhase('edit'); };

  if (phase === 'done' && out && doc.file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title="Watermark added!" stats={[['Pages', String(doc.pageCount)], ['Opacity', `${opacity}%`], ['Size', formatBytes(out.length)]]}
          onDownload={() => downloadBlob(out, doc.file!.name)} downloadLabel={`Download ${doc.file.name.length > 30 ? 'PDF' : doc.file.name}`} onReset={reset} resetLabel="Watermark another PDF">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Adjust watermark</button>
        </ResultCard>
      </div>
    );
  }

  const first = doc.thumbs[0];
  const tile = position === 'tile';
  const markText = (
    <span style={{ color, opacity: opacity / 100, fontSize: size === 'auto' ? '15cqw' : `${Number(size) / 6}cqw`, fontWeight: 700, whiteSpace: 'nowrap', fontFamily: 'Helvetica, Arial, sans-serif', lineHeight: 1 }}>{text || ' '}</span>
  );
  const markImg = img && <img src={img.url} alt="" style={{ width: `${Number(imgScale) * 100}cqw`, opacity: opacity / 100 }} />;

  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!doc.file ? <Dropzone accept="application/pdf,.pdf" title="Drag & drop your PDF here" buttonLabel="Select PDF" onFiles={doc.open} />
        : <FileRow name={doc.file.name} size={`${doc.pageCount} pages · ${formatBytes(doc.file.size)}`} onRemove={reset} />}
      {doc.loading && <ProgressBar label="Reading PDF…" value={null} />}
      {(doc.error || error) && <ErrorBox onRetry={doc.error ? reset : undefined}>{doc.error || error}</ErrorBox>}

      {doc.file && (
        <div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_220px]">
          <div class="space-y-4">
            <OptionChips label="Watermark type" options={[{ value: 'text', label: 'Text' }, { value: 'image', label: 'Image / logo' }]} value={kind} onChange={(v) => { if (v) { setKind(v); setAngle(v === 'image' ? '0' : '45'); } }} />
            {kind === 'text' ? (
              <>
                <label class="block">
                  <span class="mb-1.5 block text-sm font-semibold text-ink dark:text-white">Text</span>
                  <input type="text" maxLength={80} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)}
                    class="h-12 w-full rounded-control border border-line bg-white px-4 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 dark:border-white/10 dark:bg-night-2" />
                  <span class="mt-1 block text-xs text-muted dark:text-gray-400">Any language works: English, Urdu, Arabic, Hindi, Chinese and more.</span>
                </label>
                <OptionChips label="Size" options={[{ value: 'auto', label: 'Auto' }, { value: '24', label: 'S' }, { value: '40', label: 'M' }, { value: '64', label: 'L' }]} value={size} onChange={(v) => v && setSize(v)} />
                <fieldset>
                  <legend class="mb-2 text-sm font-semibold text-ink dark:text-white">Color</legend>
                  <div class="flex gap-2">
                    {COLORS.map((c) => (
                      <button key={c.v} type="button" aria-label={c.n} aria-pressed={color === c.v} onClick={() => setColor(c.v)}
                        class={`h-11 w-11 rounded-full border-4 ${color === c.v ? 'border-brand-light' : 'border-white dark:border-night-2'} shadow ring-1 ring-black/10`} style={{ background: c.v }} />
                    ))}
                  </div>
                </fieldset>
              </>
            ) : (
              <>
                {img ? <FileRow kind="IMG" name={img.file.name} size={formatBytes(img.file.size)} onRemove={() => setImg(null)} />
                  : <Dropzone compact accept={IMAGE_ACCEPT} title="Choose a logo or image" buttonLabel="Select image" onFiles={pickImage} />}
                <OptionChips label="Image size" options={[{ value: '0.2', label: 'Small' }, { value: '0.35', label: 'Medium' }, { value: '0.5', label: 'Large' }]} value={imgScale} onChange={(v) => v && setImgScale(v)} />
              </>
            )}
            <label class="block">
              <span class="mb-1.5 flex justify-between text-sm font-semibold text-ink dark:text-white">Opacity <span class="tabular-nums text-muted dark:text-gray-400">{opacity}%</span></span>
              <input type="range" min={5} max={100} step={5} value={opacity} onInput={(e) => setOpacity(Number((e.target as HTMLInputElement).value))} class="h-11 w-full accent-brand" aria-label="Opacity" />
            </label>
            <div class="flex flex-wrap gap-6">
              <div>
                <PositionPicker value={tile ? 'center' : position} onChange={setPosition} />
                <label class="mt-2 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={tile} onChange={(e) => setPosition((e.target as HTMLInputElement).checked ? 'tile' : 'center')} /> Repeat across page</label>
              </div>
              <OptionChips label="Angle" options={[{ value: '0', label: '0°' }, { value: '45', label: '45°' }, { value: '-45', label: '−45°' }]} value={angle} onChange={(v) => v && setAngle(v)} />
            </div>
          </div>

          <div>
            <p class="mb-2 text-sm font-semibold text-ink dark:text-white">Preview</p>
            <div class="relative mx-auto w-full max-w-[220px] overflow-hidden rounded-md border border-line bg-white shadow-sm dark:border-white/10" style={{ aspectRatio: first?.aspect ? `1 / ${first.aspect}` : '1 / 1.414', containerType: 'inline-size' }} aria-hidden="true">
              {first?.url && <img src={first.url} alt="" class="absolute inset-0 h-full w-full object-contain" />}
              {tile ? (
                <div class="absolute inset-0 flex flex-col items-center justify-around">
                  {[0, 1, 2, 3].map((r) => <div key={r} style={{ transform: `rotate(${-Number(angle)}deg)` }}>{kind === 'text' ? markText : markImg}</div>)}
                </div>
              ) : (
                <div style={previewStyle(position, Number(angle))}>{kind === 'text' ? markText : markImg}</div>
              )}
            </div>
            <p class="mt-2 text-center text-xs text-muted dark:text-gray-400">Applied to all {doc.pageCount} pages</p>
          </div>
        </div>
      )}

      {doc.file && (phase === 'working' ? <ProgressBar label="Adding watermark…" value={null} /> : (
        <button type="button" class="btn-primary min-h-12 w-full text-[15px]" onClick={run}>Add watermark</button>
      ))}
      <PrivacyNote />
    </div>
  );
}
