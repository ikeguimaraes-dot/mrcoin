import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsModule } from '../wallets/wallets.module';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { CourseCreditService } from './course-credit.service';

@Module({
  imports: [LedgerModule, WalletsModule],
  controllers: [CoursesController],
  providers: [CoursesService, CourseCreditService],
  exports: [CourseCreditService],
})
export class CoursesModule {}
