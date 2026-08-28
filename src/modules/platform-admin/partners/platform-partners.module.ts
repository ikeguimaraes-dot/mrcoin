import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin.module';
import { PartnersModule } from '../../partners/partners.module';
import { PlatformPartnersController } from './platform-partners.controller';
import { PlatformPartnersService } from './platform-partners.service';

@Module({
  imports: [PlatformAdminModule, PartnersModule],
  controllers: [PlatformPartnersController],
  providers: [PlatformPartnersService],
})
export class PlatformPartnersModule {}
