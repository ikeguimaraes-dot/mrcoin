import { Module } from '@nestjs/common';
import { AsaasClient } from './asaas.client';
import { BillingService } from './billing.service';

@Module({
  providers: [AsaasClient, BillingService],
  exports: [BillingService],
})
export class BillingModule {}
