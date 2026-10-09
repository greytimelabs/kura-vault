import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { Media } from './entities/media.entity';
import { MediaVaultAccess } from './entities/media-vault-access.entity';
import { Album } from '../album/entities/album.entity';
import { AlbumMedia } from '../album/entities/album-media.entity';
import { VaultModule } from '../vault/vault.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Media, MediaVaultAccess, Album, AlbumMedia]),
    VaultModule,
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
