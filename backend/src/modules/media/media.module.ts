import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { Media } from './entities/media.entity';
import { Album } from '../album/entities/album.entity';
import { AlbumMedia } from '../album/entities/album-media.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Media, Album, AlbumMedia])],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
