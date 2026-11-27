import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from '../components/ui/Dropzone';
import ProgressBar from '../components/ui/ProgressBar';
import ResultCard from '../components/ui/ResultCard';
import OptionChips from '../components/ui/OptionChips';
import { ErrorBox, FileRow, PrivacyNote } from '../components/ui/Notice';
import { formatBytes, stripExt } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { downloadBlob } from '../lib/download';

const MAX_FRAMES = 300;

export default function VideoToGif() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [dur, setDur] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [fps, setFps] = useState<'5' | '10' | '15'>('10');
  const [width, setWidth] = useState<'320' | '480' | '640'>('480');
  const [speed, setSpeed] = useState<'0.5' | '1' | '2'>('1');
  const [phase, setPhase] = useState<'edit' | 'working' | 'done'>('edit');
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState<{ blob: Blob; url: string; frames: number; w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  const open = (files: File[]) => {
    const f = files[0];
    setError(null);
    if (!/^video\//.test(f.type) && !/\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(f.name)) { setError(`“${f.name}” is not a video file.`); return; }
    if (url) URL.revokeObjectURL(url);
    setFile(f); setUrl(URL.createObjectURL(f)); setOut(null);
  };
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, []);
  const onMeta = async () => {
    const v = video.current!;
    let d = v.duration;
    // screen and browser recordings (WebM) often have no duration in the header: seek far ahead to find it
    if (!isFinite(d)) {
      d = await new Promise<number>((res) => {
        const done = () => { v.removeEventListener('durationchange', check); v.removeEventListener('timeupdate', check); res(v.duration); };
        const check = () => { if (isFinite(v.duration)) done(); };
        v.addEventListener('durationchange', check); v.addEventListener('timeupdate', check);
        v.currentTime = 1e101;
        setTimeout(() => res(isFinite(v.duration) ? v.duration : NaN), 4000);
      });
      v.currentTime = 0;
    }
    if (!isFinite(d) || d <= 0) { setError('This video can’t be read by your browser. MP4 (H.264) and WebM work everywhere.'); return; }
    setDur(d); setStart(0); setEnd(Math.min(d, 5));
  };

  const n = Math.min(MAX_FRAMES, Math.max(1, Math.round((end - start) * +fps)));
  const make = async () => {
    const v = video.current; if (!v || end <= start) return;
    setPhase('working'); setError(null); setProgress(0);
    try {
      const W = +width, H = Math.max(1, Math.round((W * v.videoHeight) / v.videoWidth));
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      const frames: { data: Uint8ClampedArray; delay: number }[] = [];
      v.pause();
      for (let i = 0; i < n; i++) {
        const t = start + (i / +fps);
        await new Promise<void>((res, rej) => { const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = Math.min(t, dur - 0.01); setTimeout(() => rej(new Error('SEEK')), 8000); });
        ctx.drawImage(v, 0, 0, W, H);
        frames.push({ data: ctx.getImageData(0, 0, W, H).data, delay: 1000 / +fps / +speed });
        setProgress(((i + 1) / n) * 0.7);
      }
      await new Promise((r) => setTimeout(r, 20));
      const { encodeGif } = await import('../lib/gif');
      const gif = encodeGif(frames, W, H, { loop: 0, dither: false, transparent: false });
      const blob = new Blob([gif as BlobPart], { type: 'image/gif' });
      setOut({ blob, url: URL.createObjectURL(blob), frames: frames.length, w: W, h: H });
      setPhase('done');
    } catch (e) { setError((e as Error)?.message === 'SEEK' ? 'The video couldn’t be read frame by frame. Try an MP4 or WebM file.' : friendlyError(e).message); setPhase('edit'); }
  };
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  if (phase === 'done' && out && file) return (
    <div class="card p-4 sm:p-6">
      <ResultCard title="Your GIF is ready!" stats={[['Frames', String(out.frames)], ['Size', `${out.w}×${out.h}`], ['File', formatBytes(out.blob.size)]]}
        warnings={out.blob.size > 8 * 1024 * 1024 ? ['This GIF is large. Choose a shorter clip, fewer frames per second or a smaller width for chats and websites.'] : undefined}
        onDownload={() => downloadBlob(out.blob, `${stripExt(file.name)}.gif`, 'image/gif')} downloadLabel="Download GIF" onReset={() => { setFile(null); setOut(null); setPhase('edit'); }} resetLabel="Convert another video">
        <img src={out.url} alt="Your GIF" class="mx-auto mt-3 max-h-72 rounded-md" />
        <button type="button" class="mt-3 text-sm font-semibold text-brand underline dark:text-brand-light" onClick={() => setPhase('edit')}>← Change clip</button>
      </ResultCard>
    </div>
  );
  return (
    <div class="card space-y-5 p-4 sm:p-6">
      {!file ? <Dropzone accept="video/*,.mp4,.webm,.mov,.m4v" title="Drag & drop your video here" buttonLabel="Select video" hint="MP4, WebM or MOV. Pick up to 30 seconds." onFiles={open} />
        : <FileRow name={file.name} size={`${dur ? fmt(dur) : '…'} · ${formatBytes(file.size)}`} kind="VID" onRemove={() => { setFile(null); setDur(0); }} />}
      {error && <ErrorBox>{error}</ErrorBox>}
      {file && (
        <>
          <video ref={video} src={url} controls muted playsInline preload="auto" onLoadedMetadata={onMeta} class="mx-auto max-h-80 w-full rounded-md bg-black" />
          {dur > 0 && (
            <>
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="block text-sm font-semibold">Start {fmt(start)}<input type="range" min={0} max={dur} step={0.1} value={start} onInput={(e) => { const v = +(e.target as HTMLInputElement).value; setStart(v); if (end <= v) setEnd(Math.min(dur, v + 1)); if (video.current) video.current.currentTime = v; }} class="mt-1 h-9 w-full accent-brand" /></label>
                <label class="block text-sm font-semibold">End {fmt(end)}<input type="range" min={0} max={dur} step={0.1} value={end} onInput={(e) => { const v = +(e.target as HTMLInputElement).value; setEnd(Math.max(start + 0.2, Math.min(v, start + 30))); if (video.current) video.current.currentTime = v; }} class="mt-1 h-9 w-full accent-brand" /></label>
              </div>
              <div class="grid gap-4 sm:grid-cols-3">
                <OptionChips<typeof fps> label="Frames per second" value={fps} onChange={(v) => v && setFps(v)} options={[{ value: '5', label: '5' }, { value: '10', label: '10' }, { value: '15', label: '15' }]} />
                <OptionChips<typeof width> label="Width" value={width} onChange={(v) => v && setWidth(v)} options={[{ value: '320', label: '320' }, { value: '480', label: '480' }, { value: '640', label: '640' }]} />
                <OptionChips<typeof speed> label="Speed" value={speed} onChange={(v) => v && setSpeed(v)} options={[{ value: '0.5', label: '0.5×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }]} />
              </div>
              <p class="text-sm text-muted dark:text-gray-400">{(end - start).toFixed(1)} s clip → {n} frames{n === MAX_FRAMES ? ' (maximum)' : ''}. Videos are not uploaded; frames are read in your browser.</p>
              {phase === 'working' ? <ProgressBar label={progress < 0.7 ? 'Reading frames…' : 'Encoding GIF…'} value={progress || null} /> : <button type="button" class="btn-primary min-h-12 w-full" onClick={make}>Make GIF</button>}
            </>
          )}
        </>
      )}
      <PrivacyNote />
    </div>
  );
}
