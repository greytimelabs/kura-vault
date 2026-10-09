import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '../../common/types';
import { UploadInitDto } from './dto/upload-init.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { QueryMediaDto } from './dto/query-media.dto';
import { AddVaultAccessDto } from './dto/add-vault-access.dto';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload/init')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async initUpload(@CurrentUser() user: JwtPayload, @Body() dto: UploadInitDto) {
    return this.mediaService.initUpload(user.sub, dto);
  }

  @Post('upload/complete')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async completeUpload(@CurrentUser() user: JwtPayload, @Body() dto: UploadCompleteDto) {
    return this.mediaService.completeUpload(user.sub, dto);
  }

  @Get()
  async queryMedia(@CurrentUser() user: JwtPayload, @Query() dto: QueryMediaDto) {
    return this.mediaService.queryMedia(user.sub, dto);
  }

  @Get(':id/urls')
  async getMediaUrls(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) mediaId: string,
    @Query('vaultId', ParseUUIDPipe) vaultId: string,
  ) {
    return this.mediaService.getMediaUrls(user.sub, mediaId, vaultId);
  }

  @Post(':id/vault-access')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async addVaultAccess(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) mediaId: string,
    @Body() dto: AddVaultAccessDto,
  ) {
    return this.mediaService.addVaultAccess(user.sub, mediaId, dto);
  }
}
