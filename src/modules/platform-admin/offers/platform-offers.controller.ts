import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PlatformAdminAuth } from '../decorators/platform-admin-auth.decorator';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { PlatformAdminJwtPayload } from '../../../common/guards/jwt-payload.types';
import { PlatformOffersService } from './platform-offers.service';
import { CreateOfferDto, createOfferSchema } from './dto/create-offer.schema';
import { ListPlatformOffersQueryDto, listPlatformOffersQuerySchema } from './dto/list-offers-query.schema';
import { OfferListResponseDto, OfferSummaryDto } from './dto/offer-summary.schema';
import { UpdatePlatformOfferDto, updatePlatformOfferSchema } from './dto/update-offer.schema';

@ApiTags('platform-offers')
@Controller('platform/offers')
export class PlatformOffersController {
  constructor(private readonly offersService: PlatformOffersService) {}

  @Post()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Cria uma oferta pra um parceiro existente' })
  @ApiOkResponse({ type: OfferSummaryDto })
  create(
    @Body(new ZodValidationPipe(createOfferSchema)) body: CreateOfferDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.offersService.create(platformAdmin.sub, body, request.ip);
  }

  @Get()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Lista todas as ofertas, qualquer status, paginado por cursor, com filtro opcional por partnerId' })
  @ApiOkResponse({ type: OfferListResponseDto })
  list(@Query(new ZodValidationPipe(listPlatformOffersQuerySchema)) query: ListPlatformOffersQueryDto) {
    return this.offersService.list(query);
  }

  @Get(':id')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Detalhe de uma oferta' })
  @ApiOkResponse({ type: OfferSummaryDto })
  getById(@Param('id') id: string) {
    return this.offersService.getById(id);
  }

  @Patch(':id')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Atualiza título/descrição/custo/imagem/status de uma oferta' })
  @ApiOkResponse({ type: OfferSummaryDto })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePlatformOfferSchema)) body: UpdatePlatformOfferDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.offersService.update(platformAdmin.sub, id, body, request.ip);
  }
}
