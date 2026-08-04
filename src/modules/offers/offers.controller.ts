import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OffersService } from './offers.service';
import { ListOffersQueryDto, listOffersQuerySchema } from './dto/list-offers-query.schema';
import { ListOffersCatalogResponseDto, OfferCatalogResponseDto } from './dto/offer-catalog-response.schema';

@ApiTags('offers')
@Controller('offers')
@UseGuards(UserJwtGuard)
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo de ofertas disponíveis — filtro opcional por parceiro (?partnerId=)' })
  @ApiOkResponse({ type: ListOffersCatalogResponseDto })
  list(@Query(new ZodValidationPipe(listOffersQuerySchema)) query: ListOffersQueryDto) {
    return this.offersService.listCatalog(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma oferta disponível' })
  @ApiOkResponse({ type: OfferCatalogResponseDto })
  getById(@Param('id') id: string) {
    return this.offersService.getCatalogById(id);
  }
}
