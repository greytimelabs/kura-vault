import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { Album } from './album.entity';
import { Media } from '../../media/entities/media.entity';

@Entity('album_media')
@Index('idx_album_media_album', ['albumId'])
@Index('idx_album_media_media', ['mediaId'])
export class AlbumMedia {
  @PrimaryColumn({ name: 'album_id', type: 'uuid' })
  albumId: string;

  @PrimaryColumn({ name: 'media_id', type: 'uuid' })
  mediaId: string;

  @ManyToOne(() => Album, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'album_id' })
  album: Album;

  @ManyToOne(() => Media, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'media_id' })
  media: Media;

  /**
   * The item's key wrapped under the album key. Null in a Liked album, which
   * has no key of its own.
   */
  @Column({ name: 'key_wrapped', type: 'text', nullable: true })
  keyWrapped: string | null;

  @Column({ name: 'key_nonce', type: 'text', nullable: true })
  keyNonce: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'added_at', type: 'timestamptz' })
  addedAt: Date;
}
