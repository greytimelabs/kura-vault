import { mediaApi } from '../api/endpoints';
import type { MediaItem, MediaMeta } from '../api/types';
import { cryptoCall } from '../crypto/cryptoClient';
import { fetchEncrypted } from './blobFetch';

// Decrypted previews are large, so only the few around the open photo are kept.
const MAX_PREVIEWS = 6;
const previews = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

/** Originals are decrypted in one piece, which needs about twice the file size in memory. */
export const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

export function peekPreviewUrl(id: string): string | undefined {
  return previews.get(id);
}

async function load(item: MediaItem, vaultId: string): Promise<string> {
  // Links live for 60 seconds, so they are requested right before use
  const links = await mediaApi.urls(item.id, vaultId);
  const ciphertext = await fetchEncrypted(links.previewUrl);
  const plain = await cryptoCall(
    'decryptBlob',
    { encryptedDek: item.encryptedDek, dekNonce: item.dekNonce, iv: links.previewIv, data: ciphertext },
    [ciphertext],
  );
  return URL.createObjectURL(new Blob([plain], { type: 'image/jpeg' }));
}

/** Object URL of the decrypted 1080px preview. */
export function loadPreviewUrl(item: MediaItem, vaultId: string): Promise<string> {
  const ready = previews.get(item.id);
  if (ready) {
    previews.delete(item.id);
    previews.set(item.id, ready);
    return Promise.resolve(ready);
  }

  let promise = inFlight.get(item.id);
  if (!promise) {
    promise = load(item, vaultId)
      .then((url) => {
        previews.set(item.id, url);
        if (previews.size > MAX_PREVIEWS) {
          const oldest = previews.keys().next().value!;
          URL.revokeObjectURL(previews.get(oldest)!);
          previews.delete(oldest);
        }
        return url;
      })
      .finally(() => inFlight.delete(item.id));
    inFlight.set(item.id, promise);
  }
  return promise;
}

export function clearPreviewUrls(): void {
  for (const url of previews.values()) URL.revokeObjectURL(url);
  previews.clear();
  inFlight.clear();
}

export async function decryptMeta(item: MediaItem): Promise<MediaMeta> {
  const json = await cryptoCall('decryptText', { encrypted: item.encryptedMeta, nonce: item.metaNonce });
  if (!json) return {};
  try {
    return JSON.parse(json) as MediaMeta;
  } catch {
    return {};
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
};

/** Decrypt the original file and hand it to the browser's download manager. */
export async function downloadOriginal(item: MediaItem, vaultId: string): Promise<void> {
  const [links, meta] = await Promise.all([mediaApi.urls(item.id, vaultId), decryptMeta(item)]);
  const ciphertext = await fetchEncrypted(links.originalUrl, { maxBytes: MAX_DOWNLOAD_BYTES });
  const plain = await cryptoCall(
    'decryptBlob',
    { encryptedDek: item.encryptedDek, dekNonce: item.dekNonce, iv: links.originalIv, data: ciphertext },
    [ciphertext],
  );

  const fallback = `${item.id}.${item.mediaType === 'video' ? 'mp4' : 'jpg'}`;
  // Only the last path segment: a stored name must never steer where the file lands
  const filename = meta.filename?.split(/[\\/]/).pop()?.trim() || fallback;
  const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  const type = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';

  const url = URL.createObjectURL(new Blob([plain], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari starts the download asynchronously; revoking at once would cancel it
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
