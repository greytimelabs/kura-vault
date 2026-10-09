import type { MediaItem } from '../api/types';
import { cryptoCall } from '../crypto/cryptoClient';
import { TaskQueue, fetchEncrypted } from './blobFetch';
import { getThumbCiphertext, hasThumbCiphertext, putThumbCiphertext, removeThumbCiphertext } from './thumbStore';

// Decrypted thumbnails exist only as in-memory object URLs, capped and revoked on
// eviction. They are all revoked when the vault locks.
const MAX_URLS = 2500;
const urls = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
const visibleQueue = new TaskQueue(8);
const prefetchQueue = new TaskQueue(4);
const prefetching = new Set<string>();

function remember(id: string, url: string): void {
  urls.set(id, url);
  if (urls.size > MAX_URLS) {
    const oldest = urls.keys().next().value!;
    URL.revokeObjectURL(urls.get(oldest)!);
    urls.delete(oldest);
  }
}

/** Already-decrypted thumbnail, if there is one. Marks it recently used. */
export function peekThumbUrl(id: string): string | undefined {
  const url = urls.get(id);
  if (url) {
    urls.delete(id);
    urls.set(id, url);
  }
  return url;
}

async function decryptToUrl(item: MediaItem, ciphertext: ArrayBuffer): Promise<string> {
  // Not transferred: the same bytes may still be on their way into the disk cache
  const plain = await cryptoCall('decryptBlob', {
    encryptedDek: item.encryptedDek,
    dekNonce: item.dekNonce,
    iv: item.thumbIv,
    data: ciphertext,
  });
  return URL.createObjectURL(new Blob([plain], { type: 'image/jpeg' }));
}

async function load(item: MediaItem): Promise<string> {
  let ciphertext = await getThumbCiphertext(item.id);
  let fromCache = ciphertext !== null;
  if (!ciphertext) {
    ciphertext = await visibleQueue.run(() => fetchEncrypted(item.thumbUrl));
    void putThumbCiphertext(item.id, ciphertext);
  }

  try {
    return await decryptToUrl(item, ciphertext);
  } catch (err) {
    if (!fromCache) throw err;
    // A damaged cache entry: drop it and fall back to the network once
    await removeThumbCiphertext(item.id);
    fromCache = false;
    const fresh = await visibleQueue.run(() => fetchEncrypted(item.thumbUrl));
    void putThumbCiphertext(item.id, fresh);
    return decryptToUrl(item, fresh);
  }
}

/** Object URL for a decrypted thumbnail. Rejects with ExpiredUrlError when the link needs renewing. */
export function loadThumbUrl(item: MediaItem): Promise<string> {
  const ready = peekThumbUrl(item.id);
  if (ready) return Promise.resolve(ready);

  // Keyed by link as well as id: after a link is renewed, a load still running
  // against the expired one must not be handed out again
  const key = `${item.id}|${item.thumbUrl}`;
  let promise = inFlight.get(key);
  if (!promise) {
    promise = load(item)
      .then((url) => {
        remember(item.id, url);
        return url;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
  }
  return promise;
}

/**
 * Thumbnail links expire 60 seconds after a page of results arrives, but a user
 * may take minutes to scroll to its last row. So the encrypted bytes for the whole
 * page are pulled into the disk cache straight away, while the links still work.
 */
export function prefetchThumbs(items: MediaItem[]): void {
  for (const item of items) {
    if (urls.has(item.id) || inFlight.has(`${item.id}|${item.thumbUrl}`) || prefetching.has(item.id)) continue;
    prefetching.add(item.id);
    void prefetchQueue
      .run(async () => {
        if (await hasThumbCiphertext(item.id)) return;
        const ciphertext = await fetchEncrypted(item.thumbUrl);
        await putThumbCiphertext(item.id, ciphertext);
      })
      .catch(() => {
        // Not fatal: the tile will fetch it on demand and renew the link if needed
      })
      .finally(() => prefetching.delete(item.id));
  }
}

export function clearThumbUrls(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  inFlight.clear();
  prefetching.clear();
}
