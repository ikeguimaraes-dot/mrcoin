import { Module } from '@nestjs/common';
import { PartnersController } from './partners.controller';
import { AdminPartnersController } from './admin-partners.controller';
import { PartnersService } from './partners.service';

@Module({
  controllers: [PartnersController, AdminPartnersController],
  providers: [PartnersService],
  exports: [PartnersService],
})
export class PartnersModule {}
