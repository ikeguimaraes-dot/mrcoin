import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [LedgerModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
