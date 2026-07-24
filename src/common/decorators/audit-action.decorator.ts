import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit_action';

/** Nome estável opcional pro AuditLogInterceptor (ex.: 'ORGANIZATION_UPDATED'). Sem isso,
 * o interceptor deriva `${Controller.name}.${handler.name}`. */
export const AuditAction = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);
