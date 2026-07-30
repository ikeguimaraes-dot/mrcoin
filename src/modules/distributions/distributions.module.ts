import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { DistributionsController } from './distributions.controller';
import { DistributionsService } from './distributions.service';

@Module({
  imports: [LedgerModule],
  controllers: [DistributionsController],
  providers: [DistributionsService],
})
export class DistributionsModule {}
