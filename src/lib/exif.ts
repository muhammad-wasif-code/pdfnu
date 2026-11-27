/**
 * Photo metadata: read EXIF/GPS/XMP/IPTC and remove it without re-compressing the picture.
 * JPEG: metadata segments are dropped (the orientation is kept in a tiny EXIF block so the photo
 * still shows the right way up). PNG: text/time/EXIF chunks are dropped. WebP: EXIF/XMP chunks.
 */

export interface MetaInfo {
  format: 'jpeg' | 'png' | 'webp' | 'other';
  fields: [string, string][];
  gps: { lat: number; lon: number } | null;
  hasExif: boolean; hasXmp: boolean; hasIptc: boolean; hasComment: boolean; hasIcc: boolean;
  orientation: number;
}

const TAGS: Record<number, string> = {
  0x010f: 'Camera make', 0x0110: 'Camera model', 0x0131: 'Software', 0x0132: 'Date modified', 0x013b: 'Artist', 0x8298: 'Copyright',
  0x9003: 'Date taken', 0xa434: 'Lens', 0x829a: 'Exposure time', 0x829d: 'F-number', 0x8827: 'ISO', 0x920a: 'Focal length',
  0xa420: 'Unique image ID', 0xa431: 'Camera serial number', 0x010e: 'Description', 0xa002: 'Width', 0xa003: 'Height',
};

function readTiff(b: Uint8Array, start: number, info: MetaInfo) {
  const dv = new DataView(b.buffer, b.byteOffset + start);
  const le = dv.getUint16(0) === 0x4949;
  const u16 = (o: number) => dv.getUint16(o, le), u32 = (o: number) => dv.getUint32(o, le);
  const val = (type: number, count: number, off: number): string | number[] => {
    const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type] ?? 1;
    const p = size * count <= 4 ? off : u32(off);
    if (p + size * count > dv.byteLength) return '';
    if (type === 2) { let s = ''; for (let i = 0; i < count; i++) { const c = dv.getUint8(p + i); if (c) s += String.fromCharCode(c); } return s.trim(); }
    const out: number[] = [];
    for (let i = 0; i < Math.min(count, 16); i++) {
      if (type === 3) out.push(u16(p + i * 2)); else if (type === 4) out.push(u32(p + i * 4));
      else if (type === 5 || type === 10) { const d = u32(p + i * 8 + 4); out.push(d ? u32(p + i * 8) / d : 0); } else out.push(dv.getUint8(p + i));
    }
    return out;
  };
  const ifd = (o: number, gps = false, depth = 0) => {
    if (o + 2 > dv.byteLength || depth > 3) return;
    const n = u16(o);
    const g: Record<number, string | number[]> = {};
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (!gps && tag === 0x8769) { ifd(u32(e + 8), false, depth + 1); continue; }
      if (!gps && tag === 0x8825) { ifd(u32(e + 8), true, depth + 1); continue; }
      const v = val(type, count, e + 8);
      if (gps) { g[tag] = v; continue; }
      if (tag === 0x0112 && Array.isArray(v)) info.orientation = v[0];
      const name = TAGS[tag];
      if (!name) continue;
      let text = Array.isArray(v) ? (tag === 0x829a && v[0] < 1 ? `1/${Math.round(1 / v[0])} s` : tag === 0x829d ? `f/${v[0].toFixed(1)}` : tag === 0x920a ? `${Math.round(v[0])} mm` : v.join(', ')) : v;
      if (text) info.fields.push([name, String(text)]);
    }
    if (gps && Array.isArray(g[2]) && Array.isArray(g[4])) {
      const dms = (a: number[]) => a[0] + (a[1] ?? 0) / 60 + (a[2] ?? 0) / 3600;
      let lat = dms(g[2] as number[]), lon = dms(g[4] as number[]);
      if (g[1] === 'S') lat = -lat; if (g[3] === 'W') lon = -lon;
      if (lat || lon) info.gps = { lat, lon };
    }
  };
  ifd(u32(4));
}

export function readMeta(b: Uint8Array): MetaInfo {
  const info: MetaInfo = { format: 'other', fields: [], gps: null, hasExif: false, hasXmp: false, hasIptc: false, hasComment: false, hasIcc: false, orientation: 1 };
  const txt = (s: number, e: number) => String.fromCharCode(...b.subarray(s, Math.min(e, s + 64)));
  if (b[0] === 0xff && b[1] === 0xd8) {
    info.format = 'jpeg';
    let p = 2;
    while (p + 4 <= b.length && b[p] === 0xff) {
      const m = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
      if (m === 0xda || m === 0xd9) break;
      const body = p + 4;
      if (m === 0xe1 && txt(body, body + 6).startsWith('Exif')) { info.hasExif = true; try { readTiff(b, body + 6, info); } catch { /* broken EXIF */ } }
      else if (m === 0xe1 && txt(body, body + 30).includes('http://ns.adobe.com/xap')) info.hasXmp = true;
      else if (m === 0xed) info.hasIptc = true;
      else if (m === 0xfe) info.hasComment = true;
      else if (m === 0xe2 && txt(body, body + 12).startsWith('ICC_PROFILE')) info.hasIcc = true;
      p += 2 + len;
    }
  } else if (b[0] === 0x89 && b[1] === 0x50) {
    info.format = 'png';
    let p = 8;
    while (p + 12 <= b.length) {
      const len = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0, type = txt(p + 4, p + 8);
      if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
        const k = txt(p + 8, p + 8 + Math.min(len, 60)).split('\0')[0];
        if (/XML:com.adobe.xmp/.test(k)) info.hasXmp = true; else { info.hasComment = true; const v = String.fromCharCode(...b.subarray(p + 8 + k.length + 1, p + 8 + Math.min(len, 200))).replace(/\0/g, ''); if (type === 'tEXt') info.fields.push([k, v]); }
      }
      if (type === 'eXIf') { info.hasExif = true; try { readTiff(b, p + 8, info); } catch { /* */ } }
      if (type === 'iCCP') info.hasIcc = true;
      if (type === 'tIME') info.fields.push(['Last modified', `${(b[p + 8] << 8) | b[p + 9]}-${b[p + 10]}-${b[p + 11]}`]);
      if (type === 'IEND') break;
      p += 12 + len;
    }
  } else if (txt(0, 4) === 'RIFF' && txt(8, 12) === 'WEBP') {
    info.format = 'webp';
    let p = 12;
    while (p + 8 <= b.length) {
      const type = txt(p, p + 4), len = (b[p + 4] | b[p + 5] << 8 | b[p + 6] << 16 | b[p + 7] << 24) >>> 0;
      if (type === 'EXIF') { info.hasExif = true; try { const s = txt(p + 8, p + 14).startsWith('Exif') ? p + 14 : p + 8; readTiff(b, s, info); } catch { /* */ } }
      if (type === 'XMP ') info.hasXmp = true;
      if (type === 'ICCP') info.hasIcc = true;
      p += 8 + len + (len & 1);
    }
  }
  return info;
}

/** Minimal APP1 with only the orientation tag. */
function orientationApp1(o: number): number[] {
  const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = body.length + 2;
  return [0xff, 0xe1, len >> 8, len & 255, ...body];
}

/** Remove metadata. keepIcc keeps the colour profile (recommended: colours stay the same). */
export function stripMeta(b: Uint8Array, keepIcc: boolean): Uint8Array {
  const info = readMeta(b);
  const out: number[] = [];
  const push = (s: number, e: number) => { for (let i = s; i < e; i++) out.push(b[i]); };
  if (info.format === 'jpeg') {
    out.push(0xff, 0xd8);
    let p = 2, wroteOrientation = false;
    while (p + 4 <= b.length && b[p] === 0xff) {
      const m = b[p + 1];
      if (m === 0xda) { push(p, b.length); break; }
      const len = (b[p + 2] << 8) | b[p + 3];
      const drop = m === 0xe1 || m === 0xed || m === 0xfe || (m >= 0xe3 && m <= 0xec) || (m === 0xe2 && !keepIcc);
      // after JFIF (APP0), before everything else: our orientation-only EXIF
      if (!wroteOrientation && info.orientation > 1 && m !== 0xe0) { out.push(...orientationApp1(info.orientation)); wroteOrientation = true; }
      if (!drop) push(p, p + 2 + len);
      p += 2 + len;
    }
    return Uint8Array.from(out);
  }
  if (info.format === 'png') {
    push(0, 8);
    let p = 8;
    while (p + 12 <= b.length) {
      const len = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0;
      const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      const drop = ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(type) || (type === 'iCCP' && !keepIcc);
      if (!drop) push(p, p + 12 + len);
      if (type === 'IEND') break;
      p += 12 + len;
    }
    return Uint8Array.from(out);
  }
  if (info.format === 'webp') {
    const chunks: number[][] = [];
    let p = 12;
    while (p + 8 <= b.length) {
      const type = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
      const len = (b[p + 4] | b[p + 5] << 8 | b[p + 6] << 16 | b[p + 7] << 24) >>> 0;
      const end = p + 8 + len + (len & 1);
      if (!(type === 'EXIF' || type === 'XMP ' || (type === 'ICCP' && !keepIcc))) {
        const c = Array.from(b.subarray(p, end));
        if (type === 'VP8X') { c[8] &= ~(0x08 | 0x04 | (keepIcc ? 0 : 0x20)); }
        chunks.push(c);
      }
      p = end;
    }
    const body = chunks.flat();
    const size = body.length + 4;
    return Uint8Array.from([0x52, 0x49, 0x46, 0x46, size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >> 24) & 255, 0x57, 0x45, 0x42, 0x50, ...body]);
  }
  return b;
}
