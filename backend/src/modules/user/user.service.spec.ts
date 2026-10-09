import * as crypto from 'crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { UserInvite } from './entities/user-invite.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { VaultMember } from '../vault/entities/vault-member.entity';
import { AlbumMember } from '../album/entities/album-member.entity';
import { AccessLevel, UserRole, UserStatus, VaultMemberRole } from '../../common/types';

function makeService() {
  const manager = {
    save: jest.fn(),
    update: jest.fn(async () => ({ affected: 1 })),
    delete: jest.fn(),
    insert: jest.fn(),
  };
  const userRepo = {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    save: jest.fn(async (u) => u),
    exists: jest.fn(async () => false),
    count: jest.fn(async () => 1),
  };
  const inviteRepo = {
    findOne: jest.fn(),
    delete: jest.fn(async () => ({ affected: 1 })),
    count: jest.fn(async () => 0),
    create: jest.fn((v) => v),
    insert: jest.fn(),
  };
  const dataSource = { transaction: jest.fn(async (work: (m: typeof manager) => Promise<void>) => work(manager)) };
  const authService = { hashPassword: jest.fn(async () => 'hash'), revokeAllSessions: jest.fn(), verifyPassword: jest.fn() };
  const service = new UserService(userRepo as any, inviteRepo as any, dataSource as any, authService as any);
  return { service, manager, userRepo, inviteRepo, authService };
}

const member = () => ({
  id: 'user-2',
  username: 'mira.k',
  role: UserRole.MEMBER,
  accessLevel: AccessLevel.LIMITED,
  status: UserStatus.ACTIVE,
});

describe('UserService.updateUser', () => {
  it('restricting ends every session and deletes every key shared with the user, in one transaction', async () => {
    const { service, manager, userRepo } = makeService();
    userRepo.findOne.mockResolvedValue(member());

    const result = await service.updateUser('owner-1', 'user-2', { status: UserStatus.RESTRICTED });

    expect(result.status).toBe(UserStatus.RESTRICTED);
    expect(manager.save).toHaveBeenCalledWith(User, expect.objectContaining({ status: UserStatus.RESTRICTED }));
    expect(manager.update).toHaveBeenCalledWith(RefreshToken, { userId: 'user-2', isRevoked: false }, { isRevoked: true });
    // Vaults the user created themselves are left alone; everything shared to them goes
    expect(manager.delete).toHaveBeenCalledWith(VaultMember, { userId: 'user-2', role: VaultMemberRole.MEMBER });
    expect(manager.delete).toHaveBeenCalledWith(AlbumMember, { userId: 'user-2' });
  });

  it('lifting a restriction restores sign-in only', async () => {
    const { service, manager, userRepo } = makeService();
    userRepo.findOne.mockResolvedValue({ ...member(), status: UserStatus.RESTRICTED });

    const result = await service.updateUser('owner-1', 'user-2', { status: UserStatus.ACTIVE });

    expect(result.status).toBe(UserStatus.ACTIVE);
    expect(manager.delete).not.toHaveBeenCalled();
    expect(userRepo.save).toHaveBeenCalled();
  });

  it('changes the access level without touching sessions or shares', async () => {
    const { service, manager, userRepo } = makeService();
    userRepo.findOne.mockResolvedValue(member());

    const result = await service.updateUser('owner-1', 'user-2', { accessLevel: AccessLevel.FULL });

    expect(result.accessLevel).toBe(AccessLevel.FULL);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('never changes the owner account', async () => {
    const { service, userRepo } = makeService();
    userRepo.findOne.mockResolvedValue({ ...member(), id: 'owner-1', role: UserRole.OWNER });
    await expect(service.updateUser('owner-1', 'owner-1', { status: UserStatus.RESTRICTED })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('UserService invites', () => {
  const token = crypto.randomBytes(32);
  const invite = () => ({
    id: 'invite-1',
    userId: 'user-2',
    username: 'mira.k',
    accessLevel: AccessLevel.LIMITED,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    createdBy: 'owner-1',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null as Date | null,
  });
  const keys = {
    token: token.toString('base64'),
    password: 'Correct-Horse-1!',
    kdfSalt: 'c2FsdA==',
    encryptedPrivateKeys: 'ZW5j',
    privateKeysNonce: 'bm9uY2U=',
    publicEncKey: 'a'.repeat(43) + '=',
    publicSignKey: 'b'.repeat(43) + '=',
    keyBinding: 'YmluZA==',
  };

  it('looks the same for unknown, wrong-token, used and expired invites', async () => {
    const { service, inviteRepo } = makeService();

    inviteRepo.findOne.mockResolvedValue(null);
    await expect(service.acceptInvite('invite-1', keys)).rejects.toBeInstanceOf(NotFoundException);

    inviteRepo.findOne.mockResolvedValue(invite());
    await expect(
      service.acceptInvite('invite-1', { ...keys, token: crypto.randomBytes(32).toString('base64') }),
    ).rejects.toBeInstanceOf(NotFoundException);

    inviteRepo.findOne.mockResolvedValue({ ...invite(), usedAt: new Date() });
    await expect(service.acceptInvite('invite-1', keys)).rejects.toBeInstanceOf(NotFoundException);

    inviteRepo.findOne.mockResolvedValue({ ...invite(), expiresAt: new Date(Date.now() - 1000) });
    await expect(service.acceptInvite('invite-1', keys)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates the account the owner defined, uncertified, and records the key binding', async () => {
    const { service, inviteRepo, manager } = makeService();
    inviteRepo.findOne.mockResolvedValue(invite());

    await expect(service.acceptInvite('invite-1', keys)).resolves.toEqual({ username: 'mira.k' });

    expect(manager.update).toHaveBeenCalledWith(
      UserInvite,
      expect.objectContaining({ id: 'invite-1' }),
      expect.objectContaining({ keyBinding: keys.keyBinding }),
    );
    expect(manager.insert).toHaveBeenCalledWith(
      User,
      expect.objectContaining({
        id: 'user-2',
        username: 'mira.k',
        role: UserRole.MEMBER,
        accessLevel: AccessLevel.LIMITED,
        passwordHash: 'hash',
        publicEncKey: keys.publicEncKey,
        keyCert: null,
      }),
    );
  });

  it('is single use even when two requests race', async () => {
    const { service, inviteRepo, manager } = makeService();
    inviteRepo.findOne.mockResolvedValue(invite());
    manager.update.mockResolvedValue({ affected: 0 });

    await expect(service.acceptInvite('invite-1', keys)).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.insert).not.toHaveBeenCalled();
  });

  it('refuses a username that is already an account', async () => {
    const { service, userRepo, inviteRepo } = makeService();
    userRepo.exists.mockResolvedValue(true);
    await expect(
      service.createInvite('owner-1', {
        id: 'invite-1',
        username: 'mira.k',
        accessLevel: AccessLevel.LIMITED,
        tokenHash: 'a'.repeat(64),
        ownerSecretEncrypted: 'c2VhbGVk',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inviteRepo.insert).not.toHaveBeenCalled();
  });
});
