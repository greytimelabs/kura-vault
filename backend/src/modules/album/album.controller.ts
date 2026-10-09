import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { AlbumService } from './album.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/types';
import { AddMemberDto, UpdateMemberDto } from '../../common/validation/share.dto';
import { CreateAlbumDto } from './dto/create-album.dto';
import { UpdateAlbumDto } from './dto/update-album.dto';
import { AddMediaToAlbumDto } from './dto/add-media-to-album.dto';
import { LikeMediaDto } from './dto/like-media.dto';

@Controller('albums')
@UseGuards(JwtAuthGuard)
export class AlbumController {
  constructor(private readonly albumService: AlbumService) {}

  @Get()
  async listAlbums(
    @CurrentUser() user: JwtPayload,
    @Query('vaultId', ParseUUIDPipe) vaultId: string,
  ) {
    return this.albumService.listAlbums(user.sub, vaultId);
  }

  /** Albums shared with the caller on their own. Declared before `:id` so `shared` is not parsed as an id. */
  @Get('shared')
  async listShared(@CurrentUser() user: JwtPayload) {
    return this.albumService.listShared(user.sub);
  }

  @Post()
  async createAlbum(@CurrentUser() user: JwtPayload, @Body() dto: CreateAlbumDto) {
    return this.albumService.createAlbum(user.sub, dto);
  }

  // Liked routes are open to anyone who can see the item, and must be declared before the `:id` routes
  // so `liked` is not parsed as an album id.

  @Put('liked/media/:mediaId')
  async likeMedia(
    @CurrentUser() user: JwtPayload,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: LikeMediaDto,
  ) {
    return this.albumService.likeMedia(user.sub, dto.vaultId, mediaId);
  }

  @Delete('liked/media/:mediaId')
  async unlikeMedia(
    @CurrentUser() user: JwtPayload,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Query('vaultId', ParseUUIDPipe) vaultId: string,
  ) {
    return this.albumService.unlikeMedia(user.sub, vaultId, mediaId);
  }

  @Put(':id')
  async updateAlbum(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) albumId: string,
    @Body() dto: UpdateAlbumDto,
  ) {
    return this.albumService.updateAlbum(user.sub, albumId, dto);
  }

  @Post(':id/media')
  async addMedia(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) albumId: string,
    @Body() dto: AddMediaToAlbumDto,
  ) {
    return this.albumService.addMedia(user.sub, albumId, dto);
  }

  @Delete(':id/media/:mediaId')
  async removeMedia(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) albumId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.albumService.removeMedia(user.sub, albumId, mediaId);
  }

  @Get(':id/members')
  async listMembers(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) albumId: string) {
    return this.albumService.listMembers(user.sub, albumId);
  }

  @Post(':id/members')
  async addMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) albumId: string,
    @Body() dto: AddMemberDto,
  ) {
    await this.albumService.addMember(user.sub, albumId, dto);
    return null;
  }

  @Patch(':id/members/:userId')
  async updateMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) albumId: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    await this.albumService.updateMember(user.sub, albumId, memberId, dto.permission);
    return null;
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) albumId: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
  ) {
    await this.albumService.removeMember(user.sub, albumId, memberId);
    return null;
  }
}
