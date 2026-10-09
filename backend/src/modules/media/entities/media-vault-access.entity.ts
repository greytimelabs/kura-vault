import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { Media } from './media.entity';
import { KeyGroup } from '../../vault/entities/key-group.entity';

@Entity('media_vault_access')
@Unique('uq_media_vault', ['mediaId', 'keyGroupId'])
@Index('idx_mva_vault', ['keyGroupId'])
@Index('idx_mva_media', ['mediaId'])
export class MediaVaultAccess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'media_id', type: 'uuid' })
  mediaId: string;

  @ManyToOne(() => Media, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'media_id' })
  media: Media;

  @Column({ name: 'key_group_id', type: 'uuid' })
  keyGroupId: string;

  @ManyToOne(() => KeyGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'key_group_id' })
  keyGroup: KeyGroup;

  /**
   * DEK encrypted with this vault's KEK.
   * Base64-encoded. ~64 bytes.
   */
  @Column({ name: 'encrypted_dek', type: 'text' })
  encryptedDek: string;

  @Column({ name: 'dek_nonce', type: 'text' })
  dekNonce: string;

  /**
   * Sensitive metadata (filename, GPS, camera, tags)
   * encrypted with this vault's KEK.
   * JSON string encrypted then base64-encoded.
   */
  @Column({ name: 'encrypted_meta', type: 'text', nullable: true })
  encryptedMeta: string | null;

  @Column({ name: 'meta_nonce', type: 'text', nullable: true })
  metaNonce: string | null;
}
