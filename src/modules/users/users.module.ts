import { Module } from '@nestjs/common';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';
import { LoginController } from './login.controller';
import { LoginService } from './login.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { RefreshController } from './refresh.controller';
import { UserTokenService } from './user-token.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  controllers: [
    SignupController,
    LoginController,
    DevicesController,
    NotificationPreferencesController,
    RefreshController,
    MeController,
  ],
  providers: [SignupService, LoginService, DevicesService, NotificationPreferencesService, UserTokenService, MeService],
})
export class UsersModule {}
