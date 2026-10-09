import {
  Injectable, BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Vault } from './entities/vault.entity';
import { VaultMember } from './entities/vault-member.entity';
import { AccessService } from '../../common/access/access.service';
import { UserService, publicKeysOf } from '../user/user.service';
import { PublicUserKeys, SharePermission, VaultMemberRole } from '../../common/types';
import { PG_UNIQUE_VIOLATION } from '../../common/constants';
import { AddMemberDto } from '../../common/validation/share.dto';
import { CreateVaultDto } from './dto/create-vault.dto';

export interface VaultView {
  id: string;
  role: VaultMemberRole;
  permission: SharePermission;
  wrappedKey: string;
  kdfSalt: string | null;
  grantSig: string | null;
  granter: PublicUserKeys | null;
  labelEncrypted: string | null;
  labelNonce: string | null;
}

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    @InjectRepository(Vault) private readonly vaultRepo: Repository<Vault>,
    @InjectRepository(VaultMember) private readonly memberRepo: Repository<VaultMember>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accessService: AccessService,
    private readonly userService: UserService,
  ) {}

  /**
   * The caller's own vaults and the ones shared with them, each with the
   * caller's wrapped copy of its key. Nobody is told about any other vault.
   */
  async listVaults(userId: string): Promise<VaultView[]> {
    const members = await this.memberRepo.find({
      where: { userId },
      relations: ['vault'],
      order: { createdAt: 'ASC' },
    });
    const granters = await this.userService.findByIds(
      members.map((m) => m.grantedBy).filter((id): id is string => id !== null),
    );

    return members
      .sort((a, b) => a.vault.sortOrder - b.vault.sortOrder)
      .map((m) => {
        const granter = m.grantedBy ? granters.get(m.grantedBy) : undefined;
        return {
          id: m.vaultId,
          role: m.role,
          permission: m.permission,
          wrappedKey: m.wrappedKey,
          kdfSalt: m.kdfSalt,
          grantSig: m.grantSig,
          granter: granter ? publicKeysOf(granter) : null,
          labelEncrypted: m.vault.labelEncrypted,
          labelNonce: m.vault.labelNonce,
        };
      });
  }

  /** Create a vault. The controller admits only the owner and full-access users. */
  async createVault(userId: string, dto: CreateVaultDto): Promise<{ id: string }> {
    if (Boolean(dto.labelEncrypted) !== Boolean(dto.labelNonce)) {
      throw new BadRequestException('A label needs both its ciphertext and its nonce');
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.insert(Vault, {
          id: dto.id,
          createdBy: userId,
          labelEncrypted: dto.labelEncrypted ?? null,
          labelNonce: dto.labelNonce ?? null,
        });
        await manager.insert(VaultMember, {
          vaultId: dto.id,
          userId,
          role: VaultMemberRole.CREATOR,
          permission: SharePermission.WRITE,
          wrappedKey: dto.wrappedKey,
          kdfSalt: dto.kdfSalt,
        });
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Vault already exists');
      }
      throw err;
    }

    this.logger.log(`Vault created: ${dto.id} by user: ${userId}`);
    return { id: dto.id };
  }

  /** Only the creator may see or change who a vault is shared with. */
  async requireCreator(userId: string, vaultId: string): Promise<void> {
    const access = await this.accessService.forVault(userId, vaultId);
    // A vault the caller cannot see does not exist as far as they are told
    if (!access.canView) {
      throw new NotFoundException('Vault not found');
    }
    if (!access.isCreator) {
      throw new ForbiddenException('Only the creator of a vault can share it');
    }
  }

  async listMembers(userId: string, vaultId: string) {
    await this.requireCreator(userId, vaultId);
    const members = await this.memberRepo.find({
      where: { vaultId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
    return members.map((m) => ({
      userId: m.userId,
      username: m.user.username,
      role: m.role,
      permission: m.permission,
      createdAt: m.createdAt,
    }));
  }

  async addMember(userId: string, vaultId: string, dto: AddMemberDto): Promise<void> {
    await this.requireCreator(userId, vaultId);
    await this.requireShareable(userId, dto.userId);

    const result = await this.memberRepo
      .createQueryBuilder()
      .insert()
      .values({
        vaultId,
        userId: dto.userId,
        role: VaultMemberRole.MEMBER,
        permission: dto.permission,
        wrappedKey: dto.wrappedKey,
        grantedBy: userId,
        grantSig: dto.grantSig,
      })
      .orIgnore()
      .returning('user_id')
      .execute();
    if (result.raw.length === 0) {
      throw new ConflictException('Already shared with this user');
    }
  }

  async updateMember(userId: string, vaultId: string, memberId: string, permission: SharePermission): Promise<void> {
    await this.requireCreator(userId, vaultId);
    const result = await this.memberRepo.update(
      { vaultId, userId: memberId, role: VaultMemberRole.MEMBER },
      { permission },
    );
    if (!result.affected) {
      throw new NotFoundException('Not shared with this user');
    }
  }

  /** Stop sharing. The user's wrapped key is deleted and their next request is refused. */
  async removeMember(userId: string, vaultId: string, memberId: string): Promise<void> {
    await this.requireCreator(userId, vaultId);
    const result = await this.memberRepo.delete({ vaultId, userId: memberId, role: VaultMemberRole.MEMBER });
    if (!result.affected) {
      throw new NotFoundException('Not shared with this user');
    }
  }

  /** A recipient must be another active account whose keys the owner has certified. */
  async requireShareable(sharerId: string, recipientId: string): Promise<void> {
    if (recipientId === sharerId) {
      throw new BadRequestException('You already have access');
    }
    const recipients = await this.userService.shareableUsers([recipientId]);
    if (!recipients.has(recipientId)) {
      throw new NotFoundException('User not found');
    }
  }
}
