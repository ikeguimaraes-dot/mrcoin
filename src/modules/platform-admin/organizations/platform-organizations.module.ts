import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin.module';
import { PlatformOrganizationsController } from './platform-organizations.controller';
import { PlatformOrganizationsService } from './platform-organizations.service';

@Module({
  imports: [PlatformAdminModule],
  controllers: [PlatformOrganizationsController],
  providers: [PlatformOrganizationsService],
})
export class PlatformOrganizationsModule {}
