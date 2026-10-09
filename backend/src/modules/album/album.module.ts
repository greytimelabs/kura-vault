import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlbumController } from './album.controller';
import { AlbumService } from './album.service';
import { Album } from './entities/album.entity';
import { AlbumMedia } from './entities/album-media.entity';
import { MediaVaultAccess } from '../media/entities/media-vault-access.entity';
import { VaultModule } from '../vault/vault.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Album, AlbumMedia, MediaVaultAccess]),
    VaultModule,
  ],
  controllers: [AlbumController],
  providers: [AlbumService],
  exports: [AlbumService],
})
export class AlbumModule {}
