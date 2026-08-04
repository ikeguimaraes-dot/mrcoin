import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { PartnerJwtPayload } from '../guards/jwt-payload.types';

export const CurrentPartner = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PartnerJwtPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.partner;
  },
);
