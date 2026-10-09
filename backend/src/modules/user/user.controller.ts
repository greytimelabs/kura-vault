import {
  Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe,
  Patch, Post, Put, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FullAccessGuard } from '../../common/guards/access-level.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '../../common/types';
import { AcceptInviteDto, CreateInviteDto } from './dto/invite.dto';
import { CertifyUserDto, ChangeKeysDto, ChangePasswordDto, UpdateUserDto } from './dto/user.dto';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async me(@CurrentUser() user: JwtPayload) {
    return this.userService.getMe(user.sub);
  }

  @Put('password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    await this.userService.changePassword(user.sub, dto);
    return { message: 'Password changed' };
  }

  @Put('keys')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changeKeys(@CurrentUser() user: JwtPayload, @Body() dto: ChangeKeysDto) {
    await this.userService.changeKeys(user.sub, dto);
    return { message: 'Keys updated' };
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  // Declared before the `:id` routes so `directory` and `invites` are not parsed as ids

  @Get('directory')
  @UseGuards(FullAccessGuard)
  async directory(@CurrentUser() user: JwtPayload) {
    return this.userService.directory(user.sub);
  }

  @Post('invites')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async createInvite(@CurrentUser() user: JwtPayload, @Body() dto: CreateInviteDto) {
    return this.userService.createInvite(user.sub, dto);
  }

  @Delete('invites/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async deleteInvite(@Param('id', ParseUUIDPipe) inviteId: string) {
    await this.userService.deleteInvite(inviteId);
    return null;
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async list() {
    return this.userService.listUsers();
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.updateUser(user.sub, userId, dto);
  }

  @Put(':id/cert')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async certify(@Param('id', ParseUUIDPipe) userId: string, @Body() dto: CertifyUserDto) {
    await this.userService.certifyUser(userId, dto.keyCert);
    return null;
  }
}

/** Public: reached from an invite link, before the person has an account. */
@Controller('invites')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class InviteController {
  constructor(private readonly userService: UserService) {}

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) inviteId: string, @Headers('x-invite-token') token?: string) {
    if (!token) {
      throw new NotFoundException('Invite not found');
    }
    return this.userService.getInvite(inviteId, token);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.CREATED)
  async accept(@Param('id', ParseUUIDPipe) inviteId: string, @Body() dto: AcceptInviteDto) {
    return this.userService.acceptInvite(inviteId, dto);
  }
}
