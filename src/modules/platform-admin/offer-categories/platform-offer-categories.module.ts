import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin.module';
import { PlatformOfferCategoriesController } from './platform-offer-categories.controller';
import { PlatformOfferCategoriesService } from './platform-offer-categories.service';

@Module({
  imports: [PlatformAdminModule],
  controllers: [PlatformOfferCategoriesController],
  providers: [PlatformOfferCategoriesService],
})
export class PlatformOfferCategoriesModule {}
