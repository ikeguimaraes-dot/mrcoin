import { Injectable } from '@nestjs/common';
import { RedemptionsService } from '../../redemptions/redemptions.service';
import { SafeRedemption } from '../../redemptions/safe-redemption.util';
import { PlatformAdminAuditService } from '../platform-admin-audit.service';
import { DeliverRedemptionInput } from './dto/deliver-redemption.schema';

@Injectable()
export class PlatformRedemptionsService {
  constructor(
    private readonly redemptionsService: RedemptionsService,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  async deliver(platformAdminId: string, input: DeliverRedemptionInput, ip: string | undefined): Promise<SafeRedemption> {
    const { redemption, alreadyDelivered } = await this.redemptionsService.deliverByPlatformAdmin(
      platformAdminId,
      input,
    );

    // Não registra audit log num replay idempotente (resgate já estava DELIVERED) — só na
    // transição de verdade.
    if (!alreadyDelivered) {
      await this.auditService.record({
        platformAdminId,
        action: 'REDEMPTION_DELIVERED',
        payload: { redemptionId: redemption.id },
        ip,
      });
    }

    return redemption;
  }
}
