import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto, updateOrganizationSchema } from './dto/update-organization.schema';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('me')
  @AdminAuth()
  @ApiOperation({ summary: 'Dados da organização do chamador' })
  getMyOrganization(@TenantOrganizationId() organizationId: string) {
    return this.organizationsService.getById(organizationId);
  }

  @Patch('me')
  @AdminAuth(AdminRole.OWNER)
  @AuditAction('ORGANIZATION_UPDATED')
  @ApiOperation({ summary: 'Atualiza nome/plano da organização (somente OWNER)' })
  updateMyOrganization(
    @TenantOrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(organizationId, body);
  }
}
