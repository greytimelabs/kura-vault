import { ConflictException, ForbiddenException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { User } from '../user/entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { AccessLevel, UserRole, UserStatus } from '../../common/types';
import { PG_UNIQUE_VIOLATION, SETUP_KEY_BYTES } from '../../common/constants';
import { SetupDto } from './dto/setup.dto';

const sha256 = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest();

/**
 * First-run setup. A server with no owner accepts exactly one thing: creating
 * the owner account, and only from someone holding the setup key. The key comes
 * from SETUP_KEY or is generated and printed at start; it is held hashed in
 * memory, never stored, and stops working the moment an owner exists.
 */
@Injectable()
export class SetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupService.name);
  private setupKeyHash: Buffer | null = null;
  private ownerExists = false;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (await this.hasOwner()) {
      return;
    }
    const configured = this.configService.get<string>('SETUP_KEY');
    const setupKey = configured || crypto.randomBytes(SETUP_KEY_BYTES).toString('base64url');
    this.setupKeyHash = sha256(setupKey);

    if (configured) {
      this.logger.warn('No owner account yet. Create it from a client with the SETUP_KEY you configured.');
      return;
    }
    // The one secret this server ever logs: it is useless once the owner exists,
    // and a new one is generated on every start until then
    this.logger.warn(
      [
        '',
        '================================================================',
        ' No owner account yet. Open a Kura Vault client, choose this',
        ' server and enter this setup key to create the owner account:',
        '',
        `   ${setupKey}`,
        '',
        ' It works once. Restart the server to get a new one.',
        '================================================================',
      ].join('\n'),
    );
  }

  /** True until the owner account has been created. */
  async isSetupRequired(): Promise<boolean> {
    return !(await this.hasOwner());
  }

  private async hasOwner(): Promise<boolean> {
    // An owner never goes away, so a positive answer is remembered
    if (!this.ownerExists) {
      this.ownerExists = await this.userRepo.exists({ where: { role: UserRole.OWNER } });
    }
    return this.ownerExists;
  }

  async createOwner(dto: SetupDto): Promise<{ username: string }> {
    const presented = sha256(dto.setupKey);
    const expected = this.setupKeyHash;
    const matches = expected !== null && crypto.timingSafeEqual(presented, expected);
    // Same answer whether setup is over or the key is wrong
    if (!matches || (await this.hasOwner())) {
      throw new ForbiddenException('Setup is not available');
    }

    const passwordHash = await this.authService.hashPassword(dto.password);
    try {
      await this.userRepo.insert({
        id: dto.id,
        username: dto.username,
        passwordHash,
        role: UserRole.OWNER,
        accessLevel: AccessLevel.FULL,
        status: UserStatus.ACTIVE,
        kdfSalt: dto.kdfSalt,
        encryptedPrivateKeys: dto.encryptedPrivateKeys,
        privateKeysNonce: dto.privateKeysNonce,
        publicEncKey: dto.publicEncKey,
        publicSignKey: dto.publicSignKey,
        keyCert: dto.keyCert,
      });
    } catch (err) {
      // uq_users_single_owner: another request created the owner first
      if (err instanceof QueryFailedError && (err as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Setup is not available');
      }
      throw err;
    }

    this.ownerExists = true;
    this.setupKeyHash = null;
    this.logger.log(`Owner account created: ${dto.username}`);
    return { username: dto.username };
  }
}
