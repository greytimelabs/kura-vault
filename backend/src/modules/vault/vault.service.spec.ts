import { ConflictException } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultPermission } from '../../common/types';

function makeService() {
  const keyGroupRepo = {
    findOne: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
  };
  const userVaultAccessRepo = { create: jest.fn((v) => v), save: jest.fn(async (v) => v) };
  const service = new VaultService(keyGroupRepo as any, userVaultAccessRepo as any, {} as any);
  return { service, keyGroupRepo, userVaultAccessRepo };
}

const dto = {
  id: '3f2b8c1e-7a4d-4e9b-9c55-0d1e2f3a4b5c',
  kekSalt: 'c2FsdA==',
  kekVerify: 'dmVyaWZ5',
  kekVerifyNonce: 'bm9uY2U=',
};

describe('VaultService.createVault', () => {
  it('stores the vault under the client-generated id and makes the creator admin', async () => {
    const { service, keyGroupRepo, userVaultAccessRepo } = makeService();
    keyGroupRepo.findOne.mockResolvedValue(null);

    const vault = await service.createVault('user-1', dto);

    expect(vault.id).toBe(dto.id);
    expect(keyGroupRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: dto.id, kekVerify: dto.kekVerify }));
    expect(userVaultAccessRepo.save).toHaveBeenCalledWith({
      userId: 'user-1',
      keyGroupId: dto.id,
      permission: VaultPermission.ADMIN,
    });
  });

  it('rejects an id that is already taken', async () => {
    const { service, keyGroupRepo } = makeService();
    keyGroupRepo.findOne.mockResolvedValue({ id: dto.id });

    await expect(service.createVault('user-1', dto)).rejects.toBeInstanceOf(ConflictException);
    expect(keyGroupRepo.save).not.toHaveBeenCalled();
  });
});
