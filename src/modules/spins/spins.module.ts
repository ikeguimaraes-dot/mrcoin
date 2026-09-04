import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsModule } from '../wallets/wallets.module';
import { SpinsAdminController } from './spins-admin.controller';
import { SpinsAdminService } from './spins-admin.service';
import { SpinsController } from './spins.controller';
import { SpinsService } from './spins.service';

@Module({
  imports: [LedgerModule, WalletsModule],
  controllers: [SpinsAdminController, SpinsController],
  providers: [SpinsAdminService, SpinsService],
})
export class SpinsModule {}
