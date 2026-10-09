import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { VaultService } from './vault.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FullAccessGuard } from '../../common/guards/access-level.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/types';
import { AddMemberDto, UpdateMemberDto } from '../../common/validation/share.dto';
import { CreateVaultDto } from './dto/create-vault.dto';

@Controller('vaults')
@UseGuards(JwtAuthGuard)
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Get()
  async listVaults(@CurrentUser() user: JwtPayload) {
    return this.vaultService.listVaults(user.sub);
  }

  @Post()
  @UseGuards(FullAccessGuard)
  async createVault(@CurrentUser() user: JwtPayload, @Body() dto: CreateVaultDto) {
    return this.vaultService.createVault(user.sub, dto);
  }

  @Get(':id/members')
  async listMembers(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) vaultId: string) {
    return this.vaultService.listMembers(user.sub, vaultId);
  }

  @Post(':id/members')
  async addMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) vaultId: string,
    @Body() dto: AddMemberDto,
  ) {
    await this.vaultService.addMember(user.sub, vaultId, dto);
    return null;
  }

  @Patch(':id/members/:userId')
  async updateMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) vaultId: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    await this.vaultService.updateMember(user.sub, vaultId, memberId, dto.permission);
    return null;
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) vaultId: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
  ) {
    await this.vaultService.removeMember(user.sub, vaultId, memberId);
    return null;
  }
}
