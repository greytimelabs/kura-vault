import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRole } from '../../common/types';

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function makeService() {
  const userRepo = { findOne: jest.fn(), save: jest.fn(async (u) => u), count: jest.fn(), create: jest.fn() };
  const refreshTokenRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    create: jest.fn((t) => t),
    save: jest.fn(async (t) => t),
  };
  const jwtService = { sign: jest.fn(() => 'access-token') };
  const configService = { get: jest.fn((_key: string, fallback?: string) => fallback) };

  const service = new AuthService(
    userRepo as any,
    refreshTokenRepo as any,
    {} as any,
    {} as any,
    jwtService as any,
    configService as any,
  );
  return { service, userRepo, refreshTokenRepo };
}

describe('AuthService sessions', () => {
  it('login keeps the account\'s other sessions alive', async () => {
    const { service, userRepo, refreshTokenRepo } = makeService();
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      deviceId: 'device-1',
      name: 'Phone',
      role: UserRole.OWNER,
      isActive: true,
      lockedUntil: null,
      failedLoginAttempts: 0,
      passwordHash: await bcrypt.hash('Correct-Horse-1!', 4),
    });

    const result = await service.login({ deviceId: 'device-1', password: 'Correct-Horse-1!' });

    expect(result.refreshToken).toHaveLength(128);
    expect(refreshTokenRepo.update).not.toHaveBeenCalled();
    // only expired rows are pruned
    expect(refreshTokenRepo.delete).toHaveBeenCalledTimes(1);
    expect(refreshTokenRepo.delete.mock.calls[0][0]).toMatchObject({ userId: 'user-1' });
    expect(refreshTokenRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: sha256(result.refreshToken), userId: 'user-1' }),
    );
  });

  it('logout with a token ends only that session', async () => {
    const { service, refreshTokenRepo } = makeService();

    await service.logout('user-1', 'device-1', 'the-refresh-token');

    expect(refreshTokenRepo.update).toHaveBeenCalledTimes(1);
    expect(refreshTokenRepo.update).toHaveBeenCalledWith(
      { tokenHash: sha256('the-refresh-token'), userId: 'user-1', isRevoked: false },
      { isRevoked: true },
    );
  });

  it('logout without a token ends every session of the device', async () => {
    const { service, refreshTokenRepo } = makeService();

    await service.logout('user-1', 'device-1');

    expect(refreshTokenRepo.update).toHaveBeenCalledWith(
      { userId: 'user-1', deviceId: 'device-1', isRevoked: false },
      { isRevoked: true },
    );
  });

  it('an expired refresh token ends its own session, not the others', async () => {
    const { service, refreshTokenRepo } = makeService();
    const stored = { userId: 'user-1', isRevoked: false, expiresAt: new Date(Date.now() - 1000) };
    refreshTokenRepo.findOne.mockResolvedValue(stored);

    await expect(service.refreshAccessToken('stale')).rejects.toBeInstanceOf(UnauthorizedException);

    expect(refreshTokenRepo.update).not.toHaveBeenCalled();
    expect(refreshTokenRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isRevoked: true }));
  });

  it('refresh rotates: the used token is revoked and a new one issued', async () => {
    const { service, refreshTokenRepo } = makeService();
    const stored = {
      userId: 'user-1',
      isRevoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', deviceId: 'device-1', role: UserRole.VIEWER, isActive: true },
    };
    refreshTokenRepo.findOne.mockResolvedValue(stored);

    const result = await service.refreshAccessToken('current');

    expect(stored.isRevoked).toBe(true);
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).not.toBe('current');
  });
});
