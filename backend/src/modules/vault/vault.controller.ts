import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { VaultService } from './vault.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '../../common/types';
import { CreateVaultDto } from './dto/create-vault.dto';

@Controller('vaults')
@UseGuards(JwtAuthGuard)
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Get()
  async listVaults() {
    return this.vaultService.listVaults();
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async createVault(@CurrentUser() user: JwtPayload, @Body() dto: CreateVaultDto) {
    return this.vaultService.createVault(user.sub, dto);
  }

  @Post(':id/invite')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async generateInvite(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) vaultId: string,
  ) {
    return this.vaultService.generateInviteCode(user.sub, vaultId);
  }
}
