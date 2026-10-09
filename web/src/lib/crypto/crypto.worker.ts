// The only place vault keys exist. The KEK is a non-extractable CryptoKey, so even
// code running on the page cannot read its bytes; it can only ask this worker to
// use it. Locking terminates the worker, which destroys every key at once.
import { IV_LENGTH, gcmDecrypt, gcmEncrypt, randomBytes } from './aesgcm';
import { b64decode, b64encode } from './base64';
import type { CryptoApi, CryptoMethod, CryptoRequest, CryptoResponse, EncryptedTier, VaultMatch } from './protocol';
import {
  createVaultMaterial,
  decryptText,
  deriveKek,
  encryptText,
  generateWrappedDek,
  unwrapDek,
  verifyKek,
} from './vaultCrypto';

const DEK_CACHE_SIZE = 400;

let activeKek: CryptoKey | null = null;
/** KEKs that verified for the entered passphrase but are not committed yet. */
const candidates = new Map<string, CryptoKey>();
/** Unwrapped DEKs, so a photo's thumbnail and preview do not unwrap twice. */
const dekCache = new Map<string, CryptoKey>();

function requireKek(): CryptoKey {
  if (!activeKek) throw new Error('Vault is locked');
  return activeKek;
}

async function getDek(encryptedDek: string, dekNonce: string): Promise<CryptoKey> {
  const cached = dekCache.get(encryptedDek);
  if (cached) {
    dekCache.delete(encryptedDek);
    dekCache.set(encryptedDek, cached);
    return cached;
  }
  const dek = await unwrapDek(requireKek(), encryptedDek, dekNonce);
  dekCache.set(encryptedDek, dek);
  if (dekCache.size > DEK_CACHE_SIZE) {
    dekCache.delete(dekCache.keys().next().value!);
  }
  return dek;
}

async function encryptTier(dek: CryptoKey, data: ArrayBuffer): Promise<EncryptedTier> {
  const iv = randomBytes(IV_LENGTH);
  const encrypted = await gcmEncrypt(dek, iv, data);
  return { data: encrypted.buffer, iv: b64encode(iv) };
}

type Handlers = { [M in CryptoMethod]: (args: Parameters<CryptoApi[M]>[0]) => Promise<ReturnType<CryptoApi[M]>> };

const handlers: Handlers = {
  /**
   * Try the passphrase against EVERY vault. Each vault has its own salt, so one
   * passphrase can legitimately open more than one. There is no early exit: the
   * time taken must not reveal which vault matched, or how many did.
   */
  async findMatches({ passphrase, vaults }) {
    candidates.clear();
    const matches: VaultMatch[] = [];
    for (const vault of vaults) {
      let kek: CryptoKey;
      try {
        kek = await deriveKek(passphrase, vault.kekSalt);
      } catch {
        continue; // malformed salt: this vault can never match
      }
      if (await verifyKek(kek, vault)) {
        const label = (await decryptText(kek, vault.labelEncrypted, vault.labelNonce))?.trim();
        candidates.set(vault.id, kek);
        matches.push({ vaultId: vault.id, label: label || `Vault ${matches.length + 1}` });
      }
    }
    return matches;
  },

  async selectVault({ vaultId }) {
    const kek = candidates.get(vaultId);
    if (!kek) throw new Error('Unknown vault');
    activeKek = kek;
    candidates.clear();
    dekCache.clear();
  },

  async discardMatches() {
    candidates.clear();
  },

  /** The new vault's key stays here as a candidate so the caller can open it straight away. */
  async createVault({ passphrase, label }) {
    const { kek, ...info } = await createVaultMaterial(passphrase, label);
    candidates.set(info.id, kek);
    return info;
  },

  async decryptBlob({ encryptedDek, dekNonce, iv, data }) {
    const dek = await getDek(encryptedDek, dekNonce);
    return (await gcmDecrypt(dek, b64decode(iv), data)).buffer;
  },

  async decryptText({ encrypted, nonce }) {
    return decryptText(requireKek(), encrypted, nonce);
  },

  async decryptTexts({ items }) {
    const kek = requireKek();
    return Promise.all(items.map((item) => decryptText(kek, item.encrypted, item.nonce)));
  },

  async encryptText({ text }) {
    return encryptText(requireKek(), text);
  },

  /** One fresh DEK per file; the three tiers share it, each with its own IV. */
  async encryptMedia({ thumb, preview, original, meta }) {
    const kek = requireKek();
    const dek = await generateWrappedDek(kek);
    const [encThumb, encPreview, encOriginal, encMeta] = await Promise.all([
      encryptTier(dek.key, thumb),
      encryptTier(dek.key, preview),
      encryptTier(dek.key, original),
      encryptText(kek, JSON.stringify(meta)),
    ]);
    return {
      encryptedDek: dek.encryptedDek,
      dekNonce: dek.dekNonce,
      thumb: encThumb,
      preview: encPreview,
      original: encOriginal,
      encryptedMeta: encMeta.encrypted,
      metaNonce: encMeta.nonce,
    };
  },
};

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
  const handler = handlers[method] as (args: unknown) => Promise<unknown>;
  handler(args).then(
    (result) => scope.postMessage({ id, ok: true, result }, collectBuffers(result)),
    (err: unknown) =>
      scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : 'Crypto failure' }, []),
  );
});
