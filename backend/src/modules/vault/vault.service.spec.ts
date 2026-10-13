import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VaultService } from './vault.service';
import { Vault } from './entities/vault.entity';

const NONE = { canView: false, canWrite: false, isCreator: false, viaVault: false };
const MEMBER_WRITE = { canView: true, canWrite: true, isCreator: false, viaVault: true };
const CREATOR = { canView: true, canWrite: true, isCreator: true, viaVault: true };

function makeService(access: typeof NONE) {
  const manager = { delete: jest.fn() };
  const dataSource = { transaction: jest.fn(async (work: (m: typeof manager) => Promise<void>) => work(manager)) };
  const accessService = { forVault: jest.fn(async () => access) };
  const blobPurge = { queueVaults: jest.fn(), purge: jest.fn(async () => undefined) };
  const service = new VaultService({} as any, {} as any, dataSource as any, accessService as any, {} as any, blobPurge as any);
  return { service, manager, blobPurge };
}

describe('VaultService.deleteVault', () => {
  it('lets the creator delete: files queued, then the vault row, then erased', async () => {
    const { service, manager, blobPurge } = makeService(CREATOR);
    await service.deleteVault('user-1', 'vault-1');
    expect(blobPurge.queueVaults).toHaveBeenCalledWith(manager, ['vault-1']);
    expect(manager.delete).toHaveBeenCalledWith(Vault, { id: 'vault-1' });
    expect(blobPurge.queueVaults.mock.invocationCallOrder[0]).toBeLessThan(manager.delete.mock.invocationCallOrder[0]);
    expect(blobPurge.purge).toHaveBeenCalled();
  });

  it('refuses a member, even one with write access', async () => {
    const { service, manager } = makeService(MEMBER_WRITE);
    await expect(service.deleteVault('user-2', 'vault-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('reads as not found for anyone else', async () => {
    const { service, manager } = makeService(NONE);
    await expect(service.deleteVault('user-3', 'vault-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.delete).not.toHaveBeenCalled();
  });
});
