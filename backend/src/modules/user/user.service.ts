import {
  Injectable, BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan, Not, QueryFailedError, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { User } from './entities/user.entity';
import { UserInvite } from './entities/user-invite.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { VaultMember } from '../vault/entities/vault-member.entity';
import { AlbumMember } from '../album/entities/album-member.entity';
import { AuthService } from '../auth/auth.service';
import { PublicUserKeys, UserRole, UserStatus, VaultMemberRole } from '../../common/types';
import { INVITE_EXPIRY_HOURS, MAX_USERS, PG_UNIQUE_VIOLATION } from '../../common/constants';
import { AcceptInviteDto, CreateInviteDto } from './dto/invite.dto';
import { ChangeKeysDto, ChangePasswordDto, UpdateUserDto } from './dto/user.dto';

export function publicKeysOf(user: User): PublicUserKeys {
  return {
    userId: user.id,
    username: user.username,
    publicEncKey: user.publicEncKey,
    publicSignKey: user.publicSignKey,
    keyCert: user.keyCert,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserInvite) private readonly inviteRepo: Repository<UserInvite>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly authService: AuthService,
  ) {}

  /** The caller's own account, with the encrypted private keys only they can open. */
  async getMe(userId: string) {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      accessLevel: user.accessLevel,
      kdfSalt: user.kdfSalt,
      encryptedPrivateKeys: user.encryptedPrivateKeys,
      privateKeysNonce: user.privateKeysNonce,
      publicEncKey: user.publicEncKey,
      publicSignKey: user.publicSignKey,
      keyCert: user.keyCert,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.requirePassword(userId, dto.currentPassword);
    user.passwordHash = await this.authService.hashPassword(dto.newPassword);
    await this.userRepo.save(user);
    // Every session ends, this one included: the client signs in again
    await this.authService.revokeAllSessions(userId);
  }

  async changeKeys(userId: string, dto: ChangeKeysDto): Promise<void> {
    const user = await this.requirePassword(userId, dto.currentPassword);
    user.kdfSalt = dto.kdfSalt;
    user.encryptedPrivateKeys = dto.encryptedPrivateKeys;
    user.privateKeysNonce = dto.privateKeysNonce;
    await this.userRepo.save(user);
  }

  private async requirePassword(userId: string, password: string): Promise<User> {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    if (!(await this.authService.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  /** Owner: every account, plus the invitations still open. */
  async listUsers() {
    const [users, invites] = await Promise.all([
      this.userRepo.find({ order: { createdAt: 'ASC' } }),
      this.inviteRepo.find({ order: { createdAt: 'ASC' } }),
    ]);
    const acceptedByUser = new Map(invites.filter((i) => i.usedAt).map((i) => [i.userId, i]));
    const now = new Date();

    return {
      users: users.map((user) => {
        const invite = acceptedByUser.get(user.id);
        return {
          ...publicKeysOf(user),
          role: user.role,
          accessLevel: user.accessLevel,
          status: user.status,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
          // What the owner's client needs to verify the keys before signing them
          verification:
            !user.keyCert && invite?.keyBinding
              ? { inviteId: invite.id, ownerSecretEncrypted: invite.ownerSecretEncrypted, keyBinding: invite.keyBinding }
              : null,
        };
      }),
      invites: invites
        .filter((i) => !i.usedAt)
        .map((i) => ({
          id: i.id,
          username: i.username,
          accessLevel: i.accessLevel,
          expiresAt: i.expiresAt,
          expired: i.expiresAt <= now,
          createdAt: i.createdAt,
        })),
    };
  }

  /** Owner and full-access users: the people something can be shared with. */
  async directory(callerId: string): Promise<PublicUserKeys[]> {
    const users = await this.userRepo.find({
      where: { status: UserStatus.ACTIVE, keyCert: Not(IsNull()), id: Not(callerId) },
      order: { username: 'ASC' },
    });
    return users.map(publicKeysOf);
  }

  async createInvite(ownerId: string, dto: CreateInviteDto) {
    // An expired invitation no longer holds its username
    await this.inviteRepo.delete({ usedAt: IsNull(), expiresAt: LessThan(new Date()) });

    if (await this.userRepo.exists({ where: { username: dto.username } })) {
      throw new ConflictException('Username already taken');
    }
    const [userCount, pending] = await Promise.all([
      this.userRepo.count(),
      this.inviteRepo.count({ where: { usedAt: IsNull() } }),
    ]);
    if (userCount + pending >= MAX_USERS) {
      throw new BadRequestException(`Maximum of ${MAX_USERS} users reached`);
    }

    const invite = this.inviteRepo.create({
      id: dto.id,
      userId: crypto.randomUUID(),
      username: dto.username,
      accessLevel: dto.accessLevel,
      tokenHash: dto.tokenHash.toLowerCase(),
      ownerSecretEncrypted: dto.ownerSecretEncrypted,
      createdBy: ownerId,
      expiresAt: new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000),
    });
    try {
      await this.inviteRepo.insert(invite);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Username already taken');
      }
      throw err;
    }

    this.logger.log(`Invite created for: ${dto.username}`);
    return { id: invite.id, userId: invite.userId, username: invite.username, expiresAt: invite.expiresAt };
  }

  async deleteInvite(inviteId: string): Promise<void> {
    const result = await this.inviteRepo.delete({ id: inviteId, usedAt: IsNull() });
    if (!result.affected) {
      throw new NotFoundException('Invite not found');
    }
  }

  /**
   * Public. Shown to whoever opens an invite link, before they choose their secrets.
   * Unknown, used, expired and wrong-token all look the same.
   */
  async getInvite(inviteId: string, token: string) {
    const invite = await this.findOpenInvite(inviteId, token);
    const owner = await this.userRepo.findOneOrFail({ where: { id: invite.createdBy } });
    return {
      userId: invite.userId,
      username: invite.username,
      accessLevel: invite.accessLevel,
      expiresAt: invite.expiresAt,
      // The client compares this with the key inside the link and refuses a mismatch
      ownerPublicSignKey: owner.publicSignKey,
    };
  }

  /** Public. Turns an invitation into an account. Nothing can be shared with it until the owner certifies its keys. */
  async acceptInvite(inviteId: string, dto: AcceptInviteDto): Promise<{ username: string }> {
    const invite = await this.findOpenInvite(inviteId, dto.token);
    const passwordHash = await this.authService.hashPassword(dto.password);

    try {
      await this.dataSource.transaction(async (manager) => {
        // Single use, even when two requests race
        const claimed = await manager.update(
          UserInvite,
          { id: invite.id, usedAt: IsNull() },
          { usedAt: new Date(), keyBinding: dto.keyBinding },
        );
        if (!claimed.affected) {
          throw new NotFoundException('Invite not found');
        }
        await manager.insert(User, {
          id: invite.userId,
          username: invite.username,
          passwordHash,
          role: UserRole.MEMBER,
          accessLevel: invite.accessLevel,
          status: UserStatus.ACTIVE,
          kdfSalt: dto.kdfSalt,
          encryptedPrivateKeys: dto.encryptedPrivateKeys,
          privateKeysNonce: dto.privateKeysNonce,
          publicEncKey: dto.publicEncKey,
          publicSignKey: dto.publicSignKey,
          keyCert: null,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Username already taken');
      }
      throw err;
    }

    this.logger.log(`Invite accepted: ${invite.username}`);
    return { username: invite.username };
  }

  private async findOpenInvite(inviteId: string, token: string): Promise<UserInvite> {
    const invite = await this.inviteRepo.findOne({ where: { id: inviteId } });
    const presented = crypto.createHash('sha256').update(Buffer.from(token, 'base64')).digest();
    // Compare against something even when there is no such invite
    const expected = Buffer.from(invite?.tokenHash ?? '00'.repeat(32), 'hex');
    const matches = expected.length === presented.length && crypto.timingSafeEqual(expected, presented);
    if (!invite || !matches || invite.usedAt || invite.expiresAt <= new Date()) {
      throw new NotFoundException('Invite not found');
    }
    return invite;
  }

  /**
   * Owner: record the certificate their client produced after verifying the
   * user's keys. The invitation has done its job and is removed.
   */
  async certifyUser(userId: string, keyCert: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.keyCert = keyCert;
    await this.userRepo.save(user);
    await this.inviteRepo.delete({ userId });
  }

  /** Owner: change what a user may do, or cut them off. */
  async updateUser(ownerId: string, userId: string, dto: UpdateUserDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.id === ownerId || user.role === UserRole.OWNER) {
      throw new ForbiddenException('The owner account cannot be changed');
    }

    if (dto.accessLevel !== undefined) {
      user.accessLevel = dto.accessLevel;
    }
    if (dto.status !== undefined && dto.status !== user.status) {
      user.status = dto.status;
      if (dto.status === UserStatus.RESTRICTED) {
        await this.revokeEverythingSharedWith(user);
        return this.summary(user);
      }
    }
    await this.userRepo.save(user);
    return this.summary(user);
  }

  /**
   * Restricting ends every session and deletes every key that was wrapped for
   * the user by someone else, in one transaction. Vaults they created stay,
   * unreachable while they are restricted. Lifting the restriction restores
   * sign-in only: anything shared has to be shared again.
   */
  private async revokeEverythingSharedWith(user: User): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.save(User, user);
      await manager.update(RefreshToken, { userId: user.id, isRevoked: false }, { isRevoked: true });
      await manager.delete(VaultMember, { userId: user.id, role: VaultMemberRole.MEMBER });
      await manager.delete(AlbumMember, { userId: user.id });
    });
    this.logger.warn(`User restricted: ${user.username}`);
  }

  private summary(user: User) {
    return { ...publicKeysOf(user), role: user.role, accessLevel: user.accessLevel, status: user.status };
  }

  /** Active, certified users among `ids`, by id. Used to validate share recipients. */
  async shareableUsers(ids: string[]): Promise<Map<string, User>> {
    if (ids.length === 0) {
      return new Map();
    }
    const users = await this.userRepo.find({
      where: { id: In(ids), status: UserStatus.ACTIVE, keyCert: Not(IsNull()) },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  async findByIds(ids: string[]): Promise<Map<string, User>> {
    if (ids.length === 0) {
      return new Map();
    }
    const users = await this.userRepo.find({ where: { id: In(ids) } });
    return new Map(users.map((u) => [u.id, u]));
  }
}

