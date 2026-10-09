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

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'added_at', type: 'timestamptz' })
  addedAt: Date;
}
