import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Album } from './entities/album.entity';
import { AlbumMedia } from './entities/album-media.entity';
import { AlbumMember } from './entities/album-member.entity';
import { Media } from '../media/entities/media.entity';
import { AccessService } from '../../common/access/access.service';
import { VaultService } from '../vault/vault.service';
import { UserService, publicKeysOf } from '../user/user.service';
import { AlbumKind, SharePermission } from '../../common/types';
import { PG_UNIQUE_VIOLATION } from '../../common/constants';
import { AddMemberDto } from '../../common/validation/share.dto';
import { CreateAlbumDto } from './dto/create-album.dto';
import { UpdateAlbumDto } from './dto/update-album.dto';
import { AddMediaToAlbumDto } from './dto/add-media-to-album.dto';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class AlbumService {
  private readonly logger = new Logger(AlbumService.name);

  constructor(
    @InjectRepository(Album) private readonly albumRepo: Repository<Album>,
    @InjectRepository(AlbumMedia) private readonly albumMediaRepo: Repository<AlbumMedia>,
    @InjectRepository(AlbumMember) private readonly memberRepo: Repository<AlbumMember>,
    @InjectRepository(Media) private readonly mediaRepo: Repository<Media>,
    private readonly accessService: AccessService,
    private readonly vaultService: VaultService,
    private readonly userService: UserService,
  ) {}

  /**
   * List albums for a vault member: the vault's albums plus the caller's own Liked album (listed first).
   */
  async listAlbums(userId: string, vaultId: string): Promise<Album[]> {
    const access = await this.accessService.forVault(userId, vaultId);
    if (!access.canView) {
      throw new ForbiddenException('No access to this vault');
    }
    await this.getOrCreateLikedAlbum(userId, vaultId);

    const albums = await this.albumRepo.find({
      where: [
        { vaultId, ownerUserId: IsNull() },
        { vaultId, ownerUserId: userId },
      ],
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    return albums.sort(
      (a, b) => Number(b.kind === AlbumKind.LIKED) - Number(a.kind === AlbumKind.LIKED),
    );
  }

  /** Albums shared with the caller one by one, each with the caller's wrapped copy of its key. */
  async listShared(userId: string) {
    const members = await this.memberRepo.find({
      where: { userId },
      relations: ['album'],
      order: { createdAt: 'ASC' },
    });
    const granters = await this.userService.findByIds(members.map((m) => m.grantedBy));

    return members.map((m) => {
      const granter = granters.get(m.grantedBy);
      return {
        id: m.albumId,
        vaultId: m.album.vaultId,
        permission: m.permission,
        wrappedKey: m.wrappedKey,
        grantSig: m.grantSig,
        granter: granter ? publicKeysOf(granter) : null,
        nameEncrypted: m.album.nameEncrypted,
        nameNonce: m.album.nameNonce,
        coverMediaId: m.album.coverMediaId,
        mediaCount: m.album.mediaCount,
        createdAt: m.album.createdAt,
      };
    });
  }

  /**
   * Create an album. Needs write access to the vault: the album key is wrapped
   * under the vault key, which only a vault member can do.
   */
  async createAlbum(userId: string, dto: CreateAlbumDto): Promise<Album> {
    const access = await this.accessService.forVault(userId, dto.vaultId);
    if (!access.canWrite) {
      throw new ForbiddenException('Write access to the vault required');
    }

    const album = this.albumRepo.create({
      id: dto.id,
      vaultId: dto.vaultId,
      kind: AlbumKind.REGULAR,
      nameEncrypted: dto.nameEncrypted,
      nameNonce: dto.nameNonce,
      keyWrapped: dto.keyWrapped,
      keyNonce: dto.keyNonce,
      sortOrder: dto.sortOrder || 0,
      createdBy: userId,
    });
    try {
      await this.albumRepo.insert(album);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Album already exists');
      }
      throw err;
    }
    return this.albumRepo.findOneOrFail({ where: { id: dto.id } });
  }

  async updateAlbum(userId: string, albumId: string, dto: UpdateAlbumDto): Promise<Album> {
    const album = await this.findEditableAlbum(userId, albumId);

    if (dto.nameEncrypted !== undefined) album.nameEncrypted = dto.nameEncrypted;
    if (dto.nameNonce !== undefined) album.nameNonce = dto.nameNonce;
    if (dto.coverMediaId !== undefined) album.coverMediaId = dto.coverMediaId;
    if (dto.sortOrder !== undefined) album.sortOrder = dto.sortOrder;

    return this.albumRepo.save(album);
  }

  /**
   * Add an item of the vault to one of its albums.
   */
  async addMedia(userId: string, albumId: string, dto: AddMediaToAlbumDto): Promise<void> {
    const album = await this.findEditableAlbum(userId, albumId);
    await this.requireMediaInVault(dto.mediaId, album.vaultId);

    const added = await this.insertAlbumMedia(album.id, dto.mediaId, dto.sortOrder || 0, {
      keyWrapped: dto.keyWrapped,
      keyNonce: dto.keyNonce,
    });
    if (!added) {
      throw new BadRequestException('Media already in this album');
    }
  }

  async removeMedia(userId: string, albumId: string, mediaId: string): Promise<void> {
    const album = await this.findEditableAlbum(userId, albumId);

    // An item uploaded by someone who only had this album has no vault-wrapped
    // key. Taking it out now would leave nobody able to decrypt it.
    const media = await this.mediaRepo.findOne({ where: { id: mediaId, vaultId: album.vaultId } });
    if (media && !media.keyWrappedVault) {
      throw new ConflictException('Add the vault key for this item before removing it from the album');
    }

    const removed = await this.deleteAlbumMedia(album.id, mediaId);
    if (!removed) {
      throw new NotFoundException('Media not found in this album');
    }
  }

  /**
   * Add media to the caller's Liked album. Anyone who can see the item can like it; liking twice is a no-op.
   */
  async likeMedia(userId: string, vaultId: string, mediaId: string): Promise<void> {
    await this.requireViewableMedia(userId, vaultId, mediaId);

    const likedAlbum = await this.getOrCreateLikedAlbum(userId, vaultId);
    await this.insertAlbumMedia(likedAlbum.id, mediaId, 0, null);
  }

  /**
   * Remove media from the caller's Liked album. Unliking something not liked is a no-op.
   */
  async unlikeMedia(userId: string, vaultId: string, mediaId: string): Promise<void> {
    const likedAlbum = await this.albumRepo.findOne({
      where: { kind: AlbumKind.LIKED, ownerUserId: userId, vaultId },
    });
    if (likedAlbum) {
      await this.deleteAlbumMedia(likedAlbum.id, mediaId);
    }
  }

  // ── Sharing one album ──

  async listMembers(userId: string, albumId: string) {
    const album = await this.findShareableAlbum(userId, albumId);
    const members = await this.memberRepo.find({
      where: { albumId: album.id },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
    return members.map((m) => ({
      userId: m.userId,
      username: m.user.username,
      permission: m.permission,
      createdAt: m.createdAt,
    }));
  }

  async addMember(userId: string, albumId: string, dto: AddMemberDto): Promise<void> {
    const album = await this.findShareableAlbum(userId, albumId);
    await this.vaultService.requireShareable(userId, dto.userId);

    const result = await this.memberRepo
      .createQueryBuilder()
      .insert()
      .values({
        albumId: album.id,
        userId: dto.userId,
        permission: dto.permission,
        wrappedKey: dto.wrappedKey,
        grantedBy: userId,
        grantSig: dto.grantSig,
      })
      .orIgnore()
      .returning('user_id')
      .execute();
    if (result.raw.length === 0) {
      throw new ConflictException('Already shared with this user');
    }
  }

  async updateMember(userId: string, albumId: string, memberId: string, permission: SharePermission): Promise<void> {
    const album = await this.findShareableAlbum(userId, albumId);
    const result = await this.memberRepo.update({ albumId: album.id, userId: memberId }, { permission });
    if (!result.affected) {
      throw new NotFoundException('Not shared with this user');
    }
  }

  /** Stop sharing. The user's wrapped key is deleted and their next request is refused. */
  async removeMember(userId: string, albumId: string, memberId: string): Promise<void> {
    const album = await this.findShareableAlbum(userId, albumId);
    const result = await this.memberRepo.delete({ albumId: album.id, userId: memberId });
    if (!result.affected) {
      throw new NotFoundException('Not shared with this user');
    }
  }

  /** A regular album whose vault the caller created. */
  private async findShareableAlbum(userId: string, albumId: string): Promise<Album> {
    const album = await this.albumRepo.findOne({ where: { id: albumId } });
    if (!album || album.ownerUserId) {
      throw new NotFoundException('Album not found');
    }
    try {
      await this.vaultService.requireCreator(userId, album.vaultId);
    } catch (err) {
      // An album in a vault the caller cannot see does not exist as far as they are told
      throw err instanceof NotFoundException ? new NotFoundException('Album not found') : err;
    }
    return album;
  }

  /**
   * Load an album the caller may change: a regular album in a vault they can write to.
   * Another user's private album reads as not found; the Liked album is changed only by liking.
   */
  private async findEditableAlbum(userId: string, albumId: string): Promise<Album> {
    const album = await this.albumRepo.findOne({ where: { id: albumId } });
    if (!album || (album.ownerUserId && album.ownerUserId !== userId)) {
      throw new NotFoundException('Album not found');
    }

    const access = await this.accessService.forVault(userId, album.vaultId);
    if (!access.canView) {
      // Someone the album alone is shared with can add uploads to it, not reorganise it
      const viaAlbum = await this.accessService.forAlbum(userId, album);
      throw viaAlbum.canView
        ? new ForbiddenException('Write access to the vault required')
        : new NotFoundException('Album not found');
    }
    if (!access.canWrite) {
      throw new ForbiddenException('Write access to the vault required');
    }

    if (album.kind === AlbumKind.LIKED) {
      throw new BadRequestException('The Liked album is changed by liking or unliking media');
    }

    return album;
  }

  private async requireMediaInVault(mediaId: string, vaultId: string): Promise<Media> {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId, vaultId, isDeleted: false } });
    if (!media) {
      throw new NotFoundException('Media not found in this vault');
    }
    return media;
  }

  private async requireViewableMedia(userId: string, vaultId: string, mediaId: string): Promise<void> {
    const media = await this.requireMediaInVault(mediaId, vaultId);
    const access = await this.accessService.forMedia(userId, media);
    if (!access.canView) {
      throw new NotFoundException('Media not found in this vault');
    }
  }

  private async getOrCreateLikedAlbum(userId: string, vaultId: string): Promise<Album> {
    const where = { kind: AlbumKind.LIKED, ownerUserId: userId, vaultId };

    const existing = await this.albumRepo.findOne({ where });
    if (existing) {
      return existing;
    }

    try {
      return await this.albumRepo.save(this.albumRepo.create({ id: crypto.randomUUID(), ...where }));
    } catch (err) {
      // A concurrent request created it first; uq_albums_liked_owner_vault rejected this one
      if (isUniqueViolation(err)) {
        return this.albumRepo.findOneOrFail({ where });
      }
      throw err;
    }
  }

  /**
   * Insert an album_media row and bump the album's count. Returns false if it was already there.
   */
  private async insertAlbumMedia(
    albumId: string,
    mediaId: string,
    sortOrder: number,
    key: { keyWrapped: string; keyNonce: string } | null,
  ): Promise<boolean> {
    const result = await this.albumMediaRepo
      .createQueryBuilder()
      .insert()
      .values({ albumId, mediaId, sortOrder, keyWrapped: key?.keyWrapped ?? null, keyNonce: key?.keyNonce ?? null })
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
