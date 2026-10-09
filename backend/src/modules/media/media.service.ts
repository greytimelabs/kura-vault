import {
  Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Media } from './entities/media.entity';
import { Album } from '../album/entities/album.entity';
import { AlbumMedia } from '../album/entities/album-media.entity';
import { StorageService } from '../storage/storage.service';
import { Access, AccessService } from '../../common/access/access.service';
import { UploadInitDto } from './dto/upload-init.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { QueryMediaDto } from './dto/query-media.dto';
import { SetVaultKeyDto } from './dto/vault-key.dto';
import { AlbumKind, MediaType, PaginatedResponse } from '../../common/types';
import { PG_UNIQUE_VIOLATION } from '../../common/constants';

/** An item's key as one caller can unwrap it: under the vault key, or under the key of an album it is in. */
export interface MediaKeyView {
  scope: 'vault' | 'album';
  albumId: string | null;
  wrapped: string;
  nonce: string;
}

interface UploadTarget {
  /** The caller holds the vault key and must supply the vault wrap. */
  viaVault: boolean;
  album: Album | null;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @InjectRepository(Media) private readonly mediaRepo: Repository<Media>,
    @InjectRepository(Album) private readonly albumRepo: Repository<Album>,
    @InjectRepository(AlbumMedia) private readonly albumMediaRepo: Repository<AlbumMedia>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly accessService: AccessService,
  ) {}

  /**
   * Who is uploading where. Write access to the vault allows any upload in it;
   * write access to one album allows uploads into that album only.
   */
  private async resolveUploadTarget(userId: string, vaultId: string, albumId?: string): Promise<UploadTarget> {
    let album: Album | null = null;
    if (albumId) {
      album = await this.albumRepo.findOne({ where: { id: albumId } });
      if (!album || album.vaultId !== vaultId || album.kind !== AlbumKind.REGULAR) {
        throw new NotFoundException('Album not found');
      }
    }

    const vaultAccess = await this.accessService.forVault(userId, vaultId);
    if (vaultAccess.canWrite) {
      return { viaVault: true, album };
    }
    if (album) {
      const albumAccess = await this.accessService.forAlbum(userId, album);
      if (albumAccess.canWrite) {
        return { viaVault: false, album };
      }
      if (!albumAccess.canView) {
        throw new NotFoundException('Album not found');
      }
    }
    throw new ForbiddenException('Write access required to upload');
  }

  /**
   * Initialize upload: generate media ID and pre-signed S3 upload URLs.
   * Client uploads encrypted blobs directly to S3.
   */
  async initUpload(userId: string, dto: UploadInitDto): Promise<{
    mediaId: string;
    uploadUrls: { thumb: string; preview: string; original: string };
  }> {
    await this.resolveUploadTarget(userId, dto.vaultId, dto.albumId);

    const mediaId = crypto.randomUUID();
    const thumbKey = this.storageService.generateS3Key(dto.vaultId, mediaId, 'thumb');
    const previewKey = this.storageService.generateS3Key(dto.vaultId, mediaId, 'preview');
    const originalKey = this.storageService.generateS3Key(dto.vaultId, mediaId, 'original');

    const [thumbUrl, previewUrl, originalUrl] = await Promise.all([
      this.storageService.generateUploadUrl(thumbKey),
      this.storageService.generateUploadUrl(previewKey),
      this.storageService.generateUploadUrl(originalKey),
    ]);

    return {
      mediaId,
      uploadUrls: { thumb: thumbUrl, preview: previewUrl, original: originalUrl },
    };
  }

  /**
   * Complete upload: store metadata and the item's wrapped key.
   * Called after client has uploaded all 3 tiers to S3.
   */
  async completeUpload(userId: string, dto: UploadCompleteDto): Promise<{ id: string }> {
    const target = await this.resolveUploadTarget(userId, dto.vaultId, dto.albumId);

    const vaultKey = this.pair(dto.keyWrappedVault, dto.keyNonceVault, 'vault');
    const albumKey = this.pair(dto.keyWrappedAlbum, dto.keyNonceAlbum, 'album');
    // Every item must be readable by its vault's members: directly, or through its album
    if (target.viaVault && !vaultKey) {
      throw new BadRequestException('The key wrapped under the vault key is required');
    }
    if (!target.viaVault && vaultKey) {
      throw new BadRequestException('Only vault members can supply a vault-wrapped key');
    }
    if (Boolean(target.album) !== Boolean(albumKey)) {
      throw new BadRequestException('An album upload needs the key wrapped under the album key, and only then');
    }
    if (Boolean(dto.encryptedMeta) !== Boolean(dto.metaNonce)) {
      throw new BadRequestException('Metadata needs both its ciphertext and its nonce');
    }

    const capturedAt = dto.capturedAt ? new Date(dto.capturedAt) : null;
    if (capturedAt && Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('Invalid capture time');
    }
    const yearMonth = capturedAt
      ? `${capturedAt.getFullYear()}-${String(capturedAt.getMonth() + 1).padStart(2, '0')}`
      : null;

    try {
      await this.dataSource.transaction(async (manager) => {
        // insert, not save: an id that already exists must fail, never overwrite another item
        await manager.insert(Media, {
          id: dto.mediaId,
          vaultId: dto.vaultId,
          uploadedBy: userId,
          mediaType: dto.mediaType || MediaType.PHOTO,
          capturedAt,
          yearMonth,
          width: dto.width || null,
          height: dto.height || null,
          fileSizeBytes: dto.fileSizeBytes || null,
          durationSeconds: dto.durationSeconds || null,
          aspectRatio: dto.width && dto.height ? dto.width / dto.height : null,
          s3KeyThumb: this.storageService.generateS3Key(dto.vaultId, dto.mediaId, 'thumb'),
          s3KeyPreview: this.storageService.generateS3Key(dto.vaultId, dto.mediaId, 'preview'),
          s3KeyOriginal: this.storageService.generateS3Key(dto.vaultId, dto.mediaId, 'original'),
          thumbIv: dto.thumbIv,
          previewIv: dto.previewIv,
          originalIv: dto.originalIv,
          keyWrappedVault: vaultKey?.wrapped ?? null,
          keyNonceVault: vaultKey?.nonce ?? null,
          encryptedMeta: dto.encryptedMeta || null,
          metaNonce: dto.metaNonce || null,
        });
        if (target.album && albumKey) {
          await manager.insert(AlbumMedia, {
            albumId: target.album.id,
            mediaId: dto.mediaId,
            keyWrapped: albumKey.wrapped,
            keyNonce: albumKey.nonce,
          });
          await manager.increment(Album, { id: target.album.id }, 'mediaCount', 1);
        }
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('This upload was already completed');
      }
      throw err;
    }

    return { id: dto.mediaId };
  }

  private pair(wrapped: string | undefined, nonce: string | undefined, name: string) {
    if (Boolean(wrapped) !== Boolean(nonce)) {
      throw new BadRequestException(`The ${name} key needs both its wrapped bytes and its nonce`);
    }
    return wrapped && nonce ? { wrapped, nonce } : null;
  }

  /**
   * Query media with pagination: a whole vault for its members, or one album
   * for anyone it is shared with. Returns metadata, each item's key as the
   * caller can unwrap it, and pre-signed thumbnail URLs.
   */
  async queryMedia(userId: string, dto: QueryMediaDto): Promise<PaginatedResponse<any>> {
    let album: Album | null = null;
    let access: Access;
    let vaultId: string;

    if (dto.albumId) {
      album = await this.albumRepo.findOne({ where: { id: dto.albumId } });
      const albumAccess = album ? await this.accessService.forAlbum(userId, album) : null;
      // The album must be in the vault named, if one was; a private album must be the caller's own
      if (!album || !albumAccess?.canView || (dto.vaultId && album.vaultId !== dto.vaultId)) {
        throw new NotFoundException('Album not found');
      }
      access = albumAccess;
      vaultId = album.vaultId;
    } else {
      vaultId = dto.vaultId!;
      access = await this.accessService.forVault(userId, vaultId);
      if (!access.canView) {
        throw new ForbiddenException('No access to this vault');
      }
    }

    const page = dto.page || 1;
    const limit = dto.limit || 50;
    const skip = (page - 1) * limit;

    const qb = this.mediaRepo
      .createQueryBuilder('media')
      .where('media.vault_id = :vaultId', { vaultId })
      .andWhere('media.is_deleted = false');

    if (dto.yearMonth) {
      qb.andWhere('media.year_month = :yearMonth', { yearMonth: dto.yearMonth });
    }

    if (album) {
      qb.innerJoin('album_media', 'am', 'am.media_id = media.id AND am.album_id = :albumId', {
        albumId: album.id,
      });
    }

    // Property path, not the column name: with skip/take plus a join, TypeORM
    // resolves orderBy through entity metadata and crashes on raw column names
    qb.orderBy('media.capturedAt', 'DESC', 'NULLS LAST')
      .skip(skip)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    const mediaIds = items.map((m) => m.id);

    const [likedIds, keys] = await Promise.all([
      this.getLikedMediaIds(userId, vaultId, mediaIds),
      this.resolveKeys(items, access.viaVault, album),
    ]);

    // Generate pre-signed URLs for thumbnails
    const data = await Promise.all(
      items.map(async (media) => {
        const thumbUrl = await this.storageService.generateDownloadUrl(media.s3KeyThumb);
        return {
          id: media.id,
          vaultId: media.vaultId,
          mediaType: media.mediaType,
          capturedAt: media.capturedAt,
          yearMonth: media.yearMonth,
          width: media.width,
          height: media.height,
          aspectRatio: media.aspectRatio,
          durationSeconds: media.durationSeconds,
          thumbIv: media.thumbIv,
          key: keys.get(media.id) ?? null,
          encryptedMeta: media.encryptedMeta,
          metaNonce: media.metaNonce,
          thumbUrl,
          isLiked: likedIds.has(media.id),
        };
      }),
    );

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Pick, for each item, a wrapped key the caller can open. A vault member gets
   * the vault wrap, or failing that an album wrap (they hold every album key).
   * Someone who has only the album gets that album's wrap and nothing else.
   */
  private async resolveKeys(items: Media[], viaVault: boolean, album: Album | null): Promise<Map<string, MediaKeyView>> {
    const keys = new Map<string, MediaKeyView>();
    const missing: string[] = [];

    for (const media of items) {
      if (viaVault && media.keyWrappedVault && media.keyNonceVault) {
        keys.set(media.id, { scope: 'vault', albumId: null, wrapped: media.keyWrappedVault, nonce: media.keyNonceVault });
      } else {
        missing.push(media.id);
      }
    }
    if (missing.length === 0) {
      return keys;
    }

    const rows = await this.albumMediaRepo.find({
      where: {
        mediaId: In(missing),
        keyWrapped: Not(IsNull()),
        ...(viaVault ? {} : { albumId: album!.id }),
      },
    });
    for (const row of rows) {
      // The album being browsed wins when an item is in several
      if (!keys.has(row.mediaId) || row.albumId === album?.id) {
        keys.set(row.mediaId, { scope: 'album', albumId: row.albumId, wrapped: row.keyWrapped!, nonce: row.keyNonce! });
      }
    }
    return keys;
  }

  /**
   * Which of these media are in the caller's Liked album for this vault.
   */
  private async getLikedMediaIds(userId: string, vaultId: string, mediaIds: string[]): Promise<Set<string>> {
    if (mediaIds.length === 0) {
      return new Set();
    }

    const rows = await this.albumMediaRepo
      .createQueryBuilder('am')
      .innerJoin('am.album', 'album')
      .select('am.media_id', 'mediaId')
      .where('album.kind = :kind', { kind: AlbumKind.LIKED })
      .andWhere('album.owner_user_id = :userId', { userId })
      .andWhere('album.vault_id = :vaultId', { vaultId })
      .andWhere('am.media_id IN (:...mediaIds)', { mediaIds })
      .getRawMany<{ mediaId: string }>();

    return new Set(rows.map((row) => row.mediaId));
  }

  /** An item the caller may see, or a 404 that does not say whether it exists. */
  private async findViewable(userId: string, mediaId: string): Promise<{ media: Media; access: Access }> {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId, isDeleted: false } });
    const access = media ? await this.accessService.forMedia(userId, media) : null;
    if (!media || !access?.canView) {
      throw new NotFoundException('Media not found');
    }
    return { media, access };
  }

  /**
   * Get pre-signed URLs for preview and original tiers.
   */
  async getMediaUrls(userId: string, mediaId: string): Promise<{
    previewUrl: string;
    originalUrl: string;
    previewIv: string;
    originalIv: string;
  }> {
    const { media } = await this.findViewable(userId, mediaId);

    const [previewUrl, originalUrl] = await Promise.all([
      this.storageService.generateDownloadUrl(media.s3KeyPreview),
      this.storageService.generateDownloadUrl(media.s3KeyOriginal),
    ]);

    return {
      previewUrl,
      originalUrl,
      previewIv: media.previewIv,
      originalIv: media.originalIv,
    };
  }

  /**
   * Give an item uploaded through an album its vault-wrapped key. Any vault
   * member with write access can do it; afterwards the item no longer depends
   * on that album staying in place.
   */
  async setVaultKey(userId: string, mediaId: string, dto: SetVaultKeyDto): Promise<void> {
    const { media, access } = await this.findViewable(userId, mediaId);
    if (!access.viaVault || !access.canWrite) {
      throw new ForbiddenException('Write access to the vault required');
    }
    // First write wins; an existing wrap is never replaced
    await this.mediaRepo.update(
      { id: media.id, keyWrappedVault: IsNull() },
      { keyWrappedVault: dto.keyWrapped, keyNonceVault: dto.keyNonce },
    );
  }
}
