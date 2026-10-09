import {
  Injectable, UnauthorizedException, ConflictException,
  BadRequestException, Logger, ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../user/entities/user.entity';
import { RefreshToken } from '../user/entities/refresh-token.entity';
import { InviteCode } from '../vault/entities/invite-code.entity';
import { UserVaultAccess } from '../vault/entities/user-vault-access.entity';
import { JwtPayload, UserRole, VaultPermission } from '../../common/types';
import { MAX_DEVICES } from '../../common/constants';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds: number;
  private readonly maxFailedAttempts = 5;
  private readonly lockoutDurationMinutes = 15;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectRepository(InviteCode) private readonly inviteCodeRepo: Repository<InviteCode>,
    @InjectRepository(UserVaultAccess) private readonly userVaultAccessRepo: Repository<UserVaultAccess>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.saltRounds = parseInt(this.configService.get<string>('HASH_SALT_ROUNDS', '12'), 10);
  }

  /**
   * Register a new device.
   * First device becomes owner. Subsequent devices require invite code.
   */
  async registerDevice(dto: RegisterDeviceDto): Promise<{ message: string }> {
    // Check if device already registered
    const existingUser = await this.userRepo.findOne({
      where: { deviceId: dto.deviceId },
    });
    if (existingUser) {
      throw new ConflictException('Device already registered');
    }

    // Check max devices
    const deviceCount = await this.userRepo.count();
    if (deviceCount >= MAX_DEVICES) {
      throw new BadRequestException(`Maximum of ${MAX_DEVICES} devices reached`);
    }

    // Determine role
    let role = UserRole.VIEWER;
    let vaultId: string | null = null;

    if (deviceCount === 0) {
      // First device = owner
      role = UserRole.OWNER;
    } else {
      // Subsequent devices need invite code
      if (!dto.inviteCode) {
        throw new BadRequestException('Invite code required for device registration');
      }

      const inviteCodeHash = crypto
        .createHash('sha256')
        .update(dto.inviteCode)
        .digest('hex');

      const invite = await this.inviteCodeRepo.findOne({
        where: {
          codeHash: inviteCodeHash,
          isUsed: false,
          expiresAt: MoreThan(new Date()),
        },
      });

      if (!invite) {
        throw new BadRequestException('Invalid or expired invite code');
      }

      vaultId = invite.keyGroupId;

      // Mark invite as used
      invite.isUsed = true;
      await this.inviteCodeRepo.save(invite);
    }

    // Hash password with bcrypt (auto-generates salt)
    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    // Create user
    const user = this.userRepo.create({
      name: dto.name,
      deviceId: dto.deviceId,
      passwordHash,
      role,
    });
    const savedUser = await this.userRepo.save(user);

    // If invite code provided, grant vault access
    if (vaultId) {
      const access = this.userVaultAccessRepo.create({
        userId: savedUser.id,
        keyGroupId: vaultId,
        permission: VaultPermission.VIEW,
      });
      await this.userVaultAccessRepo.save(access);
    }

    this.logger.log(`Device registered: ${dto.deviceId}, role: ${role}`);
    return { message: 'Device registered successfully' };
  }

  /**
   * Authenticate with device_id + password.
   * Returns JWT access token + refresh token.
   */
  async login(dto: LoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
    user: { id: string; name: string; role: UserRole };
  }> {
    const user = await this.userRepo.findOne({
      where: { deviceId: dto.deviceId },
    });

    if (!user) {
      // Constant-time response to prevent user enumeration
      await bcrypt.hash('dummy', this.saltRounds);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(
        `Account locked. Try again in ${remainingMinutes} minutes`,
      );
    }

    // Check if active
    if (!user.isActive) {
      throw new ForbiddenException('Device has been deactivated');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      // Increment failed attempts
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= this.maxFailedAttempts) {
        user.lockedUntil = new Date(
          Date.now() + this.lockoutDurationMinutes * 60 * 1000,
        );
        user.failedLoginAttempts = 0;
        this.logger.warn(`Device locked due to failed attempts: ${dto.deviceId}`);
      }
      await this.userRepo.save(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed attempts on success
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await this.userRepo.save(user);

    // Generate tokens
    const payload: JwtPayload = {
      sub: user.id,
      deviceId: user.deviceId,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    // Generate refresh token
    const refreshTokenValue = crypto.randomBytes(64).toString('hex');
    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(refreshTokenValue)
      .digest('hex');

    // Other sessions stay valid so the same account can be signed in on the
    // phone and in a browser at once. Only this account's expired tokens go.
    await this.refreshTokenRepo.delete({ userId: user.id, expiresAt: LessThan(new Date()) });

    // Save new refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const refreshToken = this.refreshTokenRepo.create({
      tokenHash: refreshTokenHash,
      userId: user.id,
      deviceId: user.deviceId,
      expiresAt,
    });
    await this.refreshTokenRepo.save(refreshToken);

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: this.configService.get<string>('jwt.expiration', '15m'),
      user: { id: user.id, name: user.name, role: user.role },
    };
  }

  /**
   * Refresh access token using refresh token.
   * Implements rotation: old refresh token is revoked, new one issued.
   */
  async refreshAccessToken(refreshTokenValue: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
  }> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshTokenValue)
      .digest('hex');

    const storedToken = await this.refreshTokenRepo.findOne({
      where: { tokenHash, isRevoked: false },
      relations: ['user'],
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      if (storedToken) {
        // An expired token ends only its own session; the account's other sessions are untouched
        storedToken.isRevoked = true;
        await this.refreshTokenRepo.save(storedToken);
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = storedToken.user;
    if (!user.isActive) {
      throw new ForbiddenException('Device has been deactivated');
    }

    // Revoke current refresh token (rotation)
    storedToken.isRevoked = true;
    await this.refreshTokenRepo.save(storedToken);

    // Generate new tokens
    const payload: JwtPayload = {
      sub: user.id,
      deviceId: user.deviceId,
      role: user.role,
    };

    const newAccessToken = this.jwtService.sign(payload);
    const newRefreshTokenValue = crypto.randomBytes(64).toString('hex');
    const newRefreshTokenHash = crypto
      .createHash('sha256')
      .update(newRefreshTokenValue)
      .digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const newRefreshToken = this.refreshTokenRepo.create({
      tokenHash: newRefreshTokenHash,
      userId: user.id,
      deviceId: user.deviceId,
      expiresAt,
    });
    await this.refreshTokenRepo.save(newRefreshToken);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshTokenValue,
      expiresIn: this.configService.get<string>('jwt.expiration', '15m'),
    };
  }

  /**
   * Logout - end the session the given refresh token belongs to.
   * Clients that send no token (older app builds) end every session of the device.
   */
  async logout(userId: string, deviceId: string, refreshTokenValue?: string): Promise<void> {
    if (refreshTokenValue) {
      const tokenHash = crypto
        .createHash('sha256')
        .update(refreshTokenValue)
        .digest('hex');
      await this.refreshTokenRepo.update(
        { tokenHash, userId, isRevoked: false },
        { isRevoked: true },
      );
      return;
    }

    await this.refreshTokenRepo.update(
      { userId, deviceId, isRevoked: false },
      { isRevoked: true },
    );
  }
}
