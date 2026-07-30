import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';

@Module({
  imports: [BillingModule],
  controllers: [BatchesController],
  providers: [BatchesService],
})
export class BatchesModule {}
