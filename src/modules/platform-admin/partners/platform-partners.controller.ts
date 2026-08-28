import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PlatformAdminAuth } from '../decorators/platform-admin-auth.decorator';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { PlatformAdminJwtPayload } from '../../../common/guards/jwt-payload.types';
import { PlatformPartnersService } from './platform-partners.service';
import { CreatePartnerDto, createPartnerSchema } from './dto/create-partner.schema';
import { CreatePartnerResponseDto } from './dto/create-partner-response.schema';
import { ListPlatformPartnersQueryDto, listPlatformPartnersQuerySchema } from './dto/list-partners-query.schema';
import { PartnerListResponseDto, PartnerSummaryDto } from './dto/partner-summary.schema';
import { UpdatePlatformPartnerDto, updatePlatformPartnerSchema } from './dto/update-partner.schema';
import { ResetPartnerPasswordResponseDto } from './dto/reset-partner-password-response.schema';

@ApiTags('platform-partners')
@Controller('platform/partners')
export class PlatformPartnersController {
  constructor(private readonly partnersService: PlatformPartnersService) {}

  @Post()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Cria um parceiro + credencial de login do portal (senha devolvida uma única vez)' })
  @ApiOkResponse({ type: CreatePartnerResponseDto })
  create(
    @Body(new ZodValidationPipe(createPartnerSchema)) body: CreatePartnerDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.partnersService.create(platformAdmin.sub, body, request.ip);
  }

  @Get()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Lista todos os parceiros da rede, paginado por cursor' })
  @ApiOkResponse({ type: PartnerListResponseDto })
  list(@Query(new ZodValidationPipe(listPlatformPartnersQuerySchema)) query: ListPlatformPartnersQueryDto) {
    return this.partnersService.list(query);
  }

  @Get(':id')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Detalhe de um parceiro' })
  @ApiOkResponse({ type: PartnerSummaryDto })
  getById(@Param('id') id: string) {
    return this.partnersService.getById(id);
  }

  @Patch(':id')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Atualiza nome/status de um parceiro' })
  @ApiOkResponse({ type: PartnerSummaryDto })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePlatformPartnerSchema)) body: UpdatePlatformPartnerDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.partnersService.update(platformAdmin.sub, id, body, request.ip);
  }

  @Post(':id/reset-password')
  @PlatformAdminAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gera senha nova para o parceiro e revoga sessões ativas (senha devolvida uma única vez)',
  })
  @ApiOkResponse({ type: ResetPartnerPasswordResponseDto })
  resetPassword(
    @Param('id') id: string,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.partnersService.resetPassword(platformAdmin.sub, id, request.ip);
  }
}
