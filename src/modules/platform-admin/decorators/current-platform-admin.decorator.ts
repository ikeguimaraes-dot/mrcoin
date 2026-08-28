import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { PlatformAdminJwtPayload } from '../../../common/guards/jwt-payload.types';

export const CurrentPlatformAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformAdminJwtPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.platformAdmin;
  },
);
