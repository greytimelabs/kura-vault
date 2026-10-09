import type { CryptoArgs, CryptoMethod, CryptoRequest, CryptoResponse, CryptoResult } from './protocol';

/** Rejection for anything still waiting on the worker when the keys are destroyed. */
export class VaultLockedError extends Error {
  constructor() {
    super('Locked');
    this.name = 'VaultLockedError';
  }
}

interface Pending {
  resolve(value: unknown): void;
  reject(reason: Error): void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./crypto.worker.ts', import.meta.url), { type: 'module', name: 'mv-crypto' });
    worker.addEventListener('message', (event: MessageEvent<CryptoResponse>) => {
      const message = event.data;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error));
    });
  }
  return worker;
}

/** Call the key-holding worker. Buffers listed in `transfer` are moved to it, not copied. */
export function cryptoCall<M extends CryptoMethod>(
  method: M,
  ...rest: CryptoArgs<M> extends [infer A] ? [args: A, transfer?: Transferable[]] : []
): Promise<CryptoResult<M>> {
  const [args, transfer = []] = rest as [unknown?, Transferable[]?];
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    const message: CryptoRequest = { id, method, args };
    getWorker().postMessage(message, transfer);
  });
}

/**
 * Destroy every key. Terminating the worker is the strongest wipe available in a
 * browser: nothing can be asked of the keys afterwards, not even by injected code.
 */
export function destroyKeys(): void {
  worker?.terminate();
  worker = null;
  const error = new VaultLockedError();
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}
