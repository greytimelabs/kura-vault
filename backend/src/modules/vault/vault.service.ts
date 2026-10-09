import { Injectable, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { KeyGroup } from './entities/key-group.entity';
import { UserVaultAccess } from './entities/user-vault-access.entity';
import { InviteCode } from './entities/invite-code.entity';
import { VaultPermission } from '../../common/types';
import { INVITE_CODE_EXPIRY_HOURS, INVITE_CODE_LENGTH } from '../../common/constants';
import { CreateVaultDto } from './dto/create-vault.dto';

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    @InjectRepository(KeyGroup) private readonly keyGroupRepo: Repository<KeyGroup>,
    @InjectRepository(UserVaultAccess) private readonly userVaultAccessRepo: Repository<UserVaultAccess>,
    @InjectRepository(InviteCode) private readonly inviteCodeRepo: Repository<InviteCode>,
  ) {}

  /**
   * List all vaults - returns only id, salt, and verification data.
   * Clients try each vault to see which passphrase matches.
   */
  async listVaults(): Promise<Array<{
    id: string;
    kekSalt: string;
    kekVerify: string;
    kekVerifyNonce: string;
    labelEncrypted: string | null;
    labelNonce: string | null;
  }>> {
    const vaults = await this.keyGroupRepo.find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return vaults.map((v) => ({
      id: v.id,
      kekSalt: v.kekSalt,
      kekVerify: v.kekVerify,
      kekVerifyNonce: v.kekVerifyNonce,
      labelEncrypted: v.labelEncrypted,
      labelNonce: v.labelNonce,
    }));
  }

  /**
   * Create a new vault. Owner only.
   * Client sends the vault id, kek_salt, kek_verify (that id encrypted with the KEK), and encrypted label.
   */
  async createVault(userId: string, dto: CreateVaultDto): Promise<KeyGroup> {
    const existing = await this.keyGroupRepo.findOne({ where: { id: dto.id } });
    if (existing) {
      throw new ConflictException('Vault already exists');
    }

    const vault = this.keyGroupRepo.create({
      id: dto.id,
      kekSalt: dto.kekSalt,
      kekVerify: dto.kekVerify,
      kekVerifyNonce: dto.kekVerifyNonce,
      labelEncrypted: dto.labelEncrypted || null,
      labelNonce: dto.labelNonce || null,
    });
    const savedVault = await this.keyGroupRepo.save(vault);

    // Grant admin access to creator
    const access = this.userVaultAccessRepo.create({
      userId,
      keyGroupId: savedVault.id,
      permission: VaultPermission.ADMIN,
    });
    await this.userVaultAccessRepo.save(access);

    this.logger.log(`Vault created: ${savedVault.id} by user: ${userId}`);
    return savedVault;
  }

  /**
   * Generate invite code for a vault.
   * Returns the plaintext code (shown to user once).
   */
  async generateInviteCode(userId: string, vaultId: string): Promise<{ code: string; expiresAt: Date }> {
    // Verify user has admin access to this vault
    const access = await this.userVaultAccessRepo.findOne({
      where: { userId, keyGroupId: vaultId, permission: VaultPermission.ADMIN },
    });
    if (!access) {
      throw new ForbiddenException('Admin access required to generate invite codes');
    }

    const code = crypto.randomBytes(INVITE_CODE_LENGTH).toString('hex');
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + INVITE_CODE_EXPIRY_HOURS);

    const invite = this.inviteCodeRepo.create({
      codeHash,
      keyGroupId: vaultId,
      expiresAt,
    });
    await this.inviteCodeRepo.save(invite);

    return { code, expiresAt };
  }

  /**
   * Check if user has access to vault.
   */
  async checkAccess(userId: string, vaultId: string): Promise<UserVaultAccess | null> {
    return this.userVaultAccessRepo.findOne({
      where: { userId, keyGroupId: vaultId },
    });
  }

  /**
   * Get vaults accessible by user.
   */
  async getUserVaults(userId: string): Promise<string[]> {
    const accesses = await this.userVaultAccessRepo.find({
      where: { userId },
    });
    return accesses.map((a) => a.keyGroupId);
  }
}
