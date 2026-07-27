import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [LedgerModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
