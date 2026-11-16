import { useEffect, useRef, useState } from 'preact/hooks';
import { friendlyError } from '../lib/errors';
import type { ThumbJob } from '../lib/thumbs';

export interface PageThumbState { url?: string; aspect?: number; }

/** Single-PDF state: validates, reads, and streams page thumbnails. */
export function usePdfDoc(thumbWidth = 140, firstOnly = false) {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [thumbs, setThumbs] = useState<PageThumbState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const job = useRef<ThumbJob | null>(null);
  const urls = useRef<string[]>([]);

  const clear = () => {
    job.current?.cancel();
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    setFile(null); setBytes(null); setPageCount(0); setThumbs([]); setError(null);
  };
  useEffect(() => clear, []);

  const open = async (files: File[]) => {
    clear();
    const f = files[0];
    setLoading(true);
    try {
      const { readPdf } = await import('../lib/pdfFile');
      const { renderThumbnails } = await import('../lib/thumbs');
      const pdf = await readPdf(f);
      setFile(f); setBytes(pdf.bytes); setPageCount(pdf.pageCount);
      setThumbs(Array.from({ length: pdf.pageCount }, () => ({})));
      job.current = renderThumbnails(pdf.bytes, thumbWidth, (i, url, aspect) => {
        urls.current.push(url);
        setThumbs((cur) => { const next = cur.slice(); next[i] = { url, aspect }; return next; });
      }, undefined, firstOnly ? [0] : undefined);
      job.current.done.catch(() => {});
    } catch (e) {
      setError(friendlyError(e).message);
    } finally {
      setLoading(false);
    }
  };

  return { file, bytes, pageCount, thumbs, error, loading, open, clear, setError };
}
