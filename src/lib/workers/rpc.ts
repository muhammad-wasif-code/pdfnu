/** Minimal promise-based RPC over a Worker. */
export interface RpcClient {
  call<T = unknown>(msg: Record<string, unknown>, transfer?: Transferable[]): Promise<T>;
  terminate(): void;
}

export function createRpc(worker: Worker): RpcClient {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  worker.onmessage = (e: MessageEvent) => {
    const { id, ok, error, ...rest } = e.data ?? {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(rest); else p.reject(Object.assign(new Error(error || 'Worker error'), { name: e.data?.errorName || 'Error' }));
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Worker crashed (possibly out of memory)');
    pending.forEach((p) => p.reject(err));
    pending.clear();
  };
  return {
    call(msg, transfer = []) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ ...msg, id }, transfer);
      });
    },
    terminate() {
      worker.terminate();
      pending.forEach((p) => p.reject(new Error('cancelled')));
      pending.clear();
    },
  };
}
