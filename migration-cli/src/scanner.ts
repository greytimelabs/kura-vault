import { glob } from 'glob';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';
import { FileInfo } from './types';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv'];
const ALL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];

/**
 * Scan a directory recursively for media files.
 */
export async function scanDirectory(sourceDir: string): Promise<FileInfo[]> {
  const patterns = ALL_EXTENSIONS.map((ext) => `**/*${ext}`);
  const files: string[] = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: sourceDir,
      nocase: true,
      absolute: true,
    });
    files.push(...matches);
  }

  // Deduplicate and sort
  const uniqueFiles = [...new Set(files)].sort();

  const results: FileInfo[] = [];
  for (const filePath of uniqueFiles) {
    try {
      const info = await getFileInfo(filePath);
      results.push(info);
    } catch (err) {
      console.error(`Skipping ${filePath}: ${(err as Error).message}`);
    }
  }

  return results;
}

async function getFileInfo(filePath: string): Promise<FileInfo> {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const isVideo = VIDEO_EXTENSIONS.includes(ext);

  if (isVideo) {
    return getVideoInfo(filePath, stat);
  }

  return getImageInfo(filePath, stat);
}

async function getImageInfo(filePath: string, stat: fs.Stats): Promise<FileInfo> {
  try {
    const metadata = await sharp(filePath).metadata();
    const exifDate = metadata.exif ? extractExifDate(metadata.exif) : null;
    const gps = metadata.exif ? extractGps(metadata.exif) : null;

    return {
      path: filePath,
      type: 'photo',
      capturedAt: exifDate || stat.birthtime.toISOString(),
      width: metadata.width || null,
      height: metadata.height || null,
      durationSeconds: null,
      fileSizeBytes: stat.size,
      gpsLatitude: gps?.latitude || null,
      gpsLongitude: gps?.longitude || null,
    };
  } catch {
    return {
      path: filePath,
      type: 'photo',
      capturedAt: stat.birthtime.toISOString(),
      width: null,
      height: null,
      durationSeconds: null,
      fileSizeBytes: stat.size,
      gpsLatitude: null,
      gpsLongitude: null,
    };
  }
}

async function getVideoInfo(filePath: string, stat: fs.Stats): Promise<FileInfo> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err || !metadata) {
        resolve({
          path: filePath,
          type: 'video',
          capturedAt: stat.birthtime.toISOString(),
          width: null,
          height: null,
          durationSeconds: null,
          fileSizeBytes: stat.size,
          gpsLatitude: null,
          gpsLongitude: null,
        });
        return;
      }

      const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
      const duration = metadata.format?.duration
        ? Math.round(metadata.format.duration)
        : null;

      resolve({
        path: filePath,
        type: 'video',
        capturedAt: (metadata.format?.tags as any)?.creation_time || stat.birthtime.toISOString(),
        width: videoStream?.width || null,
        height: videoStream?.height || null,
        durationSeconds: duration,
        fileSizeBytes: stat.size,
        gpsLatitude: null,
        gpsLongitude: null,
      });
    });
  });
}

function extractExifDate(exifBuffer: Buffer): string | null {
  try {
    const exifStr = exifBuffer.toString('binary');
    const dateMatch = exifStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (dateMatch) {
      const [, year, month, day, hour, min, sec] = dateMatch;
      return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`).toISOString();
    }
  } catch {
    // Ignore EXIF parsing errors
  }
  return null;
}

function extractGps(exifBuffer: Buffer): { latitude: number; longitude: number } | null {
  try {
    // Basic GPS extraction from EXIF — look for GPS IFD markers
    // This is a simplified version; production should use a proper EXIF library
    const exifStr = exifBuffer.toString('binary');
    const latMatch = exifStr.match(/GPSLatitude/);
    const lonMatch = exifStr.match(/GPSLongitude/);
    if (latMatch && lonMatch) {
      // GPS data exists but proper parsing requires a dedicated EXIF library
      // Return null for now — the data will be in the raw EXIF which Sharp provides
      return null;
    }
  } catch {
    // Ignore
  }
  return null;
}
