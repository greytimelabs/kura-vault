import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, Check } from 'typeorm';
import { KeyGroup } from '../../vault/entities/key-group.entity';
import { User } from '../../user/entities/user.entity';
import { AlbumKind } from '../../../common/types';

@Entity('albums')
@Index('idx_albums_vault', ['keyGroupId'])
@Index('uq_albums_liked_owner_vault', ['ownerUserId', 'keyGroupId'], { unique: true, where: "kind = 'liked'" })
@Check(
  'chk_albums_kind',
  "(kind = 'regular' AND name_encrypted IS NOT NULL AND name_nonce IS NOT NULL) OR (kind = 'liked' AND owner_user_id IS NOT NULL)",
)
export class Album {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'key_group_id', type: 'uuid' })
  keyGroupId: string;

  @ManyToOne(() => KeyGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'key_group_id' })
  keyGroup: KeyGroup;

  @Column({ type: 'enum', enum: AlbumKind, default: AlbumKind.REGULAR })
  kind: AlbumKind;

  /**
   * Null for shared albums every vault member sees.
   * Set for per-user albums (the Liked album), visible only to that user.
   */
  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id' })
  ownerUser: User | null;

  /**
   * Album name encrypted with this vault's KEK.
   * Server cannot see album names. Null for the Liked album, which the app labels itself.
   */
  @Column({ name: 'name_encrypted', type: 'text', nullable: true })
  nameEncrypted: string | null;

  @Column({ name: 'name_nonce', type: 'text', nullable: true })
  nameNonce: string | null;

  @Column({ name: 'cover_media_id', type: 'uuid', nullable: true })
  coverMediaId: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'media_count', type: 'int', default: 0 })
  mediaCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
