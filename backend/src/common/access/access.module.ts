import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessService } from './access.service';
import { VaultMember } from '../../modules/vault/entities/vault-member.entity';
import { AlbumMember } from '../../modules/album/entities/album-member.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([VaultMember, AlbumMember])],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
