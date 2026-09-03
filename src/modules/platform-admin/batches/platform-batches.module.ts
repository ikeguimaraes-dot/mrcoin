import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin.module';
import { PlatformBatchesController } from './platform-batches.controller';
import { PlatformBatchesService } from './platform-batches.service';

@Module({
  imports: [PlatformAdminModule],
  controllers: [PlatformBatchesController],
  providers: [PlatformBatchesService],
})
export class PlatformBatchesModule {}
