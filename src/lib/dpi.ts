/** Read and change the DPI stored in JPEG (JFIF + EXIF) and PNG (pHYs) files without touching the pixels. */

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function readDpi(b: Uint8Array): number | null {
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 4 <= b.length && b[p] === 0xff) {
      const m = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
      if (m === 0xe0 && b[p + 4] === 0x4a && b[p + 5] === 0x46) { const unit = b[p + 11], x = (b[p + 12] << 8) | b[p + 13]; if (unit === 1 && x > 1) return x; if (unit === 2 && x > 1) return Math.round(x * 2.54); }
      if (m === 0xda) break;
      p += 2 + len;
    }
    return null;
  }
  if (b[0] === 0x89 && b[1] === 0x50) {
    let p = 8;
    while (p + 12 <= b.length) {
      const len = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0, type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      if (type === 'pHYs' && b[p + 16] === 1) return Math.round((((b[p + 8] << 24 | b[p + 9] << 16 | b[p + 10] << 8 | b[p + 11]) >>> 0) * 0.0254));
      if (type === 'IDAT') break;
      p += 12 + len;
    }
  }
  return null;
}

export function setDpi(b: Uint8Array, dpi: number): Uint8Array {
  dpi = Math.max(1, Math.min(65535, Math.round(dpi)));
  if (b[0] === 0xff && b[1] === 0xd8) {
    const out = b.slice();
    let p = 2, jfif = false;
    while (p + 4 <= out.length && out[p] === 0xff) {
      const m = out[p + 1], len = (out[p + 2] << 8) | out[p + 3];
      if (m === 0xda) break;
      if (m === 0xe0 && out[p + 4] === 0x4a && out[p + 5] === 0x46) { out[p + 11] = 1; out[p + 12] = dpi >> 8; out[p + 13] = dpi & 255; out[p + 14] = dpi >> 8; out[p + 15] = dpi & 255; jfif = true; }
      if (m === 0xe1 && String.fromCharCode(...out.subarray(p + 4, p + 8)) === 'Exif') setExifDpi(out, p + 10, dpi);
      p += 2 + len;
    }
    if (jfif) return out;
    // no JFIF block (most camera photos): add one after SOI
    const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0];
    const r = new Uint8Array(out.length + app0.length);
    r.set(out.subarray(0, 2)); r.set(app0, 2); r.set(out.subarray(2), 2 + app0.length);
    return r;
  }
  if (b[0] === 0x89 && b[1] === 0x50) {
    const ppm = Math.round(dpi / 0.0254);
    const data = new Uint8Array([ppm >>> 24, (ppm >> 16) & 255, (ppm >> 8) & 255, ppm & 255, ppm >>> 24, (ppm >> 16) & 255, (ppm >> 8) & 255, ppm & 255, 1]);
    const chunk = new Uint8Array(21);
    chunk.set([0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73]); chunk.set(data, 8);
    const c = crc32(chunk.subarray(4, 17)); chunk.set([c >>> 24, (c >> 16) & 255, (c >> 8) & 255, c & 255], 17);
    const parts: Uint8Array[] = [b.subarray(0, 8)];
    let p = 8, done = false;
    while (p + 12 <= b.length) {
      const len = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0, type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      if (type === 'pHYs') { p += 12 + len; continue; }
      if (!done && (type === 'IDAT')) { parts.push(chunk); done = true; }
      parts.push(b.subarray(p, p + 12 + len));
      p += 12 + len;
      if (type === 'IEND') break;
    }
    const r = new Uint8Array(parts.reduce((t, x) => t + x.length, 0));
    let o = 0; for (const x of parts) { r.set(x, o); o += x.length; }
    return r;
  }
  throw new Error('FORMAT');
}

/** XResolution/YResolution/ResolutionUnit in IFD0, edited in place where present. */
function setExifDpi(b: Uint8Array, tiff: number, dpi: number) {
  const dv = new DataView(b.buffer, b.byteOffset);
  const le = dv.getUint16(tiff) === 0x4949;
  const ifd = tiff + dv.getUint32(tiff + 4, le);
  if (ifd + 2 > b.length) return;
  const n = dv.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = dv.getUint16(e, le);
    if (tag === 0x011a || tag === 0x011b) { const off = tiff + dv.getUint32(e + 8, le); if (off + 8 <= b.length) { dv.setUint32(off, dpi, le); dv.setUint32(off + 4, 1, le); } }
    if (tag === 0x0128) dv.setUint16(e + 8, 2, le);
  }
}
