import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PlatformAdminLoginRateLimitGuard } from './guards/platform-admin-login-rate-limit.guard';
import { PlatformAdminMfaRateLimitGuard } from './guards/platform-admin-mfa-rate-limit.guard';
import { PlatformMfaChallengeGuard } from './guards/platform-mfa-challenge.guard';
import { PlatformMfaSetupGuard } from './guards/platform-mfa-setup.guard';
import { PlatformAdminAuth } from './decorators/platform-admin-auth.decorator';
import { CurrentPlatformAdmin } from './decorators/current-platform-admin.decorator';
import { PlatformAdminJwtPayload } from '../../common/guards/jwt-payload.types';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminMfaService } from './platform-admin-mfa.service';
import { RequestMeta } from './platform-admin-token.service';
import { LoginDto, loginSchema } from './dto/login.schema';
import { VerifyMfaDto, verifyMfaSchema } from './dto/verify-mfa.schema';
import { EnableMfaDto, enableMfaSchema } from './dto/enable-mfa.schema';
import { RefreshDto, refreshSchema } from './dto/refresh.schema';
import { LogoutDto, logoutSchema } from './dto/logout.schema';
import { TokenPairDto } from './dto/token-pair.schema';
import { MfaSetupResponseDto } from './dto/mfa-setup-response.schema';
import { LoginResponseDto } from './dto/login-response.schema';
import { PlatformAdminProfileDto } from './dto/profile.schema';

function requestMeta(request: Request): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('platform-auth')
@Controller('platform/auth')
export class PlatformAdminAuthController {
  constructor(
    private readonly authService: PlatformAdminAuthService,
    private readonly mfaService: PlatformAdminMfaService,
  ) {}

  @Post('login')
  @UseGuards(PlatformAdminLoginRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login de PlatformAdmin (e-mail + senha) — MFA sempre obrigatório' })
  @ApiOkResponse({ type: LoginResponseDto })
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginDto, @Req() request: Request) {
    return this.authService.login(body.email, body.password, requestMeta(request));
  }

  @Post('mfa/setup')
  @UseGuards(PlatformMfaSetupGuard, PlatformAdminMfaRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gera secret TOTP + QR code para configurar MFA' })
  @ApiOkResponse({ type: MfaSetupResponseDto })
  mfaSetup(@Req() request: Request) {
    return this.mfaService.setup(request.platformMfaSetupId as string);
  }

  @Post('mfa/enable')
  @UseGuards(PlatformMfaSetupGuard, PlatformAdminMfaRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma o primeiro código TOTP e ativa o MFA' })
  @ApiOkResponse({ type: TokenPairDto })
  mfaEnable(@Body(new ZodValidationPipe(enableMfaSchema)) body: EnableMfaDto, @Req() request: Request) {
    return this.authService.completeMfaSetup(
      request.platformMfaSetupId as string,
      body.code,
      requestMeta(request),
    );
  }

  @Post('mfa/verify')
  @UseGuards(PlatformMfaChallengeGuard, PlatformAdminMfaRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Completa o login verificando o código TOTP' })
  @ApiOkResponse({ type: TokenPairDto })
  mfaVerify(@Body(new ZodValidationPipe(verifyMfaSchema)) body: VerifyMfaDto, @Req() request: Request) {
    return this.authService.completeMfaLogin(
      request.platformMfaChallengeId as string,
      body.code,
      requestMeta(request),
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotaciona o refresh token (detecta reuso)' })
  @ApiOkResponse({ type: TokenPairDto })
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshDto, @Req() request: Request) {
    return this.authService.refresh(body.refreshToken, requestMeta(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token informado' })
  async logout(@Body(new ZodValidationPipe(logoutSchema)) body: LogoutDto): Promise<void> {
    await this.authService.logout(body.refreshToken);
  }

  @Get('me')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Perfil do PlatformAdmin autenticado' })
  @ApiOkResponse({ type: PlatformAdminProfileDto })
  me(@CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload) {
    return this.authService.getProfile(platformAdmin.sub);
  }
}
