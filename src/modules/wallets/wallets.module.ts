import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { UsersModule } from '../users/users.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';

@Module({
  imports: [LedgerModule, UsersModule],
  controllers: [WalletsController, MembershipsController, TransferController],
  providers: [WalletsService, MembershipsService, TransferService],
  exports: [WalletsService],
})
export class WalletsModule {}
