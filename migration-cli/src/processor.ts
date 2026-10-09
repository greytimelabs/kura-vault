import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileInfo, ProcessedFile } from './types';

/**
 * Process a media file: read original, generate thumbnail and preview.
 */
export async function processFile(fileInfo: FileInfo): Promise<ProcessedFile> {
  const original = fs.readFileSync(fileInfo.path);

  if (fileInfo.type === 'photo') {
    return processImage(original, fileInfo);
  } else {
    return processVideo(original, fileInfo);
  }
}

async function processImage(original: Buffer, metadata: FileInfo): Promise<ProcessedFile> {
  // Thumbnail: 200px shortest edge, JPEG quality 80
  const thumbnail = await sharp(original)
    .resize(200, 200, { fit: 'outside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  // Preview: 1080px shortest edge, JPEG quality 85
  const preview = await sharp(original)
    .resize(1080, 1080, { fit: 'outside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { original, thumbnail, preview, metadata };
}

async function processVideo(original: Buffer, metadata: FileInfo): Promise<ProcessedFile> {
  // Extract frame at 1 second using ffmpeg, then resize with sharp
  const frame = await extractVideoFrame(metadata.path);

  let thumbnail: Buffer;
  let preview: Buffer;

  if (frame) {
    thumbnail = await sharp(frame)
      .resize(200, 200, { fit: 'outside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    preview = await sharp(frame)
      .resize(1080, 1080, { fit: 'outside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } else {
    // Fallback placeholder if ffmpeg unavailable
    thumbnail = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 40, g: 40, b: 40 } },
    }).jpeg({ quality: 80 }).toBuffer();

    preview = await sharp({
      create: { width: 1080, height: 720, channels: 3, background: { r: 40, g: 40, b: 40 } },
    }).jpeg({ quality: 85 }).toBuffer();
  }

  return { original, thumbnail, preview, metadata };
}

function extractVideoFrame(videoPath: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuravault-'));
    const outputPath = path.join(tmpDir, 'frame.jpg');

    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['1'],
        filename: 'frame.jpg',
        folder: tmpDir,
        size: '1920x?',
      })
      .on('end', () => {
        try {
          if (fs.existsSync(outputPath)) {
            const frame = fs.readFileSync(outputPath);
            // Cleanup
            fs.rmSync(tmpDir, { recursive: true, force: true });
            resolve(frame);
          } else {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      })
      .on('error', () => {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
        resolve(null);
      });
  });
}
