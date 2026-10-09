import {
  Controller, Get, Post, Put, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { AlbumService } from './album.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '../../common/types';
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

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async createAlbum(@CurrentUser() user: JwtPayload, @Body() dto: CreateAlbumDto) {
    return this.albumService.createAlbum(user.sub, dto);
  }

  // Liked routes are open to viewers, and must be declared before the `:id` routes
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
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async updateAlbum(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) albumId: string,
    @Body() dto: UpdateAlbumDto,
  ) {
    return this.albumService.updateAlbum(user.sub, albumId, dto);
  }

  @Post(':id/media')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async addMedia(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) albumId: string,
    @Body() dto: AddMediaToAlbumDto,
  ) {
    return this.albumService.addMedia(user.sub, albumId, dto);
  }

  @Delete(':id/media/:mediaId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async removeMedia(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) albumId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.albumService.removeMedia(user.sub, albumId, mediaId);
  }
}
