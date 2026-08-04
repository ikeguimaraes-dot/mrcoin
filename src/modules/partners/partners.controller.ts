import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PartnersService } from './partners.service';
import { ListPartnersQueryDto, listPartnersQuerySchema } from './dto/list-partners-query.schema';
import { ListPartnersCatalogResponseDto, PartnerCatalogResponseDto } from './dto/partner-catalog-response.schema';

@ApiTags('partners')
@Controller('partners')
@UseGuards(UserJwtGuard)
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo de parceiros ativos da rede de resgate' })
  @ApiOkResponse({ type: ListPartnersCatalogResponseDto })
  list(@Query(new ZodValidationPipe(listPartnersQuerySchema)) query: ListPartnersQueryDto) {
    return this.partnersService.listCatalog(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um parceiro ativo do catálogo' })
  @ApiOkResponse({ type: PartnerCatalogResponseDto })
  getById(@Param('id') id: string) {
    return this.partnersService.getCatalogById(id);
  }
}
