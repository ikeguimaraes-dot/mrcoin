import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin.module';
import { RedemptionsModule } from '../../redemptions/redemptions.module';
import { PlatformRedemptionsController } from './platform-redemptions.controller';
import { PlatformRedemptionsService } from './platform-redemptions.service';

@Module({
  imports: [PlatformAdminModule, RedemptionsModule],
  controllers: [PlatformRedemptionsController],
  providers: [PlatformRedemptionsService],
})
export class PlatformRedemptionsModule {}
