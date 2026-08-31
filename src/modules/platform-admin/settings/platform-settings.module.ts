import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin.module';
import { SettingsModule } from '../../settings/settings.module';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';

@Module({
  imports: [PlatformAdminModule, SettingsModule],
  controllers: [PlatformSettingsController],
  providers: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
