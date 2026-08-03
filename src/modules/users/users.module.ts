import { Module } from '@nestjs/common';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';
import { LoginController } from './login.controller';
import { LoginService } from './login.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';

@Module({
  controllers: [SignupController, LoginController, DevicesController, NotificationPreferencesController],
  providers: [SignupService, LoginService, DevicesService, NotificationPreferencesService],
})
export class UsersModule {}
