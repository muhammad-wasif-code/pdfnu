/** Bundle files into a .zip (jszip is lazy-loaded). PDFs/JPEGs are already compressed → STORE is fastest. */
export async function makeZip(files: { name: string; data: Uint8Array | Blob }[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name, n = 2;
    while (used.has(name)) name = f.name.replace(/(\.[^.]+)?$/, ` (${n++})$1`);
    used.add(name);
    zip.file(name, f.data, { binary: true });
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' });
}
