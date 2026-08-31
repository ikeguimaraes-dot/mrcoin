import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { SettingsModule } from '../settings/settings.module';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';

@Module({
  imports: [BillingModule, SettingsModule],
  controllers: [BatchesController],
  providers: [BatchesService],
})
export class BatchesModule {}
