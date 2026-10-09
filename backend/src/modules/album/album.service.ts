import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import { Album } from './entities/album.entity';
import { AlbumMedia } from './entities/album-media.entity';
import { MediaVaultAccess } from '../media/entities/media-vault-access.entity';
import { VaultService } from '../vault/vault.service';
import { AlbumKind } from '../../common/types';
import { CreateAlbumDto } from './dto/create-album.dto';
import { UpdateAlbumDto } from './dto/update-album.dto';
import { AddMediaToAlbumDto } from './dto/add-media-to-album.dto';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class AlbumService {
  private readonly logger = new Logger(AlbumService.name);

  constructor(
    @InjectRepository(Album) private readonly albumRepo: Repository<Album>,
    @InjectRepository(AlbumMedia) private readonly albumMediaRepo: Repository<AlbumMedia>,
    @InjectRepository(MediaVaultAccess) private readonly mvaRepo: Repository<MediaVaultAccess>,
    private readonly vaultService: VaultService,
  ) {}

  /**
   * List albums for a vault: the shared albums plus the caller's own Liked album (listed first).
   */
  async listAlbums(userId: string, vaultId: string): Promise<Album[]> {
    await this.requireVaultAccess(userId, vaultId);
    await this.getOrCreateLikedAlbum(userId, vaultId);

    const albums = await this.albumRepo.find({
      where: [
        { keyGroupId: vaultId, ownerUserId: IsNull() },
        { keyGroupId: vaultId, ownerUserId: userId },
      ],
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    return albums.sort(
      (a, b) => Number(b.kind === AlbumKind.LIKED) - Number(a.kind === AlbumKind.LIKED),
    );
  }

  /**
   * Create a new album. Owner only.
   */
  async createAlbum(userId: string, dto: CreateAlbumDto): Promise<Album> {
    const access = await this.vaultService.checkAccess(userId, dto.vaultId);
    if (!access || access.permission !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    const album = this.albumRepo.create({
      keyGroupId: dto.vaultId,
      nameEncrypted: dto.nameEncrypted,
      nameNonce: dto.nameNonce,
      sortOrder: dto.sortOrder || 0,
    });

    return this.albumRepo.save(album);
  }

  /**
   * Update an album. Owner only.
   */
  async updateAlbum(userId: string, albumId: string, dto: UpdateAlbumDto): Promise<Album> {
    const album = await this.findEditableAlbum(userId, albumId);

    if (dto.nameEncrypted !== undefined) album.nameEncrypted = dto.nameEncrypted;
    if (dto.nameNonce !== undefined) album.nameNonce = dto.nameNonce;
    if (dto.coverMediaId !== undefined) album.coverMediaId = dto.coverMediaId;
    if (dto.sortOrder !== undefined) album.sortOrder = dto.sortOrder;

    return this.albumRepo.save(album);
  }

  /**
   * Add media to album.
   */
  async addMedia(userId: string, albumId: string, dto: AddMediaToAlbumDto): Promise<void> {
    const album = await this.findEditableAlbum(userId, albumId);
    await this.requireMediaInVault(dto.mediaId, album.keyGroupId);

    const added = await this.insertAlbumMedia(album.id, dto.mediaId, dto.sortOrder || 0);
    if (!added) {
      throw new BadRequestException('Media already in this album');
    }
  }

  /**
   * Remove media from album.
   */
  async removeMedia(userId: string, albumId: string, mediaId: string): Promise<void> {
    const album = await this.findEditableAlbum(userId, albumId);

    const removed = await this.deleteAlbumMedia(album.id, mediaId);
    if (!removed) {
      throw new NotFoundException('Media not found in this album');
    }
  }

  /**
   * Add media to the caller's Liked album. Any vault member can like; liking twice is a no-op.
   */
  async likeMedia(userId: string, vaultId: string, mediaId: string): Promise<void> {
    await this.requireVaultAccess(userId, vaultId);
    await this.requireMediaInVault(mediaId, vaultId);

    const likedAlbum = await this.getOrCreateLikedAlbum(userId, vaultId);
    await this.insertAlbumMedia(likedAlbum.id, mediaId, 0);
  }

  /**
   * Remove media from the caller's Liked album. Unliking something not liked is a no-op.
   */
  async unlikeMedia(userId: string, vaultId: string, mediaId: string): Promise<void> {
    await this.requireVaultAccess(userId, vaultId);

    const likedAlbum = await this.albumRepo.findOne({
      where: { kind: AlbumKind.LIKED, ownerUserId: userId, keyGroupId: vaultId },
    });
    if (likedAlbum) {
      await this.deleteAlbumMedia(likedAlbum.id, mediaId);
    }
  }

  private async requireVaultAccess(userId: string, vaultId: string): Promise<void> {
    const access = await this.vaultService.checkAccess(userId, vaultId);
    if (!access) {
      throw new ForbiddenException('No access to this vault');
    }
  }

  /**
   * Load a shared album the caller can edit through the admin endpoints.
   * Another user's private album reads as not found; the Liked album is changed only by liking.
   */
  private async findEditableAlbum(userId: string, albumId: string): Promise<Album> {
    const album = await this.albumRepo.findOne({ where: { id: albumId } });
    if (!album || (album.ownerUserId && album.ownerUserId !== userId)) {
      throw new NotFoundException('Album not found');
    }

    const access = await this.vaultService.checkAccess(userId, album.keyGroupId);
    if (!access || access.permission !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    if (album.kind === AlbumKind.LIKED) {
      throw new BadRequestException('The Liked album is changed by liking or unliking media');
    }

    return album;
  }

  private async requireMediaInVault(mediaId: string, vaultId: string): Promise<void> {
    const mva = await this.mvaRepo
      .createQueryBuilder('mva')
      .innerJoin('mva.media', 'media')
      .where('mva.media_id = :mediaId', { mediaId })
      .andWhere('mva.key_group_id = :vaultId', { vaultId })
      .andWhere('media.is_deleted = false')
      .getOne();
    if (!mva) {
      throw new NotFoundException('Media not found in this vault');
    }
  }

  private async getOrCreateLikedAlbum(userId: string, vaultId: string): Promise<Album> {
    const where = { kind: AlbumKind.LIKED, ownerUserId: userId, keyGroupId: vaultId };

    const existing = await this.albumRepo.findOne({ where });
    if (existing) {
      return existing;
    }

    try {
      return await this.albumRepo.save(this.albumRepo.create(where));
    } catch (err) {
      // A concurrent request created it first; uq_albums_liked_owner_vault rejected this one
      if (err instanceof QueryFailedError && (err as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION) {
        return this.albumRepo.findOneOrFail({ where });
      }
      throw err;
    }
  }

  /**
   * Insert an album_media row and bump the album's count. Returns false if it was already there.
   */
  private async insertAlbumMedia(albumId: string, mediaId: string, sortOrder: number): Promise<boolean> {
    const result = await this.albumMediaRepo
      .createQueryBuilder()
      .insert()
      .values({ albumId, mediaId, sortOrder })
      .orIgnore()
      .returning('album_id')
      .execute();

    if (result.raw.length === 0) {
      return false;
    }
    await this.albumRepo.increment({ id: albumId }, 'mediaCount', 1);
    return true;
  }

  /**
   * Delete an album_media row and lower the album's count. Returns false if it wasn't there.
   */
  private async deleteAlbumMedia(albumId: string, mediaId: string): Promise<boolean> {
    const result = await this.albumMediaRepo.delete({ albumId, mediaId });
    if (!result.affected) {
      return false;
    }
    await this.albumRepo.decrement({ id: albumId }, 'mediaCount', 1);
    return true;
  }
}
