import { Injectable, UnauthorizedException, Logger, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../user/entities/user.entity';
import { RefreshToken } from '../user/entities/refresh-token.entity';
import { AccessLevel, JwtPayload, UserRole, UserStatus } from '../../common/types';
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
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.saltRounds = parseInt(this.configService.get<string>('HASH_SALT_ROUNDS', '12'), 10);
  }

  /**
   * Authenticate with username + password.
   * Returns JWT access token + refresh token.
   */
  async login(dto: LoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
    user: { id: string; username: string; role: UserRole; accessLevel: AccessLevel };
  }> {
    const user = await this.userRepo.findOne({
      where: { username: dto.username },
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

    // A restricted account cannot start a session
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account has been deactivated');
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
        this.logger.warn(`Account locked due to failed attempts: ${dto.username}`);
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
      username: user.username,
      role: user.role,
      accessLevel: user.accessLevel,
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
      username: user.username,
      expiresAt,
    });
    await this.refreshTokenRepo.save(refreshToken);

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: this.configService.get<string>('jwt.expiration', '15m'),
      user: { id: user.id, username: user.username, role: user.role, accessLevel: user.accessLevel },
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
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account has been deactivated');
    }

    // Revoke current refresh token (rotation)
    storedToken.isRevoked = true;
    await this.refreshTokenRepo.save(storedToken);

    // Generate new tokens
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      accessLevel: user.accessLevel,
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
      username: user.username,
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
   * Clients that send no token (older app builds) end every session of the user.
   */
  async logout(userId: string, username: string, refreshTokenValue?: string): Promise<void> {
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
      { userId, username, isRevoked: false },
      { isRevoked: true },
    );
  }

  /**
   * End every session of a user: on restriction, and after a password change.
   * With the per-request status check this cuts an account off at once.
   */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.refreshTokenRepo.update({ userId, isRevoked: false }, { isRevoked: true });
  }

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }
}
