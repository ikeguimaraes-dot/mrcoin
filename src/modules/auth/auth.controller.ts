import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { LoginRateLimitGuard } from '../../common/guards/login-rate-limit.guard';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { AdminJwtPayload } from '../../common/guards/jwt-payload.types';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { AdminDirectoryService } from './admin-directory.service';
import { MfaChallengeGuard } from './guards/mfa-challenge.guard';
import { MfaSetupGuard } from './guards/mfa-setup.guard';
import { LoginInput, loginSchema } from './dto/login.schema';
import { VerifyMfaInput, verifyMfaSchema } from './dto/verify-mfa.schema';
import { EnableMfaInput, enableMfaSchema } from './dto/enable-mfa.schema';
import { RefreshInput, refreshSchema } from './dto/refresh.schema';
import { LogoutInput, logoutSchema } from './dto/logout.schema';
import { ListAdminsQuery, listAdminsQuerySchema } from './dto/list-admins.schema';
import { RequestMeta } from './token.service';

function requestMeta(request: Request): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
    private readonly adminDirectory: AdminDirectoryService,
  ) {}

  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login de AdminUser (e-mail + senha)' })
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput, @Req() request: Request) {
    return this.authService.login(body.email, body.password, requestMeta(request));
  }

  @Post('mfa/setup')
  @UseGuards(MfaSetupGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gera secret TOTP + QR code para configurar MFA' })
  mfaSetup(@Req() request: Request) {
    return this.mfaService.setup(request.mfaSetupAdminId as string);
  }

  @Post('mfa/enable')
  @UseGuards(MfaSetupGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma o primeiro código TOTP e ativa o MFA' })
  mfaEnable(@Body(new ZodValidationPipe(enableMfaSchema)) body: EnableMfaInput, @Req() request: Request) {
    return this.authService.completeMfaSetup(
      request.mfaSetupAdminId as string,
      body.code,
      requestMeta(request),
    );
  }

  @Post('mfa/verify')
  @UseGuards(MfaChallengeGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Completa o login verificando o código TOTP' })
  mfaVerify(@Body(new ZodValidationPipe(verifyMfaSchema)) body: VerifyMfaInput, @Req() request: Request) {
    return this.authService.completeMfaLogin(
      request.mfaChallengeAdminId as string,
      body.code,
      requestMeta(request),
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotaciona o refresh token (detecta reuso)' })
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput, @Req() request: Request) {
    return this.authService.refresh(body.refreshToken, requestMeta(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token informado' })
  async logout(@Body(new ZodValidationPipe(logoutSchema)) body: LogoutInput): Promise<void> {
    await this.authService.logout(body.refreshToken);
  }

  @Get('me')
  @AdminAuth()
  @ApiOperation({ summary: 'Perfil do admin autenticado' })
  me(@CurrentAdmin() admin: AdminJwtPayload) {
    return this.adminDirectory.getProfile(admin.sub);
  }

  @Get('admins')
  @AdminAuth()
  @ApiOperation({ summary: 'Lista os AdminUsers da organização do chamador (nunca de outra)' })
  listAdmins(
    @Query(new ZodValidationPipe(listAdminsQuerySchema)) query: ListAdminsQuery,
    @TenantOrganizationId() organizationId: string,
  ) {
    return this.adminDirectory.listByOrganization(organizationId, query);
  }
}
