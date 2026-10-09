import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MediaService } from './media.service';
import { AlbumKind } from '../../common/types';

const NONE = { canView: false, canWrite: false, isCreator: false, viaVault: false };
const VAULT_WRITE = { canView: true, canWrite: true, isCreator: false, viaVault: true };
const VAULT_VIEW = { canView: true, canWrite: false, isCreator: false, viaVault: true };
const ALBUM_WRITE = { canView: true, canWrite: true, isCreator: false, viaVault: false };
const ALBUM_VIEW = { canView: true, canWrite: false, isCreator: false, viaVault: false };

const album = { id: 'album-1', vaultId: 'vault-1', kind: AlbumKind.REGULAR, ownerUserId: null };

function makeService(options: { media?: unknown; album?: unknown } = {}) {
  const manager = { insert: jest.fn(), increment: jest.fn() };
  const mediaRepo = { findOne: jest.fn(async () => options.media ?? null), update: jest.fn() };
  const albumRepo = { findOne: jest.fn(async () => options.album ?? null) };
  const dataSource = { transaction: jest.fn(async (work: (m: typeof manager) => Promise<void>) => work(manager)) };
  const storageService = {
    generateDownloadUrl: jest.fn(async (key: string) => `https://s3.test/${key}`),
    generateUploadUrl: jest.fn(async (key: string) => `https://s3.test/put/${key}`),
    generateS3Key: jest.fn((vaultId: string, mediaId: string, tier: string) => `${vaultId}/${mediaId}/${tier}.enc`),
  };
  const accessService = {
    forVault: jest.fn(async () => NONE),
    forAlbum: jest.fn(async () => NONE),
    forMedia: jest.fn(async () => NONE),
  };
  const service = new MediaService(
    mediaRepo as any,
    albumRepo as any,
    {} as any,
    dataSource as any,
    storageService as any,
    accessService as any,
  );
  return { service, manager, mediaRepo, storageService, accessService };
}

const upload = {
  mediaId: '9b2d5e1a-3c4f-4a6b-8d7e-1f2a3b4c5d6e',
  vaultId: 'vault-1',
  thumbIv: 'aXY=',
  previewIv: 'aXY=',
  originalIv: 'aXY=',
};
const vaultKey = { keyWrappedVault: 'd3JhcA==', keyNonceVault: 'bm9uY2U=' };
const albumKey = { keyWrappedAlbum: 'd3JhcA==', keyNonceAlbum: 'bm9uY2U=' };

describe('MediaService.getMediaUrls', () => {
  it('reads as not found for an item the caller cannot see, and signs nothing', async () => {
    const { service, storageService } = makeService({ media: { id: 'media-1', vaultId: 'vault-1' } });
    await expect(service.getMediaUrls('user-1', 'media-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(storageService.generateDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns URLs and IVs for an item the caller can see', async () => {
    const { service, accessService } = makeService({
      media: { s3KeyPreview: 'v/m/preview.enc', s3KeyOriginal: 'v/m/original.enc', previewIv: 'piv', originalIv: 'oiv' },
    });
    accessService.forMedia.mockResolvedValue(ALBUM_VIEW);
    await expect(service.getMediaUrls('user-1', 'media-1')).resolves.toEqual({
      previewUrl: 'https://s3.test/v/m/preview.enc',
      originalUrl: 'https://s3.test/v/m/original.enc',
      previewIv: 'piv',
      originalIv: 'oiv',
    });
  });
});

describe('MediaService uploads', () => {
  it('refuses a vault the caller can only view', async () => {
    const { service, accessService, storageService } = makeService();
    accessService.forVault.mockResolvedValue(VAULT_VIEW);
    await expect(service.initUpload('user-1', { vaultId: 'vault-1', mediaType: 'photo' as any })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.completeUpload('user-1', { ...upload, ...vaultKey })).rejects.toBeInstanceOf(ForbiddenException);
    expect(storageService.generateUploadUrl).not.toHaveBeenCalled();
  });

  it('refuses an album the caller can only view, and hides one they cannot see', async () => {
    const { service, accessService } = makeService({ album });
    accessService.forAlbum.mockResolvedValue(ALBUM_VIEW);
    await expect(
      service.completeUpload('user-1', { ...upload, albumId: 'album-1', ...albumKey }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    accessService.forAlbum.mockResolvedValue(NONE);
    await expect(
      service.completeUpload('user-1', { ...upload, albumId: 'album-1', ...albumKey }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an album that belongs to another vault', async () => {
    const { service, accessService } = makeService({ album: { ...album, vaultId: 'vault-2' } });
    accessService.forVault.mockResolvedValue(VAULT_WRITE);
    await expect(
      service.completeUpload('user-1', { ...upload, albumId: 'album-1', ...vaultKey, ...albumKey }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a vault writer must send the vault-wrapped key', async () => {
    const { service, accessService, manager } = makeService();
    accessService.forVault.mockResolvedValue(VAULT_WRITE);
    await expect(service.completeUpload('user-1', upload)).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.completeUpload('user-1', { ...upload, ...vaultKey })).resolves.toEqual({ id: upload.mediaId });
    expect(manager.insert).toHaveBeenCalledTimes(1);
    expect(manager.insert.mock.calls[0][1]).toMatchObject({
      id: upload.mediaId,
      vaultId: 'vault-1',
      uploadedBy: 'user-1',
      keyWrappedVault: vaultKey.keyWrappedVault,
      s3KeyOriginal: `vault-1/${upload.mediaId}/original.enc`,
    });
  });

  it('an album-only writer uploads into the album with the album-wrapped key and no vault key', async () => {
    const { service, accessService, manager } = makeService({ album });
    accessService.forAlbum.mockResolvedValue(ALBUM_WRITE);

    // They cannot hold the vault key, so a "vault-wrapped" key from them is refused
    await expect(
      service.completeUpload('user-1', { ...upload, albumId: 'album-1', ...vaultKey, ...albumKey }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // And they cannot upload outside the album
    await expect(service.completeUpload('user-1', { ...upload, ...albumKey })).rejects.toBeInstanceOf(ForbiddenException);

    await service.completeUpload('user-1', { ...upload, albumId: 'album-1', ...albumKey });
    expect(manager.insert.mock.calls[0][1]).toMatchObject({ keyWrappedVault: null });
    expect(manager.insert.mock.calls[1][1]).toMatchObject({
      albumId: 'album-1',
      mediaId: upload.mediaId,
      keyWrapped: albumKey.keyWrappedAlbum,
    });
    expect(manager.increment).toHaveBeenCalledTimes(1);
  });

  it('never overwrites an item that already exists', async () => {
    const { service, accessService, manager } = makeService();
    accessService.forVault.mockResolvedValue(VAULT_WRITE);
    const { QueryFailedError } = jest.requireActual('typeorm');
    manager.insert.mockRejectedValue(Object.assign(new QueryFailedError('insert', [], new Error('dup')), { code: '23505' }));
    await expect(service.completeUpload('user-1', { ...upload, ...vaultKey })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MediaService.setVaultKey', () => {
  it('is only for vault members with write access', async () => {
    const { service, accessService, mediaRepo } = makeService({ media: { id: 'media-1', vaultId: 'vault-1' } });
    const dto = { keyWrapped: 'd3JhcA==', keyNonce: 'bm9uY2U=' };

    accessService.forMedia.mockResolvedValue(ALBUM_WRITE);
    await expect(service.setVaultKey('user-1', 'media-1', dto)).rejects.toBeInstanceOf(ForbiddenException);
    accessService.forMedia.mockResolvedValue(VAULT_VIEW);
    await expect(service.setVaultKey('user-1', 'media-1', dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mediaRepo.update).not.toHaveBeenCalled();

    accessService.forMedia.mockResolvedValue(VAULT_WRITE);
    await service.setVaultKey('user-1', 'media-1', dto);
    // Only fills an empty slot
    expect(mediaRepo.update.mock.calls[0][0]).toMatchObject({ id: 'media-1' });
    expect(Object.keys(mediaRepo.update.mock.calls[0][0])).toContain('keyWrappedVault');
  });
});
