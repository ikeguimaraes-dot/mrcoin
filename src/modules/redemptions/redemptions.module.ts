import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsModule } from '../wallets/wallets.module';
import { UsersModule } from '../users/users.module';
import { RedemptionsController } from './redemptions.controller';
import { PartnerRedemptionsController } from './partner-redemptions.controller';
import { RedemptionsService } from './redemptions.service';

@Module({
  imports: [LedgerModule, WalletsModule, UsersModule],
  controllers: [RedemptionsController, PartnerRedemptionsController],
  providers: [RedemptionsService],
  exports: [RedemptionsService],
})
export class RedemptionsModule {}
