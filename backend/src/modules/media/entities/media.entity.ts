import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { MediaType } from '../../../common/types';
import { Vault } from '../../vault/entities/vault.entity';
import { User } from '../../user/entities/user.entity';

@Entity('media')
@Index('idx_media_vault_captured', ['vaultId', 'capturedAt'])
@Index('idx_media_yearmonth', ['yearMonth'])
export class Media {
  /** Issued by upload/init. The item's key, blobs and metadata are bound to it. */
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'vault_id', type: 'uuid' })
  vaultId: string;

  @ManyToOne(() => Vault, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vault_id' })
  vault: Vault;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by' })
  uploader: User | null;

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

  // ── Encryption ──

  @Column({ name: 'thumb_iv', type: 'text' })
  thumbIv: string;

  @Column({ name: 'preview_iv', type: 'text' })
  previewIv: string;

  @Column({ name: 'original_iv', type: 'text' })
  originalIv: string;

  /**
   * The item's key wrapped under the vault key. Null when it was uploaded by
   * someone who holds only an album key; vault members then reach it through
   * that album (`album_media.key_wrapped`) until a vault member adds this.
   */
  @Column({ name: 'key_wrapped_vault', type: 'text', nullable: true })
  keyWrappedVault: string | null;

  @Column({ name: 'key_nonce_vault', type: 'text', nullable: true })
  keyNonceVault: string | null;

  /** Sensitive metadata (filename, GPS, camera) as JSON, encrypted under the item's own key. */
  @Column({ name: 'encrypted_meta', type: 'text', nullable: true })
  encryptedMeta: string | null;

  @Column({ name: 'meta_nonce', type: 'text', nullable: true })
  metaNonce: string | null;

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
