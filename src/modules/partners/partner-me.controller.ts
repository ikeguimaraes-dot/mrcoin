import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PartnerJwtGuard } from '../../common/guards/partner-jwt.guard';
import { CurrentPartner } from '../../common/decorators/current-partner.decorator';
import { PartnerJwtPayload } from '../../common/guards/jwt-payload.types';
import { PartnersService } from './partners.service';
import { PartnerProfileResponseDto } from './dto/partner-profile-response.schema';

/**
 * Rota literal ('me') — precisa ser registrada ANTES de PartnersController no
 * PartnersModule.controllers, senão GET /partners/me cai na rota :id de PartnersController
 * (Express resolve pela ordem de registro; :id combina com qualquer segmento, inclusive
 * "me"). Ver comentário no module.
 */
@ApiTags('partners')
@Controller('partners')
@UseGuards(PartnerJwtGuard)
export class PartnerMeController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Perfil do parceiro autenticado no portal' })
  @ApiOkResponse({ type: PartnerProfileResponseDto })
  me(@CurrentPartner() partner: PartnerJwtPayload) {
    return this.partnersService.getMe(partner.sub);
  }
}
