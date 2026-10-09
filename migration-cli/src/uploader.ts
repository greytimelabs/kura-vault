/**
 * Upload encrypted blobs directly to S3 via pre-signed URLs.
 */
export async function uploadToS3(url: string, data: Buffer): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length.toString(),
    },
    body: new Uint8Array(data),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`S3 upload failed (${response.status}): ${body}`);
  }
}

/**
 * Upload all three tiers (thumb, preview, original) in parallel.
 */
export async function uploadAllTiers(
  urls: { thumb: string; preview: string; original: string },
  encrypted: { thumb: Buffer; preview: Buffer; original: Buffer },
): Promise<void> {
  await Promise.all([
    uploadToS3(urls.thumb, encrypted.thumb),
    uploadToS3(urls.preview, encrypted.preview),
    uploadToS3(urls.original, encrypted.original),
  ]);
}
