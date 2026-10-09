import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MediaService } from './media.service';

// uuid ships ESM only, which Jest's CommonJS runtime cannot load; nothing here generates ids
jest.mock('uuid', () => ({ v4: () => 'generated-id' }));

function makeService(mva: unknown) {
  const qb: any = {
    innerJoinAndSelect: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    getOne: jest.fn(async () => mva),
  };
  const mvaRepo = { createQueryBuilder: jest.fn(() => qb) };
  const storageService = { generateDownloadUrl: jest.fn(async (key: string) => `https://s3.test/${key}`) };
  const vaultService = { checkAccess: jest.fn() };
  const service = new MediaService(
    {} as any,
    mvaRepo as any,
    {} as any,
    {} as any,
    storageService as any,
    vaultService as any,
  );
  return { service, qb, storageService, vaultService };
}

describe('MediaService.getMediaUrls', () => {
  it('refuses a vault the caller cannot access', async () => {
    const { service, vaultService } = makeService(null);
    vaultService.checkAccess.mockResolvedValue(null);

    await expect(service.getMediaUrls('user-1', 'media-1', 'vault-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses media that is not in the requested vault and signs nothing', async () => {
    const { service, qb, storageService, vaultService } = makeService(null);
    vaultService.checkAccess.mockResolvedValue({ permission: 'view' });

    await expect(service.getMediaUrls('user-1', 'media-b', 'vault-a')).rejects.toBeInstanceOf(NotFoundException);

    expect(qb.where).toHaveBeenCalledWith('mva.media_id = :mediaId', { mediaId: 'media-b' });
    expect(qb.andWhere).toHaveBeenCalledWith('mva.key_group_id = :vaultId', { vaultId: 'vault-a' });
    expect(storageService.generateDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns URLs and IVs for media in the vault', async () => {
    const { service, vaultService } = makeService({
      media: { s3KeyPreview: 'v/m/preview.enc', s3KeyOriginal: 'v/m/original.enc', previewIv: 'piv', originalIv: 'oiv' },
    });
    vaultService.checkAccess.mockResolvedValue({ permission: 'view' });

    await expect(service.getMediaUrls('user-1', 'media-1', 'vault-a')).resolves.toEqual({
      previewUrl: 'https://s3.test/v/m/preview.enc',
      originalUrl: 'https://s3.test/v/m/original.enc',
      previewIv: 'piv',
      originalIv: 'oiv',
    });
  });
});
