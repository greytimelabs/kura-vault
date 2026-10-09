import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PRESIGNED_URL_EXPIRY_SECONDS, UPLOAD_URL_EXPIRY_SECONDS } from '../../common/constants';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('s3.endpoint');
    this.s3Client = new S3Client({
      region: this.configService.get<string>('s3.region')!,
      credentials: {
        accessKeyId: this.configService.get<string>('s3.accessKeyId')!,
        secretAccessKey: this.configService.get<string>('s3.secretAccessKey')!,
      },
      // S3-compatible storage (Cloudflare R2): one fixed origin with the bucket in the path,
      // and no default CRC32 checksum on signed uploads, which R2 rejects
      ...(endpoint
        ? {
            endpoint,
            forcePathStyle: true,
            requestChecksumCalculation: 'WHEN_REQUIRED' as const,
            responseChecksumValidation: 'WHEN_REQUIRED' as const,
          }
        : {}),
    });
    this.bucketName = this.configService.get<string>('s3.bucketName')!;
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

    return getSignedUrl(this.s3Client, command, {
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

    return getSignedUrl(this.s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });
  }

  /**
   * Delete an encrypted blob from S3.
   */
  async deleteObject(s3Key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });
      await this.s3Client.send(command);
    } catch (error) {
      this.logger.error(`Failed to delete S3 object: ${s3Key}`, error);
      throw error;
    }
  }

  /**
   * Generate S3 key path for media.
   * Format: {vaultId}/{mediaId}/{tier}.enc
   */
  generateS3Key(vaultId: string, mediaId: string, tier: 'thumb' | 'preview' | 'original'): string {
    return `${vaultId}/${mediaId}/${tier}.enc`;
  }
}
