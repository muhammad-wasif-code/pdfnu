import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { StickyActions } from '../components/ui/Sticky';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';
import type { Area, Hide } from '../lib/imageOps';

type A = Area & { id: number };
let seq = 0;

export default function BlurImage() {
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  const [areas, setAreas] = useState<A[]>([]);
  const [mode, setMode] = useState<Hide>('blur');
  const [shape, setShape] = useState<'rect' | 'ellipse'>('rect');
  const [strength, setStrength] = useState(60);
  const [whole, setWhole] = useState(false);
  const [draft, setDraft] = useState<Area | null>(null);
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [out, setOut] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stage = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<[number, number] | null>(null);
  // the latest box, readable from pointerup even before React re-renders
  const draftRef = useRef<Area | null>(null);

  const open = async (files: File[]) => {
    const f = files[0];
    setError(null);
    try {
      const [{ decodeImage }, { scaled }] = await Promise.all([import('../lib/image'), import('../lib/imageOps')]);
      const d = await decodeImage(f, f.name);
      setImg(scaled(d, 5000)); d.close(); setFile(f); setAreas([]);
    } catch (e) { setError(friendlyError(e).message); }
  };
  const list = (): Area[] => (whole ? [{ x: 0, y: 0, w: 1, h: 1, ellipse: false }] : areas);

  useEffect(() => {
    const c = stage.current;
    if (!c || !img) return;
    import('../lib/imageOps').then(({ scaled, hideAreas }) => {
      const small = scaled(img, 1100);
      const r = hideAreas(small, list(), mode, strength);
      c.width = r.width; c.height = r.height;
      c.getContext('2d')!.drawImage(r, 0, 0);
    });
  }, [img, areas, mode, strength, whole]);

  const setDraftBoth = (d: Area | null) => { draftRef.current = d; setDraft(d); };
  const pt = (e: PointerEvent): [number, number] => { const r = box.current!.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  const down = (e: PointerEvent) => { if (whole) return; e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); start.current = pt(e); };
  const move = (e: PointerEvent) => { if (!start.current) return; const [x, y] = pt(e), [sx, sy] = start.current; setDraftBoth({ x: Math.min(x, sx), y: Math.min(y, sy), w: Math.abs(x - sx), h: Math.abs(y - sy), ellipse: shape === 'ellipse' }); };
  const up = () => { const d = draftRef.current; start.current = null; setDraftBoth(null); if (d && d.w > 0.01 && d.h > 0.01) setAreas((a) => [...a, { ...d, id: seq++ }]); };

  const save = async () => {
    if (!img || !file || !list().length) return;
    setPhase('working'); setError(null);
    try {
      const [{ hideAreas }, { toBlob }] = await Promise.all([import('../lib/imageOps'), import('../lib/image')]);
      const c = hideAreas(img, list(), mode, strength);
      setOut(await toBlob(c, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92)); c.width = c.height = 0;
      setPhase('done');
    } catch (e) { setError(friendlyError(e).message); setPhase('edit'); }
  };
  const reset = () => { setFile(null); setImg(null); setAreas([]); setOut(null); setPhase('edit'); setWhole(false); };

  if (phase === 'done' && out && file) {
    return (
      <div class="card p-4 sm:p-6">
        <ResultCard title={mode === 'pixelate' ? 'Image pixelated!' : mode === 'solid' ? 'Areas covered!' : 'Image blurred!'} stats={[['Areas', whole ? 'Whole image' : String(areas.length)], ['Size', `${img?.width}×${img?.height}`], ['File', formatBytes(out.size)]]}
          highlight="The original pixels in those areas are gone from the saved image, and the photo’s hidden data (EXIF, location) is not copied."
          onDownload={() => downloadBlob(out, `${stripExt(file.name)}-${mode === 'pixelate' ? 'pixelated' : 'blurred'}.${out.type === 'image/png' ? 'png' : 'jpg'}`, out.type)} downloadLabel="Download image" onReset={reset} resetLabel="Use another image">
          <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Keep editing</button>
        </ResultCard>
      </div>
    );
  }

  return (
    <div class="card space-y-4 p-4 sm:p-6">
      {!file ? <Dropzone accept="image/*" title="Drag & drop your image here" buttonLabel="Select image" hint="Hide faces, number plates, names or screenshots details." onFiles={open} />
        : <FileRow name={file.name} size={`${img?.width}×${img?.height} · ${formatBytes(file.size)}`} kind="IMG" onRemove={reset} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {img && (
        <>
          <div class="grid gap-3 sm:grid-cols-2">
            <OptionChips<Hide> label="Effect" value={mode} onChange={(v) => v && setMode(v)} options={[{ value: 'blur', label: 'Blur' }, { value: 'pixelate', label: 'Pixelate' }, { value: 'solid', label: 'Black box' }]} />
            <OptionChips<'rect' | 'ellipse'> label="Shape" value={shape} onChange={(v) => v && setShape(v)} options={[{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Oval (faces)' }]} />
          </div>
          {mode !== 'solid' && <label class="flex items-center gap-2 text-sm font-semibold">Strength <input type="range" min={5} max={100} value={strength} onInput={(e) => setStrength(+(e.target as HTMLInputElement).value)} class="h-9 min-w-0 flex-1 accent-brand" /></label>}
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <label class="flex min-h-11 items-center gap-2 font-semibold"><input type="checkbox" class="h-5 w-5 accent-brand" checked={whole} onChange={(e) => setWhole((e.target as HTMLInputElement).checked)} />Whole image</label>
            {!whole && areas.length > 0 && <button type="button" class="btn-secondary min-h-10 px-3 text-sm" onClick={() => setAreas((a) => a.slice(0, -1))}>↶ Undo</button>}
            {!whole && areas.length > 0 && <button type="button" class="btn-secondary min-h-10 px-3 text-sm" onClick={() => setAreas([])}>Clear all</button>}
          </div>
          {mode === 'pixelate' && <p class="text-xs text-amber-800 dark:text-amber-200">For text such as names or account numbers, Blur at high strength or Black box is safer: light pixelation can sometimes be reversed.</p>}
          <div ref={box} class="relative mx-auto w-fit max-w-full select-none" style={{ touchAction: whole ? 'auto' : 'none', cursor: whole ? 'default' : 'crosshair' }}
            onPointerDown={(e) => down(e as unknown as PointerEvent)} onPointerMove={(e) => move(e as unknown as PointerEvent)} onPointerUp={up} onPointerCancel={up}>
            <canvas ref={stage} class="block max-h-[70vh] max-w-full rounded-md shadow-sm" />
            {!whole && areas.map((a) => <span key={a.id} class={`pointer-events-none absolute border border-dashed border-white/80 ${a.ellipse ? 'rounded-[50%]' : ''}`} style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%`, boxShadow: '0 0 0 1px rgba(0,0,0,.35)' }} />)}
            {draft && <span class={`pointer-events-none absolute border-2 border-dashed border-brand bg-brand/10 ${draft.ellipse ? 'rounded-[50%]' : ''}`} style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />}
          </div>
          <p class="text-center text-xs text-muted dark:text-gray-400">{whole ? 'The whole picture is blurred.' : 'Drag over each face, plate or detail you want to hide.'}</p>
          <StickyActions>
            {phase === 'working' ? <ProgressBar label="Saving…" value={null} /> : (
              <button type="button" class="btn-primary min-h-12 w-full text-[15px]" disabled={!list().length} onClick={save}>{list().length ? `Save image${whole ? '' : ` (${areas.length} area${areas.length === 1 ? '' : 's'})`}` : 'Drag over an area first'}</button>
            )}
          </StickyActions>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
