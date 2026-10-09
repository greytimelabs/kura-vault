// The only place keys exist in the browser: the account's private keys, every
// open vault and album key, and unwrapped media keys, all inside one Keyring.
// The page can only ask this worker to use them, through the methods listed in
// protocol.ts. Locking terminates the worker, which destroys every key at once.
import { Keyring } from './keyring';
import { CRYPTO_METHODS, type CryptoRequest, type CryptoResponse } from './protocol';

const keyring = new Keyring();
const allowed = new Set<string>(CRYPTO_METHODS);

/** ArrayBuffers in a result are moved, not copied, back to the page. */
function collectBuffers(value: unknown, out: ArrayBuffer[] = [], depth = 0): ArrayBuffer[] {
  if (value instanceof ArrayBuffer) out.push(value);
  else if (value && typeof value === 'object' && depth < 3) {
    for (const child of Object.values(value)) collectBuffers(child, out, depth + 1);
  }
  return out;
}

const scope = self as unknown as {
  postMessage(message: CryptoResponse, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<CryptoRequest>) => void): void;
};

scope.addEventListener('message', (event) => {
  const { id, method, args } = event.data;
  const fail = (err: unknown) =>
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : 'Crypto failure' }, []);
  // Anything else on the keyring (its internal helpers return key objects) is unreachable from the page
  if (!allowed.has(method)) {
    fail(new Error('Unknown request'));
    return;
  }
  const call = keyring[method] as (this: Keyring, args: unknown) => unknown;
  Promise.resolve()
    .then(() => call.call(keyring, args))
    .then((result) => scope.postMessage({ id, ok: true, result }, collectBuffers(result)), fail);
});
