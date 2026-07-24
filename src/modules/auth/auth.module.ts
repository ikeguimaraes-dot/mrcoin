import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { AdminDirectoryService } from './admin-directory.service';
import { MfaChallengeGuard } from './guards/mfa-challenge.guard';
import { MfaSetupGuard } from './guards/mfa-setup.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    MfaService,
    AdminDirectoryService,
    MfaChallengeGuard,
    MfaSetupGuard,
  ],
  exports: [TokenService],
})
export class AuthModule {}
