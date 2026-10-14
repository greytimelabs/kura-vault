import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PRESIGNED_URL_EXPIRY_SECONDS, UPLOAD_URL_EXPIRY_SECONDS } from '../../common/constants';

@Injectable()
export class StorageService {
  /** Talks to storage itself (deletes), over the address the server reaches it on. */
  private readonly s3Client: S3Client;
  /** Signs the URLs browsers and apps use, for the address they reach storage on. */
  private readonly signingClient: S3Client;
  private readonly bucketName: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    this.s3Client = this.createClient(this.configService.get<string>('s3.endpoint'));
    this.signingClient = this.createClient(this.configService.get<string>('s3.publicEndpoint'));
    this.bucketName = this.configService.get<string>('s3.bucketName')!;
  }

  private createClient(endpoint: string | undefined): S3Client {
    return new S3Client({
      region: this.configService.get<string>('s3.region')!,
      credentials: {
        accessKeyId: this.configService.get<string>('s3.accessKeyId')!,
        secretAccessKey: this.configService.get<string>('s3.secretAccessKey')!,
      },
      // S3-compatible storage (Cloudflare R2, Garage): one fixed origin with the bucket in the
      // path, and no default CRC32 checksum on signed uploads, which R2 rejects
      ...(endpoint
        ? {
            endpoint,
            forcePathStyle: true,
            requestChecksumCalculation: 'WHEN_REQUIRED' as const,
            responseChecksumValidation: 'WHEN_REQUIRED' as const,
          }
        : {}),
    });
  }

  /**
   * Generate pre-signed PUT URL for uploading encrypted blobs.
   * Client uploads directly to S3 - API never touches media bytes.
   */
  async generateUploadUrl(s3Key: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      ContentType: 'application/octet-stream', // encrypted blobs are opaque
    });

    return getSignedUrl(this.signingClient, command, {
      expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
    });
  }

  /**
   * Generate pre-signed GET URL for downloading encrypted blobs.
   * Short expiry (60s) since content is encrypted anyway.
   */
  async generateDownloadUrl(s3Key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    return getSignedUrl(this.signingClient, command, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });
  }

  /**
   * Delete an encrypted blob from S3. Deleting what is not there succeeds.
   * Throws when storage cannot be reached; the caller keeps the key and retries.
   */
  async deleteObject(s3Key: string): Promise<void> {
    await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: s3Key }));
  }

  /**
   * Generate S3 key path for media.
   * Format: {vaultId}/{mediaId}/{tier}.enc
   */
  generateS3Key(vaultId: string, mediaId: string, tier: 'thumb' | 'preview' | 'original'): string {
    return `${vaultId}/${mediaId}/${tier}.enc`;
  }
}
