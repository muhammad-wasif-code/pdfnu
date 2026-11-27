import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OutputList, { downloadAll, type OutFile } from '../components/ui/OutputList';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';

const PRESETS: { c: number; r: number; label: string }[] = [
  { c: 3, r: 1, label: '3 × 1 (Instagram row)' }, { c: 3, r: 2, label: '3 × 2' }, { c: 3, r: 3, label: '3 × 3 (Instagram grid)' },
  { c: 2, r: 1, label: '2 × 1 (carousel)' }, { c: 2, r: 2, label: '2 × 2' }, { c: 4, r: 4, label: '4 × 4' },
];

export default function GridSplitter() {
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [square, setSquare] = useState(true);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [outs, setOuts] = useState<OutFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const open = async (files: File[]) => {
    setError(null);
    try {
      const [{ decodeImage }, { toCanvas }] = await Promise.all([import('../lib/image'), import('../lib/imageOps')]);
      const d = await decodeImage(files[0], files[0].name); setImg(toCanvas(d)); d.close(); setFile(files[0]);
    } catch (e) { setError(friendlyError(e).message); }
  };
  /** The area that is split: centre-cropped so each tile is square when `square` is on. */
  const area = (i: HTMLCanvasElement) => {
    if (!square) return { x: 0, y: 0, w: i.width, h: i.height };
    const tile = Math.min(i.width / cols, i.height / rows);
    const w = tile * cols, h = tile * rows;
    return { x: (i.width - w) / 2, y: (i.height - h) / 2, w, h };
  };
  useEffect(() => {
    if (!img || !stage.current) return;
    const k = Math.min(1, 640 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, c.width, c.height);
    const a = area(img);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, c.width, a.y * k); ctx.fillRect(0, (a.y + a.h) * k, c.width, c.height); ctx.fillRect(0, a.y * k, a.x * k, a.h * k); ctx.fillRect((a.x + a.w) * k, a.y * k, c.width, a.h * k);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    for (let i = 1; i < cols; i++) { const x = (a.x + (a.w * i) / cols) * k; ctx.beginPath(); ctx.moveTo(x, a.y * k); ctx.lineTo(x, (a.y + a.h) * k); ctx.stroke(); }
    for (let j = 1; j < rows; j++) { const y = (a.y + (a.h * j) / rows) * k; ctx.beginPath(); ctx.moveTo(a.x * k, y); ctx.lineTo((a.x + a.w) * k, y); ctx.stroke(); }
    c.style.cssText = 'display:block;max-width:100%;margin:auto;border-radius:6px';
    stage.current.replaceChildren(c);
  }, [img, cols, rows, square]);

  const run = async () => {
    if (!img || !file) return;
    setPhase('working'); setError(null);
    try {
      const { toBlob } = await import('../lib/image');
      const a = area(img), tw = a.w / cols, th = a.h / rows;
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const res: OutFile[] = [];
      // Instagram shows the newest post first: number tiles so the last one is posted first
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const t = document.createElement('canvas'); t.width = Math.round(tw); t.height = Math.round(th);
        t.getContext('2d')!.drawImage(img, a.x + c * tw, a.y + r * th, tw, th, 0, 0, t.width, t.height);
        const b = await toBlob(t, type as any, 0.95);
        const idx = r * cols + c + 1, total = rows * cols;
        res.push({ name: `${stripExt(file.name)}-${String(idx).padStart(2, '0')}.${type === 'image/png' ? 'png' : 'jpg'}`, data: new Uint8Array(await b.arrayBuffer()), note: `row ${r + 1}, column ${c + 1} · post #${total - idx + 1}` });
      }
      setOuts(res); setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setImg(null); setOuts([]); setPhase('edit'); };

  if (phase === 'done' && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={`Split into ${outs.length} tiles!`} stats={[['Grid', `${cols} × ${rows}`], ['Tiles', String(outs.length)], ['Total', formatBytes(outs.reduce((t, o) => t + o.data.length, 0))]]}
          highlight="For an Instagram grid, post the highest number first and tile 01 last."
          onDownload={() => downloadAll(outs, `${stripExt(file.name)}-grid.zip`)} downloadLabel="Download all (.zip)" onReset={reset} resetLabel="Split another image">
          <OutputList files={outs} />
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change grid</button>
        </ResultCard>
      </div>
    );
  }
  const num = (v: number, set: (n: number) => void, label: string) => (
    <label class="flex items-center gap-2 text-sm font-semibold">{label}<input type="number" min={1} max={10} value={v} onInput={(e) => set(Math.max(1, Math.min(10, +(e.target as HTMLInputElement).value || 1)))} class="h-11 w-20 rounded-control border border-line bg-white px-3 dark:border-white/10 dark:bg-night-2" /></label>
  );
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="image/*" title="Drag & drop your image here" buttonLabel="Select image" hint="Split a panorama or poster into equal tiles." onFiles={open} />
        : <FileRow name={file.name} size={`${img?.width}×${img?.height} · ${formatBytes(file.size)}`} kind="IMG" onRemove={reset} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {img && (
        <>
          <div ref={stage} />
          <div class="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => <button key={p.label} type="button" aria-pressed={cols === p.c && rows === p.r} onClick={() => { setCols(p.c); setRows(p.r); }} class={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${cols === p.c && rows === p.r ? 'border-brand bg-brand-soft text-brand dark:bg-brand/15 dark:text-brand-light' : 'border-line bg-surface dark:border-white/10 dark:bg-white/[.03]'}`}>{p.label}</button>)}
          </div>
          <div class="flex flex-wrap items-center gap-4">{num(cols, setCols, 'Columns')}{num(rows, setRows, 'Rows')}
            <label class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-brand" checked={square} onChange={(e) => setSquare((e.target as HTMLInputElement).checked)} />Square tiles (crop the edges)</label>
          </div>
          {phase === 'working' ? <ProgressBar label="Cutting tiles…" value={null} /> : <button type="button" class="btn-primary min-h-12 w-full" onClick={run}>Split into {cols * rows} tiles</button>}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
