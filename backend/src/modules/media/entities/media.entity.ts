import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { MediaType } from '../../../common/types';

@Entity('media')
@Index('idx_media_captured', ['capturedAt'])
@Index('idx_media_yearmonth', ['yearMonth'])
export class Media {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Structural metadata (plaintext for server-side queries) ──

  @Column({ name: 'captured_at', type: 'timestamptz', nullable: true })
  capturedAt: Date | null;

  @Column({ name: 'media_type', type: 'enum', enum: MediaType })
  mediaType: MediaType;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes: number | null;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({ name: 'aspect_ratio', type: 'float', nullable: true })
  aspectRatio: number | null;

  @Column({ name: 'year_month', type: 'varchar', length: 7, nullable: true })
  yearMonth: string | null;

  // ── S3 keys (paths to encrypted blobs) ──

  @Column({ name: 's3_key_thumb', type: 'text' })
  s3KeyThumb: string;

  @Column({ name: 's3_key_preview', type: 'text' })
  s3KeyPreview: string;

  @Column({ name: 's3_key_original', type: 'text' })
  s3KeyOriginal: string;

  // ── Encryption IVs (same across all vaults, since same DEK) ──

  @Column({ name: 'thumb_iv', type: 'text' })
  thumbIv: string;

  @Column({ name: 'preview_iv', type: 'text' })
  previewIv: string;

  @Column({ name: 'original_iv', type: 'text' })
  originalIv: string;

  // ── Flags ──
  // Likes are per user, so they live in each user's Liked album, not here.

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
