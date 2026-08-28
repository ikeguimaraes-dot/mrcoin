import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PlatformAdminAuth } from '../decorators/platform-admin-auth.decorator';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { PlatformAdminJwtPayload } from '../../../common/guards/jwt-payload.types';
import { PlatformOrganizationsService } from './platform-organizations.service';
import { CreateOrganizationDto, createOrganizationSchema } from './dto/create-organization.schema';
import { CreateOrganizationResponseDto } from './dto/create-organization-response.schema';
import { ListOrganizationsQueryDto, listOrganizationsQuerySchema } from './dto/list-organizations-query.schema';
import { OrganizationListResponseDto, OrganizationSummaryDto } from './dto/organization-summary.schema';
import {
  UpdatePlatformOrganizationDto,
  updatePlatformOrganizationSchema,
} from './dto/update-organization.schema';

@ApiTags('platform-organizations')
@Controller('platform/organizations')
export class PlatformOrganizationsController {
  constructor(private readonly organizationsService: PlatformOrganizationsService) {}

  @Post()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Cria uma organização cliente + convite de OWNER (mesmo fluxo do bootstrap-owner)' })
  @ApiOkResponse({ type: CreateOrganizationResponseDto })
  create(
    @Body(new ZodValidationPipe(createOrganizationSchema)) body: CreateOrganizationDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.organizationsService.create(platformAdmin.sub, body, request.ip);
  }

  @Get()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Lista todas as organizações da plataforma, paginado por cursor' })
  @ApiOkResponse({ type: OrganizationListResponseDto })
  list(@Query(new ZodValidationPipe(listOrganizationsQuerySchema)) query: ListOrganizationsQueryDto) {
    return this.organizationsService.list(query);
  }

  @Get(':id')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Detalhe de uma organização' })
  @ApiOkResponse({ type: OrganizationSummaryDto })
  getById(@Param('id') id: string) {
    return this.organizationsService.getById(id);
  }

  @Patch(':id')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Atualiza nome/status de uma organização' })
  @ApiOkResponse({ type: OrganizationSummaryDto })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePlatformOrganizationSchema)) body: UpdatePlatformOrganizationDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.organizationsService.update(platformAdmin.sub, id, body, request.ip);
  }
}
