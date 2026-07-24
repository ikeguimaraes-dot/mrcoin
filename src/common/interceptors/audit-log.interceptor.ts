import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { concatMap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { redactSensitiveFields } from '../audit/redact.util';
import { AUDIT_ACTION_KEY } from '../decorators/audit-action.decorator';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Grava AuditLog automaticamente pra toda escrita autenticada de admin (POST/PATCH/PUT/DELETE
 * com `request.admin` já setado pelo AdminJwtGuard, que roda antes dos interceptors). Rotas
 * públicas (sem `request.admin`, ex.: aceite de convite) não são pegas — quem precisar de
 * audit nelas grava manualmente (mesmo padrão já usado em LOGIN_FAILED/REFRESH_TOKEN_REUSE).
 * Falha ao gravar nunca derruba a resposta da operação principal, só loga um warning.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const admin = request.admin;

    if (!admin || !WRITE_METHODS.has(request.method)) {
      return next.handle();
    }

    const action =
      this.reflector.get<string | undefined>(AUDIT_ACTION_KEY, context.getHandler()) ??
      `${context.getClass().name}.${context.getHandler().name}`;
    const payload = redactSensitiveFields({ params: request.params, body: request.body as unknown });
    const ip = request.ip ?? 'unknown';

    return next.handle().pipe(
      concatMap(async (result: unknown) => {
        try {
          await this.prisma.auditLog.create({
            data: {
              organizationId: admin.organizationId,
              actorAdminUserId: admin.sub,
              action,
              payload,
              ip,
            },
          });
        } catch (error) {
          this.logger.warn(`Falha ao gravar AuditLog para ação ${action}: ${String(error)}`);
        }
        return result;
      }),
    );
  }
}
