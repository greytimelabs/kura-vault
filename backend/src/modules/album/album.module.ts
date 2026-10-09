import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlbumController } from './album.controller';
import { AlbumService } from './album.service';
import { Album } from './entities/album.entity';
import { AlbumMedia } from './entities/album-media.entity';
import { AlbumMember } from './entities/album-member.entity';
import { Media } from '../media/entities/media.entity';
import { VaultModule } from '../vault/vault.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Album, AlbumMedia, AlbumMember, Media]),
    VaultModule,
    UserModule,
  ],
  controllers: [AlbumController],
  providers: [AlbumService],
  exports: [AlbumService],
})
export class AlbumModule {}
