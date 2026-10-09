import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserInvite } from './entities/user-invite.entity';
import { InviteController, MeController, UserController } from './user.controller';
import { UserService } from './user.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken, UserInvite]), AuthModule],
  controllers: [MeController, UserController, InviteController],
  providers: [UserService],
  exports: [TypeOrmModule, UserService],
})
export class UserModule {}
