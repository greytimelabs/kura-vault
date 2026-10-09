export interface CaptureInfo {
  capturedAt: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
}

/**
 * When and where a file was captured. Falls back to the file's modified time,
 * which is the best a browser can offer for files without EXIF (most videos).
 */
export async function readCaptureInfo(file: File): Promise<CaptureInfo> {
  const fallback = new Date(file.lastModified || Date.now()).toISOString();
  try {
    // Loaded on first upload; viewers never need the EXIF parser
    const { default: exifr } = await import('exifr');
    const data = (await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'],
      gps: true,
    })) as { DateTimeOriginal?: Date; CreateDate?: Date; latitude?: number; longitude?: number } | undefined;

    const date = data?.DateTimeOriginal ?? data?.CreateDate;
    const info: CaptureInfo = {
      capturedAt: date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : fallback,
    };
    if (typeof data?.latitude === 'number' && typeof data.longitude === 'number') {
      info.gpsLatitude = data.latitude;
      info.gpsLongitude = data.longitude;
    }
    return info;
  } catch {
    return { capturedAt: fallback };
  }
}
