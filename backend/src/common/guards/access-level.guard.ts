import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AccessLevel, JwtPayload, UserRole } from '../types';

/** Lets through the owner and full-access users: the accounts that may hold vaults of their own. */
@Injectable()
export class FullAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as JwtPayload | undefined;
    if (!user || (user.role !== UserRole.OWNER && user.accessLevel !== AccessLevel.FULL)) {
      throw new ForbiddenException('Your account cannot do this');
    }
    return true;
  }
}
