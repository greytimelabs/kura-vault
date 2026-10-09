import { ForbiddenException } from '@nestjs/common';
import { SetupService } from './setup.service';
import { AccessLevel, UserRole } from '../../common/types';

const SETUP_KEY = 'a-configured-setup-key-of-enough-length';

function makeService(ownerExists: boolean) {
  const userRepo = { exists: jest.fn(async () => ownerExists), insert: jest.fn() };
  const authService = { hashPassword: jest.fn(async () => 'hash') };
  const configService = { get: jest.fn(() => SETUP_KEY) };
  const service = new SetupService(userRepo as any, authService as any, configService as any);
  return { service, userRepo };
}

const dto = {
  setupKey: SETUP_KEY,
  id: '0b6f3c52-2f0e-4a51-9a3d-6f1c2b7e8d90',
  username: 'owner',
  password: 'Correct-Horse-1!',
  kdfSalt: 'c2FsdA==',
  encryptedPrivateKeys: 'ZW5j',
  privateKeysNonce: 'bm9uY2U=',
  publicEncKey: 'a'.repeat(43) + '=',
  publicSignKey: 'b'.repeat(43) + '=',
  keyCert: 'c'.repeat(86) + '==',
};

describe('SetupService', () => {
  it('creates the owner with the setup key, then stops answering', async () => {
    const { service, userRepo } = makeService(false);
    await service.onApplicationBootstrap();
    expect(await service.isSetupRequired()).toBe(true);

    await expect(service.createOwner(dto)).resolves.toEqual({ username: 'owner' });
    expect(userRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.OWNER, accessLevel: AccessLevel.FULL, passwordHash: 'hash' }),
    );

    expect(await service.isSetupRequired()).toBe(false);
    await expect(service.createOwner(dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('refuses a wrong setup key', async () => {
    const { service, userRepo } = makeService(false);
    await service.onApplicationBootstrap();
    await expect(service.createOwner({ ...dto, setupKey: 'not-the-setup-key-but-long-enough-xx' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(userRepo.insert).not.toHaveBeenCalled();
  });

  it('has no setup key at all once an owner exists', async () => {
    const { service, userRepo } = makeService(true);
    await service.onApplicationBootstrap();
    expect(await service.isSetupRequired()).toBe(false);
    await expect(service.createOwner(dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepo.insert).not.toHaveBeenCalled();
  });
});
