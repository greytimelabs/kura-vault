import { ApiError, NetworkError } from '../api/client';
import { albumApi, mediaApi } from '../api/endpoints';
import type { UploadInitResponse } from '../api/types';
import { cryptoCall, VaultLockedError } from '../crypto/cryptoClient';
import type { EncryptedMedia } from '../crypto/protocol';
import { readCaptureInfo } from '../media/exif';
import { UnsupportedMediaError, mediaTypeOf, processMedia } from '../media/imageProcessing';
import { queryClient } from '../queryClient';
import { isActive, useUploadStore, type UploadItem } from '@/state/uploadStore';

/**
 * A file is encrypted in one piece, so it and its ciphertext are both in memory
 * at once. Past this size the browser is the wrong tool; the CLI streams from disk.
 */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const CONCURRENCY = 2;

let nextId = 1;
let running = 0;
const aborters = new Map<number, AbortController>();

function patch(id: number, changes: Partial<UploadItem>): void {
  useUploadStore.setState((s) => ({
    items: s.items.map((item) => (item.id === id ? { ...item, ...changes } : item)),
  }));
}

/** PUT with progress. fetch cannot report upload progress, XMLHttpRequest can, in every browser. */
function putBlob(url: string, data: ArrayBuffer, signal: AbortSignal, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // Part of the signature: storage rejects the upload if this differs
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage rejected the upload (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(data);
  });
}

async function uploadTiers(
  urls: UploadInitResponse['uploadUrls'],
  encrypted: EncryptedMedia,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const tiers = [
    { url: urls.thumb, data: encrypted.thumb.data },
    { url: urls.preview, data: encrypted.preview.data },
    { url: urls.original, data: encrypted.original.data },
  ];
  const total = tiers.reduce((sum, tier) => sum + tier.data.byteLength, 0);
  const sent = tiers.map(() => 0);
  await Promise.all(
    tiers.map((tier, i) =>
      putBlob(tier.url, tier.data, signal, (bytes) => {
        sent[i] = bytes;
        onProgress(sent.reduce((a, b) => a + b, 0) / total);
      }),
    ),
  );
}

async function uploadOne(item: UploadItem, signal: AbortSignal): Promise<void> {
  const { file, vaultId } = item;
  const mediaType = mediaTypeOf(file);
  if (!mediaType) throw new UnsupportedMediaError('Not a photo or video');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UnsupportedMediaError('Larger than 1 GB. Use the migration tool for files this size.');
  }

  patch(item.id, { status: 'processing' });
  const [processed, capture, original] = await Promise.all([
    processMedia(file, mediaType),
    readCaptureInfo(file),
    file.arrayBuffer(),
  ]);
  signal.throwIfAborted();

  patch(item.id, { status: 'encrypting' });
  const encrypted = await cryptoCall(
    'encryptMedia',
    {
      thumb: processed.thumb,
      preview: processed.preview,
      original,
      meta: {
        filename: file.name,
        ...(capture.gpsLatitude !== undefined && { gpsLatitude: capture.gpsLatitude }),
        ...(capture.gpsLongitude !== undefined && { gpsLongitude: capture.gpsLongitude }),
      },
    },
    [processed.thumb, processed.preview, original],
  );
  signal.throwIfAborted();

  patch(item.id, { status: 'uploading', progress: 0 });
  const init = await mediaApi.uploadInit({ vaultId, mediaType, fileSizeBytes: file.size });
  await uploadTiers(init.uploadUrls, encrypted, signal, (progress) => patch(item.id, { progress }));

  await mediaApi.uploadComplete({
    mediaId: init.mediaId,
    vaultId,
    mediaType,
    capturedAt: capture.capturedAt,
    fileSizeBytes: file.size,
    ...(processed.width && processed.height ? { width: processed.width, height: processed.height } : {}),
    ...(processed.durationSeconds ? { durationSeconds: processed.durationSeconds } : {}),
    encryptedDek: encrypted.encryptedDek,
    dekNonce: encrypted.dekNonce,
    thumbIv: encrypted.thumb.iv,
    previewIv: encrypted.preview.iv,
    originalIv: encrypted.original.iv,
    encryptedMeta: encrypted.encryptedMeta,
    metaNonce: encrypted.metaNonce,
  });

  if (item.albumId) {
    await albumApi.addMedia(item.albumId, init.mediaId);
  }
}

function describe(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'You do not have permission to upload to this vault';
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return err instanceof Error && err.message ? err.message : 'Upload failed';
}

function refreshLists(vaultId: string): void {
  void queryClient.invalidateQueries({ queryKey: ['media', vaultId] });
  void queryClient.invalidateQueries({ queryKey: ['albums', vaultId] });
  void queryClient.invalidateQueries({ queryKey: ['albumCover', vaultId] });
}

function pump(): void {
  while (running < CONCURRENCY) {
    const next = useUploadStore.getState().items.find((item) => item.status === 'queued' && !aborters.has(item.id));
    if (!next) return;

    const aborter = new AbortController();
    aborters.set(next.id, aborter);
    running++;

    uploadOne(next, aborter.signal)
      .then(
        () => patch(next.id, { status: 'done', progress: 1 }),
        (err: unknown) => {
          const cancelled = aborter.signal.aborted || err instanceof VaultLockedError;
          if (!cancelled) patch(next.id, { status: 'failed', error: describe(err) });
        },
      )
      .finally(() => {
        aborters.delete(next.id);
        running--;
        const { items } = useUploadStore.getState();
        // Refresh the grids once the batch settles rather than after every file
        if (!items.some((item) => item.vaultId === next.vaultId && isActive(item))) refreshLists(next.vaultId);
        pump();
      });
  }
}

export function enqueueUploads(files: File[], vaultId: string, albumId: string | null): void {
  if (files.length === 0) return;
  const items: UploadItem[] = files.map((file) => ({
    id: nextId++,
    file,
    vaultId,
    albumId,
    status: 'queued',
    progress: 0,
    error: null,
  }));
  useUploadStore.setState((s) => ({ items: [...s.items, ...items], panelOpen: true }));
  pump();
}

export function retryUpload(id: number): void {
  patch(id, { status: 'queued', progress: 0, error: null });
  pump();
}

/** Remove finished and failed rows from the panel. */
export function clearSettledUploads(): void {
  useUploadStore.setState((s) => {
    const items = s.items.filter(isActive);
    return { items, panelOpen: items.length > 0 && s.panelOpen };
  });
}

/** Stop everything. Called when the vault locks: the key the uploads need is gone. */
export function cancelAllUploads(): void {
  for (const aborter of aborters.values()) aborter.abort();
  useUploadStore.setState({ items: [], panelOpen: false });
}
