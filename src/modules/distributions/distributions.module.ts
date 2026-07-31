import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { DistributionsController } from './distributions.controller';
import { DistributionsService } from './distributions.service';
import { DistributionsCsvService } from './distributions-csv.service';
import { ProcessDistributionProcessor } from './process-distribution.processor';
import { QUEUE_PROCESS_DISTRIBUTION } from './distributions.constants';

@Module({
  imports: [LedgerModule, BullModule.registerQueue({ name: QUEUE_PROCESS_DISTRIBUTION })],
  controllers: [DistributionsController],
  providers: [DistributionsService, DistributionsCsvService, ProcessDistributionProcessor],
})
export class DistributionsModule {}
