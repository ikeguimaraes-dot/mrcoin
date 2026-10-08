import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OrganizationValuesService } from './organization-values.service';
import {
  CreateOrganizationValueDto,
  createOrganizationValueSchema,
} from './dto/create-organization-value.schema';
import {
  UpdateOrganizationValueDto,
  updateOrganizationValueSchema,
} from './dto/update-organization-value.schema';
import {
  ListOrganizationValuesQueryDto,
  listOrganizationValuesQuerySchema,
  OrganizationValueListResponseDto,
  OrganizationValueResponseDto,
} from './dto/organization-value-response.schema';

@ApiTags('organization-values')
@Controller('admin/organization-values')
export class OrganizationValuesController {
  constructor(private readonly organizationValuesService: OrganizationValuesService) {}

  @Get()
  @AdminAuth()
  @ApiOperation({
    summary: 'Valores da organização, em ordem — só ativos, salvo includeInactive=true',
  })
  @ApiOkResponse({ type: OrganizationValueListResponseDto })
  list(
    @TenantOrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listOrganizationValuesQuerySchema))
    query: ListOrganizationValuesQueryDto,
  ) {
    return this.organizationValuesService.list(organizationId, query);
  }

  @Post()
  @AdminAuth(AdminRole.OWNER, AdminRole.MANAGER)
  @AuditAction('ORGANIZATION_VALUE_CREATED')
  @ApiOperation({ summary: 'Cria um valor (OWNER/MANAGER) — sem sortOrder, entra no fim da lista' })
  @ApiCreatedResponse({ type: OrganizationValueResponseDto })
  create(
    @TenantOrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(createOrganizationValueSchema)) body: CreateOrganizationValueDto,
  ) {
    return this.organizationValuesService.create(organizationId, body);
  }

  @Patch(':id')
  @AdminAuth(AdminRole.OWNER, AdminRole.MANAGER)
  @AuditAction('ORGANIZATION_VALUE_UPDATED')
  @ApiOperation({ summary: 'Renomeia, reordena, ativa ou desativa um valor (OWNER/MANAGER)' })
  @ApiOkResponse({ type: OrganizationValueResponseDto })
  update(
    @TenantOrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOrganizationValueSchema)) body: UpdateOrganizationValueDto,
  ) {
    return this.organizationValuesService.update(organizationId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminAuth(AdminRole.OWNER, AdminRole.MANAGER)
  @AuditAction('ORGANIZATION_VALUE_DELETED')
  @ApiOperation({
    summary: 'Apaga um valor nunca usado (OWNER/MANAGER) — usado em reconhecimento: 409, desative',
  })
  @ApiNoContentResponse()
  async remove(
    @TenantOrganizationId() organizationId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.organizationValuesService.remove(organizationId, id);
  }
}
