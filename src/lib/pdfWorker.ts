import { createRpc, type RpcClient } from './workers/rpc';
import type * as Ops from './pdfOps';

let client: RpcClient | null = null;
/** Lazily spawns the shared pdf-lib worker (code is only downloaded on first use). */
function rpc(): RpcClient {
  if (!client) client = createRpc(new Worker(new URL('./workers/pdf.worker.ts', import.meta.url), { type: 'module' }));
  return client;
}
export function resetPdfWorker() { client?.terminate(); client = null; }

type OpName = keyof typeof Ops;
type Result<K extends OpName> = Awaited<ReturnType<(typeof Ops)[K]>>;

/** Run a pdf-lib op in the worker. ArrayBuffers in `transfer` are moved, not copied. */
export async function pdfOp<K extends OpName>(op: K, args: Parameters<(typeof Ops)[K]>, transfer: Transferable[] = []): Promise<Result<K>> {
  const r = await rpc().call<{ result: Result<K> }>({ op, args }, transfer);
  return r.result;
}
