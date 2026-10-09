import {
  Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Media } from './entities/media.entity';
import { MediaVaultAccess } from './entities/media-vault-access.entity';
import { Album } from '../album/entities/album.entity';
import { AlbumMedia } from '../album/entities/album-media.entity';
import { StorageService } from '../storage/storage.service';
import { VaultService } from '../vault/vault.service';
import { UploadInitDto } from './dto/upload-init.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { QueryMediaDto } from './dto/query-media.dto';
import { AddVaultAccessDto } from './dto/add-vault-access.dto';
import { AlbumKind, MediaType, PaginatedResponse } from '../../common/types';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @InjectRepository(Media) private readonly mediaRepo: Repository<Media>,
    @InjectRepository(MediaVaultAccess) private readonly mvaRepo: Repository<MediaVaultAccess>,
    @InjectRepository(Album) private readonly albumRepo: Repository<Album>,
    @InjectRepository(AlbumMedia) private readonly albumMediaRepo: Repository<AlbumMedia>,
    private readonly storageService: StorageService,
    private readonly vaultService: VaultService,
  ) {}

  /**
   * Initialize upload: generate media ID and pre-signed S3 upload URLs.
   * Client uploads encrypted blobs directly to S3.
   */
  async initUpload(userId: string, dto: UploadInitDto): Promise<{
    mediaId: string;
    uploadUrls: { thumb: string; preview: string; original: string };
  }> {
    // Verify user has admin access to vault
    const access = await this.vaultService.checkAccess(userId, dto.vaultId);
    if (!access || access.permission !== 'admin') {
      throw new ForbiddenException('Admin access required to upload');
    }

    const mediaId = uuidv4();
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
   * Complete upload: store metadata and encrypted DEK.
   * Called after client has uploaded all 3 tiers to S3.
   */
  async completeUpload(userId: string, dto: UploadCompleteDto): Promise<Media> {
    const access = await this.vaultService.checkAccess(userId, dto.vaultId);
    if (!access || access.permission !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    const capturedAt = dto.capturedAt ? new Date(dto.capturedAt) : null;
    const yearMonth = capturedAt
      ? `${capturedAt.getFullYear()}-${String(capturedAt.getMonth() + 1).padStart(2, '0')}`
      : null;

    // Create media record
    const media = this.mediaRepo.create({
      id: dto.mediaId,
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
    });
    const savedMedia = await this.mediaRepo.save(media);

    // Create vault access with encrypted DEK
    const mva = this.mvaRepo.create({
      mediaId: savedMedia.id,
      keyGroupId: dto.vaultId,
      encryptedDek: dto.encryptedDek,
      dekNonce: dto.dekNonce,
      encryptedMeta: dto.encryptedMeta || null,
      metaNonce: dto.metaNonce || null,
    });
    await this.mvaRepo.save(mva);

    return savedMedia;
  }

  /**
   * Query media for a vault with pagination.
   * Returns metadata + encrypted DEKs + pre-signed download URLs.
   */
  async queryMedia(userId: string, dto: QueryMediaDto): Promise<PaginatedResponse<any>> {
    const access = await this.vaultService.checkAccess(userId, dto.vaultId);
    if (!access) {
      throw new ForbiddenException('No access to this vault');
    }

    const page = dto.page || 1;
    const limit = dto.limit || 50;
    const skip = (page - 1) * limit;

    // The album must be in this vault, and a private album (Liked) must be the caller's own
    if (dto.albumId) {
      const album = await this.albumRepo.findOne({ where: { id: dto.albumId } });
      if (
        !album ||
        album.keyGroupId !== dto.vaultId ||
        (album.ownerUserId && album.ownerUserId !== userId)
      ) {
        throw new NotFoundException('Album not found');
      }
    }

    const qb = this.mvaRepo
      .createQueryBuilder('mva')
      .innerJoinAndSelect('mva.media', 'media')
      .where('mva.key_group_id = :vaultId', { vaultId: dto.vaultId })
      .andWhere('media.is_deleted = false');

    if (dto.yearMonth) {
      qb.andWhere('media.year_month = :yearMonth', { yearMonth: dto.yearMonth });
    }

    if (dto.albumId) {
      qb.innerJoin('album_media', 'am', 'am.media_id = media.id AND am.album_id = :albumId', {
        albumId: dto.albumId,
      });
    }

    // Property path, not the column name: with skip/take plus a join, TypeORM
    // resolves orderBy through entity metadata and crashes on raw column names
    qb.orderBy('media.capturedAt', 'DESC', 'NULLS LAST')
      .skip(skip)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    const likedIds = await this.getLikedMediaIds(
      userId,
      dto.vaultId,
      items.map((mva) => mva.media.id),
    );

    // Generate pre-signed URLs for thumbnails
    const data = await Promise.all(
      items.map(async (mva) => {
        const thumbUrl = await this.storageService.generateDownloadUrl(mva.media.s3KeyThumb);
        return {
          id: mva.media.id,
          mediaType: mva.media.mediaType,
          capturedAt: mva.media.capturedAt,
          yearMonth: mva.media.yearMonth,
          width: mva.media.width,
          height: mva.media.height,
          aspectRatio: mva.media.aspectRatio,
          durationSeconds: mva.media.durationSeconds,
          thumbIv: mva.media.thumbIv,
          encryptedDek: mva.encryptedDek,
          dekNonce: mva.dekNonce,
          encryptedMeta: mva.encryptedMeta,
          metaNonce: mva.metaNonce,
          thumbUrl,
          isLiked: likedIds.has(mva.media.id),
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
      .andWhere('album.key_group_id = :vaultId', { vaultId })
      .andWhere('am.media_id IN (:...mediaIds)', { mediaIds })
      .getRawMany<{ mediaId: string }>();

    return new Set(rows.map((row) => row.mediaId));
  }

  /**
   * Get pre-signed URLs for preview and original tiers.
   */
  async getMediaUrls(userId: string, mediaId: string, vaultId: string): Promise<{
    previewUrl: string;
    originalUrl: string;
    previewIv: string;
    originalIv: string;
  }> {
    const access = await this.vaultService.checkAccess(userId, vaultId);
    if (!access) {
      throw new ForbiddenException('No access to this vault');
    }

    // The media must be in the vault the caller was just checked against;
    // access to one vault must not hand out URLs for another vault's media
    const mva = await this.mvaRepo
      .createQueryBuilder('mva')
      .innerJoinAndSelect('mva.media', 'media')
      .where('mva.media_id = :mediaId', { mediaId })
      .andWhere('mva.key_group_id = :vaultId', { vaultId })
      .andWhere('media.is_deleted = false')
      .getOne();
    if (!mva) {
      throw new NotFoundException('Media not found');
    }
    const media = mva.media;

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
   * Add cross-vault access for a photo.
   * Requires admin on target vault.
   */
  async addVaultAccess(userId: string, mediaId: string, dto: AddVaultAccessDto): Promise<void> {
    const access = await this.vaultService.checkAccess(userId, dto.targetVaultId);
    if (!access || access.permission !== 'admin') {
      throw new ForbiddenException('Admin access required on target vault');
    }

    // Verify media exists
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('Media not found');
    }

    // Check if already exists
    const existing = await this.mvaRepo.findOne({
      where: { mediaId, keyGroupId: dto.targetVaultId },
    });
    if (existing) {
      throw new BadRequestException('Media already accessible from this vault');
    }

    const mva = this.mvaRepo.create({
      mediaId,
      keyGroupId: dto.targetVaultId,
      encryptedDek: dto.encryptedDek,
      dekNonce: dto.dekNonce,
      encryptedMeta: dto.encryptedMeta || null,
      metaNonce: dto.metaNonce || null,
    });
    await this.mvaRepo.save(mva);
  }
}
