import { registerAs } from '@nestjs/config';

export const s3Config = registerAs('s3', () => ({
  // Set for S3-compatible storage such as Cloudflare R2 or Garage; leave empty for AWS S3
  endpoint: process.env.S3_ENDPOINT || undefined,
  // Where browsers reach the bucket, when that is not S3_ENDPOINT: the bundled Garage is
  // reached on the server's own address (PUBLIC_URL) while the API talks to it directly
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || undefined,
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  bucketName: process.env.S3_BUCKET_NAME || 'kura-vault-storage',
}));
