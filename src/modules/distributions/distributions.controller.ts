import { BadRequestException, Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminJwtPayload } from '../../common/guards/jwt-payload.types';
import { DistributionsService } from './distributions.service';
import { CreateDistributionInput, createDistributionSchema } from './dto/create-distribution.schema';

@ApiTags('distributions')
@Controller('admin/distributions')
export class DistributionsController {
  constructor(private readonly distributionsService: DistributionsService) {}

  @Post()
  @AdminAuth(AdminRole.OWNER, AdminRole.MANAGER)
  @AuditAction('DISTRIBUTION_CREATED')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Credita coins pra um CPF, consumindo o lote que expira primeiro (OWNER/MANAGER)' })
  createDistribution(
    @TenantOrganizationId() organizationId: string,
    @CurrentAdmin() admin: AdminJwtPayload,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createDistributionSchema)) body: CreateDistributionInput,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Header Idempotency-Key é obrigatório.',
      });
    }

    return this.distributionsService.distributeIndividual(organizationId, admin.sub, body, idempotencyKey);
  }
}
