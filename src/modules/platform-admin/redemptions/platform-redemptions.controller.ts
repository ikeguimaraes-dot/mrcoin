import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PlatformAdminAuth } from '../decorators/platform-admin-auth.decorator';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { PlatformAdminJwtPayload } from '../../../common/guards/jwt-payload.types';
import { RedemptionResponseDto } from '../../redemptions/dto/redemption-response.schema';
import { PlatformRedemptionsService } from './platform-redemptions.service';
import { DeliverRedemptionDto, deliverRedemptionSchema } from './dto/deliver-redemption.schema';

@ApiTags('platform-redemptions')
@Controller('platform/redemptions')
export class PlatformRedemptionsController {
  constructor(private readonly platformRedemptionsService: PlatformRedemptionsService) {}

  @Post('deliver')
  @PlatformAdminAuth()
  @ApiOperation({
    summary:
      'Marca um resgate como entregue (redemptionId, pickupCode ou qrPayload) — sem restrição ' +
      'de parceiro dono, idempotente',
  })
  @ApiOkResponse({ type: RedemptionResponseDto })
  deliver(
    @Body(new ZodValidationPipe(deliverRedemptionSchema)) body: DeliverRedemptionDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.platformRedemptionsService.deliver(platformAdmin.sub, body, request.ip);
  }
}
