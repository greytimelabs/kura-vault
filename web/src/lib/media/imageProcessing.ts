// Builds the two derived tiers for an upload in the browser. Sizes and quality
// match migration-cli/src/processor.ts so uploads look the same whichever tool made them.
import type { MediaType } from '../api/types';

const THUMB_EDGE = 200;
const THUMB_QUALITY = 0.8;
const PREVIEW_EDGE = 1080;
const PREVIEW_QUALITY = 0.85;
const VIDEO_TIMEOUT_MS = 10_000;

export interface ProcessedMedia {
  thumb: ArrayBuffer;
  preview: ArrayBuffer;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

/** The browser cannot decode this file (for example HEIC outside Safari). */
export class UnsupportedMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedMediaError';
  }
}

type Source = ImageBitmap | HTMLImageElement | HTMLVideoElement;

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToJpeg(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<ArrayBuffer> {
  let blob: Blob | null;
  if ('convertToBlob' in canvas) {
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } else {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }
  if (!blob) throw new Error('Could not encode image');
  return blob.arrayBuffer();
}

/** Scale so the SHORTEST edge is `edge` pixels, never enlarging. */
async function resizeToJpeg(
  source: Source,
  width: number,
  height: number,
  edge: number,
  quality: number,
): Promise<ArrayBuffer> {
  const scale = Math.min(1, edge / Math.min(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas is unavailable');
  // JPEG has no alpha; without this, transparent areas would come out black
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return canvasToJpeg(canvas, quality);
}

async function placeholderJpeg(width: number, height: number, quality: number): Promise<ArrayBuffer> {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.fillStyle = 'rgb(40, 40, 40)';
  ctx.fillRect(0, 0, width, height);
  return canvasToJpeg(canvas, quality);
}

async function decodeImage(file: File): Promise<{ source: ImageBitmap | HTMLImageElement; close(): void }> {
  // Preferred: off-thread decode that honours the EXIF orientation
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, close: () => bitmap.close() };
    } catch {
      // fall through to <img>, which decodes a few formats createImageBitmap does not
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new UnsupportedMediaError('This browser cannot read this image format');
  }
}

async function processImage(file: File): Promise<ProcessedMedia> {
  const { source, close } = await decodeImage(file);
  try {
    const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
    if (!width || !height) throw new UnsupportedMediaError('This image is empty or damaged');
    const thumb = await resizeToJpeg(source, width, height, THUMB_EDGE, THUMB_QUALITY);
    const preview = await resizeToJpeg(source, width, height, PREVIEW_EDGE, PREVIEW_QUALITY);
    return { thumb, preview, width, height, durationSeconds: null };
  } finally {
    close();
  }
}

function once(target: EventTarget, event: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    target.addEventListener(event, () => resolve(), { once: true, signal });
    signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  });
}

/**
 * Poster frame from about one second in. If the browser cannot decode the video
 * (HEVC or MOV outside Safari, say) the upload still goes ahead with a plain
 * placeholder, as the CLI does when ffmpeg is missing.
 */
async function processVideo(file: File): Promise<ProcessedMedia> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), VIDEO_TIMEOUT_MS);

  try {
    const failed = new Promise<never>((_, reject) =>
      video.addEventListener('error', () => reject(new Error('decode')), { once: true }),
    );
    video.src = url;
    await Promise.race([once(video, 'loadeddata', timeout.signal), failed]);

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const seekTo = Math.min(1, duration / 2);
    if (seekTo > 0) {
      const seeked = once(video, 'seeked', timeout.signal);
      video.currentTime = seekTo;
      await Promise.race([seeked, failed]);
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('no frame');

    const thumb = await resizeToJpeg(video, width, height, THUMB_EDGE, THUMB_QUALITY);
    const preview = await resizeToJpeg(video, width, height, PREVIEW_EDGE, PREVIEW_QUALITY);
    return { thumb, preview, width, height, durationSeconds: duration ? Math.round(duration) : null };
  } catch {
    return {
      thumb: await placeholderJpeg(200, 200, THUMB_QUALITY),
      preview: await placeholderJpeg(1080, 720, PREVIEW_QUALITY),
      width: null,
      height: null,
      durationSeconds: null,
    };
  } finally {
    clearTimeout(timer);
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp)$/i;

/** Null when the file is neither a photo nor a video. Falls back to the extension when the type is blank. */
export function mediaTypeOf(file: File): MediaType | null {
  if (file.type.startsWith('video/') || (!file.type && VIDEO_EXTENSIONS.test(file.name))) return 'video';
  if (file.type.startsWith('image/') || (!file.type && IMAGE_EXTENSIONS.test(file.name))) return 'photo';
  return null;
}

export function processMedia(file: File, mediaType: MediaType): Promise<ProcessedMedia> {
  return mediaType === 'video' ? processVideo(file) : processImage(file);
}
