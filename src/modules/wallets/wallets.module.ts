import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

@Module({
  imports: [LedgerModule],
  controllers: [WalletsController, MembershipsController],
  providers: [WalletsService, MembershipsService],
})
export class WalletsModule {}
