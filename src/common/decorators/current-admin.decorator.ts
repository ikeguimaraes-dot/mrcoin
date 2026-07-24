import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AdminJwtPayload } from '../guards/jwt-payload.types';

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminJwtPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.admin;
  },
);
