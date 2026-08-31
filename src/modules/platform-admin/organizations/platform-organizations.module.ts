import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin.module';
import { SettingsModule } from '../../settings/settings.module';
import { PlatformOrganizationsController } from './platform-organizations.controller';
import { PlatformOrganizationsService } from './platform-organizations.service';

@Module({
  imports: [PlatformAdminModule, SettingsModule],
  controllers: [PlatformOrganizationsController],
  providers: [PlatformOrganizationsService],
})
export class PlatformOrganizationsModule {}
