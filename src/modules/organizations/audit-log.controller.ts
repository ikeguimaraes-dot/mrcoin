import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto, auditLogQuerySchema } from './dto/audit-log-query.schema';

@ApiTags('organizations')
@Controller('organizations/audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @AdminAuth(AdminRole.MANAGER)
  @ApiOperation({ summary: 'Consulta o audit log da organização do chamador, com filtros' })
  list(
    @TenantOrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQueryDto,
  ) {
    return this.auditLogService.list(organizationId, query);
  }
}
