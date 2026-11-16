/// <reference lib="webworker" />
/* pdf-lib operations, off the main thread. Message: { id, op, args } → { id, ok, result } */
import * as ops from '../pdfOps';

const toTransfer = (v: unknown): Transferable[] => {
  if (v instanceof Uint8Array) return [v.buffer];
  if (Array.isArray(v)) return v.flatMap(toTransfer);
  return [];
};

self.onmessage = async (e: MessageEvent<{ id: number; op: keyof typeof ops; args: unknown[] }>) => {
  const { id, op, args } = e.data;
  try {
    const fn = ops[op] as (...a: unknown[]) => Promise<unknown>;
    if (typeof fn !== 'function') throw new Error(`Unknown op ${op}`);
    const result = await fn(...args);
    (self as unknown as Worker).postMessage({ id, ok: true, result }, toTransfer(result));
  } catch (err: any) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err?.message ?? err), errorName: err?.name });
  }
};
