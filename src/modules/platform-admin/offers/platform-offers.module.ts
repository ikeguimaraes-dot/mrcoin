import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin.module';
import { PlatformOffersController } from './platform-offers.controller';
import { PlatformOffersService } from './platform-offers.service';

@Module({
  imports: [PlatformAdminModule],
  controllers: [PlatformOffersController],
  providers: [PlatformOffersService],
})
export class PlatformOffersModule {}
