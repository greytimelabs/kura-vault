import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Album } from './album.entity';
import { SharePermission } from '../../../common/types';

/** One album shared with one user who is not (necessarily) a member of its vault. */
@Entity('album_members')
@Index('idx_album_members_user', ['userId'])
export class AlbumMember {
  @PrimaryColumn({ name: 'album_id', type: 'uuid' })
  albumId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Album, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'album_id' })
  album: Album;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: SharePermission, enumName: 'share_permission_enum', default: SharePermission.VIEW })
  permission: SharePermission;

  /** The album key sealed to this user's public key. */
  @Column({ name: 'wrapped_key', type: 'text' })
  wrappedKey: string;

  @Column({ name: 'granted_by', type: 'uuid' })
  grantedBy: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'granted_by' })
  granter: User;

  /** The sharer's signature over the sealed key, checked by the recipient before use. */
  @Column({ name: 'grant_sig', type: 'text' })
  grantSig: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
