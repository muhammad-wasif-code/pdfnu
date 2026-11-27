/**
 * Lossless PDF decryption (standard security handler, revisions 2–6).
 *
 * Used for PDFs that open without a password but carry owner restrictions (no editing, no printing…),
 * and for files whose open password the user typed. Every object is decrypted while pdf-lib parses
 * the file, so form fields, bookmarks, links and structure survive untouched.
 *
 * RC4 + MD5 are implemented here; AES and SHA-2 come from WebCrypto (works in workers too).
 */
import {
  CharCodes, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObjectStreamParser,
  PDFParser, PDFRawStream, PDFRef, PDFString, PDFXRefStreamParser, PDFBool, type PDFContext, type PDFObject,
} from 'pdf-lib';

export class PdfPasswordError extends Error { name = 'PdfPasswordError'; }
export class PdfCryptUnsupported extends Error { name = 'PdfCryptUnsupported'; }

/* ---------------- MD5 ---------------- */
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const T = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
export function md5(data: Uint8Array): Uint8Array {
  const len = data.length;
  const total = ((len + 8) >> 6) * 64 + 64;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bits >>> 0, true);
  dv.setUint32(total - 4, Math.floor(bits / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const tmp = d; d = c; c = b;
      const x = (a + f + T[i] + M[g]) >>> 0;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
  return out;
}

/* ---------------- RC4 ---------------- */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

/* ---------------- WebCrypto helpers ---------------- */
const subtle = () => globalThis.crypto.subtle;
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const B = (d: Uint8Array) => d as unknown as BufferSource;
const sha = async (alg: 'SHA-256' | 'SHA-384' | 'SHA-512', d: Uint8Array) => new Uint8Array(await subtle().digest(alg, B(d)));
const aesKey = (k: Uint8Array) => subtle().importKey('raw', B(k), 'AES-CBC', false, ['encrypt', 'decrypt']);

/** AES-CBC encrypt without padding (input length must be a multiple of 16). */
async function aesEncryptRaw(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: B(iv) }, key, B(data)));
  return out.subarray(0, data.length);
}

/**
 * AES-CBC decrypt that never fails on bad padding: we append one block that decrypts to a full
 * padding block, so WebCrypto strips only that and returns the raw plaintext.
 */
async function aesDecryptRaw(key: CryptoKey, iv: Uint8Array, ct: Uint8Array): Promise<Uint8Array> {
  if (!ct.length) return ct;
  const last = ct.subarray(ct.length - 16);
  const extra = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: B(last) }, key, new Uint8Array(0))).subarray(0, 16);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: B(iv) }, key, B(cat(ct, extra))));
}

/** Decrypt AES data laid out as IV + ciphertext, removing PKCS#7 padding when present. */
async function aesDecrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  if (data.length < 32) return new Uint8Array(0);
  const iv = data.subarray(0, 16);
  const ct = data.subarray(16, 16 + Math.floor((data.length - 16) / 16) * 16);
  const raw = await aesDecryptRaw(key, iv, ct);
  const p = raw[raw.length - 1];
  if (p >= 1 && p <= 16 && raw.length >= p && raw.subarray(raw.length - p).every((x) => x === p)) return raw.subarray(0, raw.length - p);
  return raw;
}

/* ---------------- Key derivation ---------------- */
const PAD = Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
const pad32 = (pw: Uint8Array) => cat(pw.subarray(0, 32), PAD).subarray(0, 32);
/** Passwords for revisions 2–4 are PDFDocEncoding; Latin-1 covers what people type. */
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => { const n = c.charCodeAt(0); return n < 256 ? n : 0x3f; }));
const xorKey = (k: Uint8Array, i: number) => k.map((b) => b ^ i);

interface Enc { R: number; V: number; O: Uint8Array; U: Uint8Array; OE?: Uint8Array; UE?: Uint8Array; P: number; n: number; encMeta: boolean; id0: Uint8Array; }

function key24(pw: Uint8Array, e: Enc): Uint8Array {
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, e.P, true);
  let h = md5(cat(pad32(pw), e.O.subarray(0, 32), p, e.id0, e.R >= 4 && !e.encMeta ? Uint8Array.from([255, 255, 255, 255]) : new Uint8Array(0)));
  if (e.R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, e.n));
  return h.slice(0, e.n);
}

function userOk24(key: Uint8Array, e: Enc): boolean {
  if (e.R === 2) return eq(rc4(key, PAD), e.U.subarray(0, 32));
  let x = rc4(key, md5(cat(PAD, e.id0)));
  for (let i = 1; i <= 19; i++) x = rc4(xorKey(key, i), x);
  return eq(x, e.U.subarray(0, 16));
}

/** Algorithm 7: recover the user password from the owner password, then derive the key. */
function ownerKey24(pw: Uint8Array, e: Enc): Uint8Array | null {
  let h = md5(pad32(pw));
  if (e.R >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  const k = h.subarray(0, e.n);
  let user: Uint8Array;
  if (e.R === 2) user = rc4(k, e.O.subarray(0, 32));
  else { user = e.O.subarray(0, 32); for (let i = 19; i >= 0; i--) user = rc4(xorKey(k, i), user); }
  const key = key24(user, e);
  return userOk24(key, e) ? key : null;
}

/** Algorithm 2.B (revision 6) — or plain SHA-256 for revision 5. */
async function hash56(pw: Uint8Array, salt: Uint8Array, udata: Uint8Array, R: number): Promise<Uint8Array> {
  let K = await sha('SHA-256', cat(pw, salt, udata));
  if (R === 5) return K;
  for (let round = 0; ; round++) {
    const one = cat(pw, K, udata);
    const K1 = new Uint8Array(one.length * 64);
    for (let i = 0; i < 64; i++) K1.set(one, i * one.length);
    const E = await aesEncryptRaw(await aesKey(K.subarray(0, 16)), K.subarray(16, 32), K1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += E[i];
    K = await sha((['SHA-256', 'SHA-384', 'SHA-512'] as const)[sum % 3], E);
    if (round >= 63 && E[E.length - 1] <= round - 32) break;
  }
  return K.subarray(0, 32);
}

async function key56(pwText: string, e: Enc): Promise<Uint8Array | null> {
  const pw = new TextEncoder().encode(pwText.normalize('NFKC')).subarray(0, 127);
  const U = e.U, O = e.O;
  const zero = new Uint8Array(16);
  if (eq(await hash56(pw, U.subarray(32, 40), new Uint8Array(0), e.R), U.subarray(0, 32))) {
    const ik = await hash56(pw, U.subarray(40, 48), new Uint8Array(0), e.R);
    return aesDecryptRaw(await aesKey(ik), zero, e.UE!.subarray(0, 32));
  }
  const u48 = U.subarray(0, 48);
  if (eq(await hash56(pw, O.subarray(32, 40), u48, e.R), O.subarray(0, 32))) {
    const ik = await hash56(pw, O.subarray(40, 48), u48, e.R);
    return aesDecryptRaw(await aesKey(ik), zero, e.OE!.subarray(0, 32));
  }
  return null;
}

/* ---------------- Parsing ---------------- */
const ENDOBJ = [CharCodes.e, CharCodes.n, CharCodes.d, CharCodes.o, CharCodes.b, CharCodes.j];
const OBJSTM = PDFName.of('ObjStm'), XREF = PDFName.of('XRef'), TYPE = PDFName.of('Type');

type Hook = (ref: PDFRef, obj: PDFObject) => Promise<PDFObject | 'objstm' | 'skip'>;

/** pdf-lib's parser, with each indirect object passed through `hook` before it is stored. */
class HookedParser extends (PDFParser as any) {
  constructor(bytes: Uint8Array, private hook: Hook) { super(bytes, Infinity, false, false); }
  async parseIndirectObject() {
    const self = this as any;
    const ref: PDFRef = self.parseIndirectObjectHeader();
    self.skipWhitespaceAndComments();
    const object: PDFObject = self.parseObject();
    self.skipWhitespaceAndComments();
    self.matchKeyword(ENDOBJ);
    if (object instanceof PDFRawStream && object.dict.lookup(TYPE) === XREF) {
      PDFXRefStreamParser.forStream(object).parseIntoContext();
      return ref;
    }
    const out = await this.hook(ref, object);
    if (out === 'skip') return ref;
    if (out instanceof PDFRawStream && out.dict.lookup(TYPE) === OBJSTM) {
      await PDFObjectStreamParser.forStream(out).parseIntoContext();
      return ref;
    }
    self.context.assign(ref, out);
    return ref;
  }
}

const parse = (bytes: Uint8Array, hook: Hook): Promise<PDFContext> => (new HookedParser(bytes, hook) as any).parseDocument();

const bytesOf = (o: PDFObject | undefined): Uint8Array =>
  o instanceof PDFString || o instanceof PDFHexString ? o.asBytes() : new Uint8Array(0);

const hex = (b: Uint8Array) => { let s = ''; for (const x of b) s += x.toString(16).padStart(2, '0'); return s; };

/**
 * Remove encryption. `password` may be the user (open) password or the owner password;
 * an empty password works for files that open without one.
 */
export async function decryptPdf(input: Uint8Array, password = ''): Promise<Uint8Array> {
  // Pass 1: read the trailer and the encryption dictionary (object streams are skipped: they are encrypted).
  let encRef: PDFRef | undefined;
  const ctx1 = await parse(input, async (_ref, obj) => (obj instanceof PDFRawStream && obj.dict.lookup(TYPE) === OBJSTM ? 'skip' : obj));
  const encObj = ctx1.trailerInfo.Encrypt;
  if (encObj instanceof PDFRef) encRef = encObj;
  const dict = ctx1.lookup(encObj);
  if (!(dict instanceof PDFDict)) throw new PdfCryptUnsupported('Not encrypted');
  const num = (k: string, d = 0) => { const v = dict.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : d; };
  if (dict.lookup(PDFName.of('Filter')) !== PDFName.of('Standard')) throw new PdfCryptUnsupported('Custom security handler');
  const V = num('V'), R = num('R');
  if (R < 2 || R > 6) throw new PdfCryptUnsupported(`R${R}`);
  const idArr = ctx1.lookup(ctx1.trailerInfo.ID);
  const id0 = idArr instanceof PDFArray ? bytesOf(idArr.lookup(0)) : new Uint8Array(0);
  const em = dict.lookup(PDFName.of('EncryptMetadata'));
  const e: Enc = {
    R, V, P: num('P') | 0, id0,
    O: bytesOf(dict.lookup(PDFName.of('O'))), U: bytesOf(dict.lookup(PDFName.of('U'))),
    OE: bytesOf(dict.lookup(PDFName.of('OE'))), UE: bytesOf(dict.lookup(PDFName.of('UE'))),
    n: R === 2 ? 5 : Math.max(5, Math.min(16, num('Length', 40) / 8)),
    encMeta: !(em instanceof PDFBool && !em.asBoolean()),
  };

  // Crypt filters: which method strings and streams use.
  type Method = 'none' | 'rc4' | 'aes128' | 'aes256';
  const methodOf = (cfName: PDFObject | undefined): Method => {
    if (V < 4) return 'rc4';
    if (!(cfName instanceof PDFName) || cfName.asString() === '/Identity') return 'none';
    const cf = dict.lookup(PDFName.of('CF'));
    const f = cf instanceof PDFDict ? cf.lookup(cfName) : undefined;
    const cfm = f instanceof PDFDict ? f.lookup(PDFName.of('CFM')) : undefined;
    const m = cfm instanceof PDFName ? cfm.asString() : '/None';
    if (m === '/V2') return 'rc4';
    if (m === '/AESV2') return 'aes128';
    if (m === '/AESV3') return 'aes256';
    if (m === '/None') return 'none';
    throw new PdfCryptUnsupported(`CFM ${m}`);
  };
  const strM = methodOf(dict.lookup(PDFName.of('StrF')));
  const stmM = methodOf(dict.lookup(PDFName.of('StmF')));

  // File key from the password (user first, then owner).
  let fileKey: Uint8Array | null;
  if (R >= 5) fileKey = await key56(password, e);
  else {
    const pw = latin1(password);
    const k = key24(pw, e);
    fileKey = userOk24(k, e) ? k : ownerKey24(pw, e);
  }
  if (!fileKey) throw new PdfPasswordError('Wrong password');

  const keyCache = new Map<string, Promise<CryptoKey>>();
  const objKey = (ref: PDFRef, aes: boolean): Uint8Array => {
    const k = cat(fileKey!, Uint8Array.from([ref.objectNumber & 255, (ref.objectNumber >> 8) & 255, (ref.objectNumber >> 16) & 255, ref.generationNumber & 255, (ref.generationNumber >> 8) & 255]), aes ? Uint8Array.from([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0));
    return md5(k).subarray(0, Math.min(fileKey!.length + 5, 16));
  };
  const dec = async (ref: PDFRef, data: Uint8Array, m: Method): Promise<Uint8Array> => {
    if (m === 'none') return data;
    if (m === 'rc4') return rc4(objKey(ref, false), data);
    const raw = m === 'aes256' ? fileKey! : objKey(ref, true);
    const id = hex(raw);
    if (!keyCache.has(id)) keyCache.set(id, aesKey(raw));
    return aesDecrypt(await keyCache.get(id)!, data);
  };

  const walk = async (ref: PDFRef, o: PDFObject): Promise<PDFObject> => {
    if (o instanceof PDFString || o instanceof PDFHexString) return PDFHexString.of(hex(await dec(ref, o.asBytes(), strM)));
    if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) o.set(i, await walk(ref, o.get(i)));
      return o;
    }
    if (o instanceof PDFDict) {
      // Signature values are stored in the clear.
      const sig = o.lookup(TYPE) === PDFName.of('Sig') || o.has(PDFName.of('ByteRange'));
      for (const [k, v] of o.entries()) {
        if (sig && k === PDFName.of('Contents')) continue;
        o.set(k, await walk(ref, v));
      }
      return o;
    }
    return o;
  };

  // Pass 2: parse again, decrypting every object as it is read.
  const ctx = await parse(input, async (ref, obj) => {
    if (encRef && ref === encRef) return 'skip';
    if (obj instanceof PDFRawStream) {
      await walk(ref, obj.dict);
      const t = obj.dict.lookup(TYPE);
      const filter = obj.dict.lookup(PDFName.of('Filter'));
      const hasCryptFilter = filter === PDFName.of('Crypt') || (filter instanceof PDFArray && filter.lookup(0) === PDFName.of('Crypt'));
      const skip = hasCryptFilter || (t === PDFName.of('Metadata') && !e.encMeta);
      const contents = skip ? obj.contents : await dec(ref, obj.contents, stmM);
      return PDFRawStream.of(obj.dict, contents);
    }
    return walk(ref, obj);
  });

  // Drop the encryption, and Adobe "Reader extensions" (their signature is void once the file changes).
  ctx.trailerInfo.Encrypt = undefined;
  if (encRef) ctx.delete(encRef);
  const doc: PDFDocument = new (PDFDocument as any)(ctx, false, false);
  doc.catalog.delete(PDFName.of('Perms'));
  return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}
