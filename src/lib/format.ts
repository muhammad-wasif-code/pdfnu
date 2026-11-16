export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}
export const KB = 1024;
export const MB = 1024 * 1024;

export function percentSaved(before: number, after: number): number {
  if (before <= 0 || after >= before) return 0;
  return Math.min(99, Math.max(1, Math.floor((1 - after / before) * 100)));
}

/** "report.final.pdf" → "report.final" */
export function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
