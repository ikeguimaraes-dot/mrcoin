import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminJwtPayload } from '../../common/guards/jwt-payload.types';
import { requireIdempotencyKey } from '../../common/http/require-idempotency-key.util';
import { SpinsAdminService } from './spins-admin.service';
import { GrantSpinsDto, grantSpinsSchema } from './dto/grant-spins.schema';
import { GrantSpinsResponseDto } from './dto/grant-spins-response.schema';

@ApiTags('spins')
@Controller('admin/spins')
export class SpinsAdminController {
  constructor(private readonly spinsAdminService: SpinsAdminService) {}

  @Post()
  @AdminAuth(AdminRole.OWNER, AdminRole.MANAGER)
  @AuditAction('SPIN_GRANTED')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Concede giros de roleta pra um CPF — reserva o pior caso (1.000 coins/giro) do estoque (OWNER/MANAGER)' })
  @ApiCreatedResponse({ type: GrantSpinsResponseDto })
  grant(
    @TenantOrganizationId() organizationId: string,
    @CurrentAdmin() admin: AdminJwtPayload,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(grantSpinsSchema)) body: GrantSpinsDto,
  ) {
    return this.spinsAdminService.grant(organizationId, admin.sub, body, requireIdempotencyKey(idempotencyKey));
  }
}
