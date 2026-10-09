import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentVault = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return data ? request.vault?.[data] : request.vault;
  },
);
