import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { JwtPayload, UserStatus } from '../../../common/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret')!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Checked on every request, so restricting a user takes effect immediately
    // and role or access-level changes never wait for a token to expire
    const user = await this.userRepo.findOne({
      where: { id: payload.sub, username: payload.username, status: UserStatus.ACTIVE },
    });

    if (!user) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    return {
      sub: user.id,
      username: user.username,
      role: user.role,
      accessLevel: user.accessLevel,
    };
  }
}
