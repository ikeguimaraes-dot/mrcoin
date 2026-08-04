import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PartnersService } from './partners.service';
import { ListPartnersQueryDto, listPartnersQuerySchema } from './dto/list-partners-query.schema';
import { ListPartnersAdminResponseDto, PartnerAdminResponseDto } from './dto/partner-admin-response.schema';

/** Partner é global — sem TenantGuard/organizationId aqui de propósito. Leitura só: sem
 * conceito de "admin de plataforma" hoje, criar/editar Partner via HTTP fica pra quando
 * esse conceito existir (ver plano da Sessão 16). */
@ApiTags('partners')
@Controller('admin/partners')
export class AdminPartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get()
  @AdminAuth()
  @ApiOperation({ summary: 'Lista todos os parceiros da rede, qualquer status (revisão administrativa)' })
  @ApiOkResponse({ type: ListPartnersAdminResponseDto })
  list(@Query(new ZodValidationPipe(listPartnersQuerySchema)) query: ListPartnersQueryDto) {
    return this.partnersService.listForAdmin(query);
  }

  @Get(':id')
  @AdminAuth()
  @ApiOperation({ summary: 'Detalhe de um parceiro, qualquer status' })
  @ApiOkResponse({ type: PartnerAdminResponseDto })
  getById(@Param('id') id: string) {
    return this.partnersService.getForAdmin(id);
  }
}
