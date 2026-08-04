import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PartnerJwtGuard } from '../../common/guards/partner-jwt.guard';
import { RedemptionConfirmRateLimitGuard } from '../../common/guards/redemption-confirm-rate-limit.guard';
import { CurrentPartner } from '../../common/decorators/current-partner.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PartnerJwtPayload } from '../../common/guards/jwt-payload.types';
import { RedemptionsService } from './redemptions.service';
import { ConfirmRedemptionDto, confirmRedemptionSchema } from './dto/confirm-redemption.schema';
import { RedemptionResponseDto } from './dto/redemption-response.schema';

/** Endpoint que o portal do parceiro vai usar (ainda não existe login de parceiro — testado
 * por ora com um JWT type:'partner' assinado direto, mesma técnica dos testes e2e de
 * admin/usuário; ver plano da Sessão 17). */
@ApiTags('redemptions')
@Controller('redemptions')
@UseGuards(PartnerJwtGuard, RedemptionConfirmRateLimitGuard)
export class PartnerRedemptionsController {
  constructor(private readonly redemptionsService: RedemptionsService) {}

  @Post('confirm')
  @ApiOperation({ summary: 'Confirma um resgate (code OU qrPayload) — só aqui o débito acontece' })
  @ApiCreatedResponse({ type: RedemptionResponseDto })
  confirm(
    @CurrentPartner() partner: PartnerJwtPayload,
    @Body(new ZodValidationPipe(confirmRedemptionSchema)) body: ConfirmRedemptionDto,
  ) {
    return this.redemptionsService.confirm(partner.sub, body);
  }
}
