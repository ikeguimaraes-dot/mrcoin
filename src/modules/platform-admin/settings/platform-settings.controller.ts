import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PlatformAdminAuth } from '../decorators/platform-admin-auth.decorator';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { PlatformAdminJwtPayload } from '../../../common/guards/jwt-payload.types';
import { PlatformSettingsService } from './platform-settings.service';
import { ConversionRateResponseDto } from './dto/conversion-rate-response.schema';
import { UpdateConversionRateDto, updateConversionRateSchema } from './dto/update-conversion-rate.schema';

@ApiTags('platform-settings')
@Controller('platform/settings')
export class PlatformSettingsController {
  constructor(private readonly settingsService: PlatformSettingsService) {}

  @Get('conversion-rate')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Taxa global de conversão R$→coins vigente' })
  @ApiOkResponse({ type: ConversionRateResponseDto })
  getConversionRate() {
    return this.settingsService.getConversionRate();
  }

  @Patch('conversion-rate')
  @PlatformAdminAuth()
  @ApiOperation({
    summary:
      'Define uma nova taxa de conversão R$→coins — afeta só lotes criados a partir de agora, ' +
      'nunca lotes já existentes',
  })
  @ApiOkResponse({ type: ConversionRateResponseDto })
  updateConversionRate(
    @Body(new ZodValidationPipe(updateConversionRateSchema)) body: UpdateConversionRateDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.settingsService.updateConversionRate(platformAdmin.sub, body, request.ip);
  }
}
