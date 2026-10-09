import { registerAs } from '@nestjs/config';

export const s3Config = registerAs('s3', () => ({
  // Set for S3-compatible storage such as Cloudflare R2; leave empty for AWS S3
  endpoint: process.env.S3_ENDPOINT || undefined,
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  bucketName: process.env.S3_BUCKET_NAME || 'kura-vault-storage',
  presignedExpiry: parseInt(process.env.S3_PRESIGNED_EXPIRY || '60', 10),
  cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN,
  cloudfrontKeyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID,
  cloudfrontPrivateKeyPath: process.env.CLOUDFRONT_PRIVATE_KEY_PATH,
}));
