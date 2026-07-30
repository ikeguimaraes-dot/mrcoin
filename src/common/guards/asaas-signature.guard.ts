import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Env } from '../../config/env.schema';
import { timingSafeEqualString } from '../security/timing-safe-equal.util';

const INVALID_SIGNATURE_RESPONSE = { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Assinatura do webhook inválida.' };

/** Verifica o header `asaas-access-token` ANTES de qualquer lógica de negócio (regra do
 * CLAUDE.md pra webhooks recebidos). Roda antes do handler, então nenhum payload de um
 * chamador não autenticado chega no WebhooksService. */
@Injectable()
export class AsaasSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const receivedToken = request.headers['asaas-access-token'];
    const expectedToken = this.config.get('ASAAS_WEBHOOK_SECRET', { infer: true });

    if (typeof receivedToken !== 'string' || !timingSafeEqualString(receivedToken, expectedToken)) {
      throw new UnauthorizedException(INVALID_SIGNATURE_RESPONSE);
    }

    return true;
  }
}
