import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';
import { KeyGroup } from './entities/key-group.entity';
import { UserVaultAccess } from './entities/user-vault-access.entity';
import { InviteCode } from './entities/invite-code.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KeyGroup, UserVaultAccess, InviteCode])],
  controllers: [VaultController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
