import { GS_BASE } from './vendor';
import { createRpc, type RpcClient } from './workers/rpc';

let client: RpcClient | null = null;
function gs(): RpcClient {
  if (!client) client = createRpc(new Worker(GS_BASE + 'gs-worker.js'));
  return client;
}

/** Start downloading + compiling the 16 MB Ghostscript WASM in the background. */
export function warmupGhostscript(): Promise<unknown> {
  return gs().call({ type: 'warmup' }).catch(() => undefined);
}

export interface GsProfile {
  /** target image resolution (dpi) */
  res: number;
  /** JPEG QFactor (lower = better quality). 0.15 ≈ max, 0.4 high, 0.76 medium, 1.3 low */
  q: number;
  /** let Ghostscript choose JPEG vs lossless per image (better for screenshots/line art) */
  autoFilter?: boolean;
}

export function gsArgs({ res, q, autoFilter }: GsProfile): string[] {
  const dict = `<< /QFactor ${q} /Blend 1 /HSamples [2 1 1 2] /VSamples [2 1 1 2] >>`;
  return [
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER', '-dAutoRotatePages=/None',
    '-dDetectDuplicateImages=true', '-dCompressFonts=true', '-dSubsetFonts=true', '-dEmbedAllFonts=true',
    '-dDownsampleColorImages=true', '-dDownsampleGrayImages=true', '-dDownsampleMonoImages=true',
    '-dColorImageDownsampleType=/Bicubic', '-dGrayImageDownsampleType=/Bicubic', '-dMonoImageDownsampleType=/Subsample',
    `-dColorImageResolution=${res}`, `-dGrayImageResolution=${res}`, `-dMonoImageResolution=${Math.max(300, res * 2)}`,
    '-dColorImageDownsampleThreshold=1.0', '-dGrayImageDownsampleThreshold=1.0', '-dMonoImageDownsampleThreshold=1.0',
    ...(autoFilter ? [] : ['-dAutoFilterColorImages=false', '-dAutoFilterGrayImages=false', '-dColorImageFilter=/DCTEncode', '-dGrayImageFilter=/DCTEncode']),
    '-sOutputFile=/out.pdf',
    '-c', `<< /ColorImageDict ${dict} /GrayImageDict ${dict} /ColorACSImageDict ${dict} /GrayACSImageDict ${dict} >> setdistillerparams`,
    '-f', '/in.pdf',
  ];
}

export async function runGhostscript(input: Uint8Array, profile: GsProfile): Promise<Uint8Array> {
  return runGhostscriptArgs(input, gsArgs(profile));
}

/** Raw run; args must write to /out.pdf and read /in.pdf. */
export async function runGhostscriptArgs(input: Uint8Array, args: string[]): Promise<Uint8Array> {
  const copy = input.slice().buffer;
  const res = await gs().call<{ output: ArrayBuffer }>({ input: copy, args }, [copy]);
  return new Uint8Array(res.output);
}

/** Re-write the PDF with standard 128-bit encryption (PDF security handler rev. 3). Images are passed through untouched. */
export function encryptArgs(userPassword: string, ownerPassword: string): string[] {
  return [
    '-sDEVICE=pdfwrite', '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER', '-dAutoRotatePages=/None', '-dPDFSETTINGS=/default',
    '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false', '-dPassThroughJPEGImages=true',
    '-dAutoFilterColorImages=false', '-dAutoFilterGrayImages=false', '-dColorImageFilter=/FlateEncode', '-dGrayImageFilter=/FlateEncode',
    `-sOwnerPassword=${ownerPassword}`, `-sUserPassword=${userPassword}`, '-dEncryptionR=3', '-dKeyLength=128', '-dPermissions=-4',
    '-sOutputFile=/out.pdf', '/in.pdf',
  ];
}

export function resetGhostscript() { client?.terminate(); client = null; }

/** Convert every page to grayscale (text stays vector and selectable). */
export function grayscaleArgs(): string[] {
  return [
    '-sDEVICE=pdfwrite', '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER', '-dAutoRotatePages=/None',
    '-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray',
    '-sOutputFile=/out.pdf', '/in.pdf',
  ];
}

/** Decrypt a PDF with the password that opens it (the user must already know it). */
export function decryptArgs(password: string): string[] {
  return [
    '-sDEVICE=pdfwrite', '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER', '-dAutoRotatePages=/None', '-dPDFSETTINGS=/default',
    '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false', '-dPassThroughJPEGImages=true',
    '-dAutoFilterColorImages=false', '-dAutoFilterGrayImages=false', '-dColorImageFilter=/FlateEncode', '-dGrayImageFilter=/FlateEncode',
    `-sPDFPassword=${password}`,
    '-sOutputFile=/out.pdf', '/in.pdf',
  ];
}

/** Re-write a damaged PDF; Ghostscript reconstructs broken cross-reference tables while reading. */
export function repairArgs(): string[] {
  return [
    '-sDEVICE=pdfwrite', '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER', '-dAutoRotatePages=/None', '-dPDFSETTINGS=/default',
    '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false', '-dPassThroughJPEGImages=true',
    '-sOutputFile=/out.pdf', '/in.pdf',
  ];
}

/**
 * PDF/A-2b for archiving: embeds fonts, adds an sRGB output intent and XMP metadata.
 * The ICC profile comes from Ghostscript's built-in ROM file system.
 */
export function pdfaArgs(): string[] {
  const def = [
    '/ICCProfile (%rom%iccprofiles/srgb.icc) def',
    '[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark',
    '[{icc_PDFA} <</N 3>> /PUT pdfmark',
    '[{icc_PDFA} ICCProfile (r) file /PUT pdfmark',
    '[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark',
    '[{OutputIntent_PDFA} <</Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc_PDFA} /OutputConditionIdentifier (sRGB)>> /PUT pdfmark',
    '[{Catalog} <</OutputIntents [ {OutputIntent_PDFA} ]>> /PUT pdfmark',
  ].join('\n');
  return [
    '-dPDFA=2', '-dPDFACompatibilityPolicy=1', '-sDEVICE=pdfwrite', '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER', '-dNOOUTERSAVE', '-dAutoRotatePages=/None',
    '-sColorConversionStrategy=RGB', '-sProcessColorModel=DeviceRGB',
    '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false',
    '-sOutputFile=/out.pdf', '-c', def, '-f', '/in.pdf',
  ];
}
