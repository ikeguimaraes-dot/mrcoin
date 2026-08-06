import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PartnerJwtGuard } from '../../common/guards/partner-jwt.guard';
import { RedemptionConfirmRateLimitGuard } from '../../common/guards/redemption-confirm-rate-limit.guard';
import { CurrentPartner } from '../../common/decorators/current-partner.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PartnerJwtPayload } from '../../common/guards/jwt-payload.types';
import { RedemptionsService } from './redemptions.service';
import { ConfirmRedemptionDto, confirmRedemptionSchema } from './dto/confirm-redemption.schema';
import { PartnerRedemptionConfirmResponseDto } from './dto/partner-redemption-confirm-response.schema';

/** Endpoint que o portal do parceiro (coins-partner) usa pra confirmar um resgate no balcão. */
@ApiTags('redemptions')
@Controller('redemptions')
@UseGuards(PartnerJwtGuard, RedemptionConfirmRateLimitGuard)
export class PartnerRedemptionsController {
  constructor(private readonly redemptionsService: RedemptionsService) {}

  @Post('confirm')
  @ApiOperation({ summary: 'Confirma um resgate (code OU qrPayload) — só aqui o débito acontece' })
  @ApiCreatedResponse({ type: PartnerRedemptionConfirmResponseDto })
  confirm(
    @CurrentPartner() partner: PartnerJwtPayload,
    @Body(new ZodValidationPipe(confirmRedemptionSchema)) body: ConfirmRedemptionDto,
  ) {
    return this.redemptionsService.confirmForPartner(partner.sub, body);
  }
}
