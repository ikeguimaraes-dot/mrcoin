import { Module } from '@nestjs/common';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';
import { LoginController } from './login.controller';
import { LoginService } from './login.service';
import { PasswordRecoveryController } from './password-recovery.controller';
import { PasswordRecoveryService } from './password-recovery.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { RefreshController } from './refresh.controller';
import { UserTokenService } from './user-token.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { TransactionPinService } from './transaction-pin.service';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionAdminController } from './account-deletion-admin.controller';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionRateLimitGuard } from './account-deletion-rate-limit.guard';

@Module({
  imports: [PlatformAdminModule],
  controllers: [
    AccountDeletionController,
    AccountDeletionAdminController,
    SignupController,
    LoginController,
    PasswordRecoveryController,
    DevicesController,
    NotificationPreferencesController,
    RefreshController,
    MeController,
  ],
  providers: [
    AccountDeletionService,
    AccountDeletionRateLimitGuard,
    SignupService,
    LoginService,
    PasswordRecoveryService,
    DevicesService,
    NotificationPreferencesService,
    UserTokenService,
    MeService,
    TransactionPinService,
  ],
  exports: [TransactionPinService],
})
export class UsersModule {}
