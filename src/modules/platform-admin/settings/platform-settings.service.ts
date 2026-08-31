import { Injectable } from '@nestjs/common';
import { ConversionRateService } from '../../settings/conversion-rate.service';
import { PlatformAdminAuditService } from '../platform-admin-audit.service';
import { UpdateConversionRateInput } from './dto/update-conversion-rate.schema';

export interface ConversionRateSummary {
  coinsPerReal: number;
  effectiveSince: Date;
}

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly conversionRateService: ConversionRateService,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  async getConversionRate(): Promise<ConversionRateSummary> {
    const rate = await this.conversionRateService.getCurrentRate();
    return { coinsPerReal: rate.coinsPerRealScaled / 100, effectiveSince: rate.createdAt };
  }

  async updateConversionRate(
    platformAdminId: string,
    input: UpdateConversionRateInput,
    ip: string | undefined,
  ): Promise<ConversionRateSummary> {
    const previous = await this.conversionRateService.getCurrentRate();
    const coinsPerRealScaled = Math.round(input.coinsPerReal * 100);

    const updated = await this.conversionRateService.setRate(coinsPerRealScaled);

    await this.auditService.record({
      platformAdminId,
      action: 'CONVERSION_RATE_UPDATED',
      payload: {
        previousCoinsPerReal: previous.coinsPerRealScaled / 100,
        newCoinsPerReal: coinsPerRealScaled / 100,
      },
      ip,
    });

    return { coinsPerReal: updated.coinsPerRealScaled / 100, effectiveSince: updated.createdAt };
  }
}
