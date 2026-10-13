import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AlbumService } from './album.service';
import { AlbumKind } from '../../common/types';

const NONE = { canView: false, canWrite: false, isCreator: false, viaVault: false };
const VAULT_WRITE = { canView: true, canWrite: true, isCreator: false, viaVault: true };
const VAULT_VIEW = { canView: true, canWrite: false, isCreator: false, viaVault: true };
const ALBUM_WRITE = { canView: true, canWrite: true, isCreator: false, viaVault: false };

function makeService(options: { album?: unknown; stranded?: number } = {}) {
  const albumRepo = {
    findOne: jest.fn(async () => options.album ?? null),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  const query = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getCount: jest.fn(async () => options.stranded ?? 0),
  };
  const mediaRepo = { createQueryBuilder: jest.fn(() => query) };
  const accessService = { forVault: jest.fn(async () => NONE), forAlbum: jest.fn(async () => NONE) };
  const service = new AlbumService(
    albumRepo as any, {} as any, {} as any, mediaRepo as any, accessService as any, {} as any, {} as any,
  );
  return { service, albumRepo, accessService };
}

const album = { id: 'album-1', vaultId: 'vault-1', kind: AlbumKind.REGULAR, ownerUserId: null };

describe('AlbumService.deleteAlbum', () => {
  it('deletes the album for someone who can write to the vault', async () => {
    const { service, albumRepo, accessService } = makeService({ album });
    accessService.forVault.mockResolvedValue(VAULT_WRITE);
    await service.deleteAlbum('user-1', 'album-1');
    expect(albumRepo.delete).toHaveBeenCalledWith({ id: 'album-1' });
  });

  it('refuses while an item can be decrypted through this album alone', async () => {
    const { service, albumRepo, accessService } = makeService({ album, stranded: 2 });
    accessService.forVault.mockResolvedValue(VAULT_WRITE);
    await expect(service.deleteAlbum('user-1', 'album-1')).rejects.toBeInstanceOf(ConflictException);
    expect(albumRepo.delete).not.toHaveBeenCalled();
  });

  it('refuses a view-only vault member and someone who has only the album', async () => {
    const { service, albumRepo, accessService } = makeService({ album });
    accessService.forVault.mockResolvedValue(VAULT_VIEW);
    await expect(service.deleteAlbum('user-1', 'album-1')).rejects.toBeInstanceOf(ForbiddenException);
    accessService.forVault.mockResolvedValue(NONE);
    accessService.forAlbum.mockResolvedValue(ALBUM_WRITE);
    await expect(service.deleteAlbum('user-1', 'album-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(albumRepo.delete).not.toHaveBeenCalled();
  });

  it('reads as not found for anyone else, and never deletes a Liked album', async () => {
    const hidden = makeService({ album });
    await expect(hidden.service.deleteAlbum('user-9', 'album-1')).rejects.toBeInstanceOf(NotFoundException);

    const liked = makeService({ album: { ...album, kind: AlbumKind.LIKED, ownerUserId: 'user-1' } });
    liked.accessService.forVault.mockResolvedValue(VAULT_WRITE);
    await expect(liked.service.deleteAlbum('user-1', 'album-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(liked.albumRepo.delete).not.toHaveBeenCalled();
  });
});
