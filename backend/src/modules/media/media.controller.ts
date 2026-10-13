import {
  Controller, Get, Post, Put, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/types';
import { UploadInitDto } from './dto/upload-init.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { QueryMediaDto } from './dto/query-media.dto';
import { SetVaultKeyDto } from './dto/vault-key.dto';
import { DeleteMediaDto } from './dto/delete-media.dto';

// No role guards here: what a caller may do is decided per vault and per album
// by AccessService, inside the service.
@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload/init')
  async initUpload(@CurrentUser() user: JwtPayload, @Body() dto: UploadInitDto) {
    return this.mediaService.initUpload(user.sub, dto);
  }

  @Post('upload/complete')
  async completeUpload(@CurrentUser() user: JwtPayload, @Body() dto: UploadCompleteDto) {
    return this.mediaService.completeUpload(user.sub, dto);
  }

  /** One call for a whole selection. A POST because a DELETE with a body is not reliably delivered. */
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  async deleteMedia(@CurrentUser() user: JwtPayload, @Body() dto: DeleteMediaDto) {
    return this.mediaService.deleteMedia(user.sub, dto.ids);
  }

  @Get()
  async queryMedia(@CurrentUser() user: JwtPayload, @Query() dto: QueryMediaDto) {
    return this.mediaService.queryMedia(user.sub, dto);
  }

  @Get(':id/urls')
  async getMediaUrls(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) mediaId: string) {
    return this.mediaService.getMediaUrls(user.sub, mediaId);
  }

  @Put(':id/vault-key')
  async setVaultKey(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) mediaId: string,
    @Body() dto: SetVaultKeyDto,
  ) {
    await this.mediaService.setVaultKey(user.sub, mediaId, dto);
    return null;
  }
}
