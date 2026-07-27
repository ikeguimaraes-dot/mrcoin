import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { UserJwtPayload } from '../guards/jwt-payload.types';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UserJwtPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user;
  },
);
