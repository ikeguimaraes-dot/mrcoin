import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserLoginRateLimitGuard } from '../../common/guards/user-login-rate-limit.guard';
import { PasswordRecoveryService } from './password-recovery.service';
import { RequestPasswordRecoveryDto, requestPasswordRecoverySchema } from './dto/request-password-recovery.schema';
import { ConfirmPasswordRecoveryDto, confirmPasswordRecoverySchema } from './dto/confirm-password-recovery.schema';
import { RequestOtpResponseDto, UserTokenPairResponseDto } from './dto/otp-response.schema';
import { RequestMeta } from './user-token.service';

function requestMeta(request: Request): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('users')
@Controller('users/password')
export class PasswordRecoveryController {
  constructor(private readonly passwordRecoveryService: PasswordRecoveryService) {}

  @Post('recovery')
  @UseGuards(UserLoginRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envia um código por e-mail pra redefinir a senha — serve tanto pra recuperar quanto pra definir a primeira senha' })
  @ApiOkResponse({ type: RequestOtpResponseDto })
  requestRecovery(@Body(new ZodValidationPipe(requestPasswordRecoverySchema)) body: RequestPasswordRecoveryDto) {
    return this.passwordRecoveryService.requestOtp(body);
  }

  @Post('recovery/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma o código, define a nova senha e retorna a sessão' })
  @ApiOkResponse({ type: UserTokenPairResponseDto })
  confirmRecovery(
    @Body(new ZodValidationPipe(confirmPasswordRecoverySchema)) body: ConfirmPasswordRecoveryDto,
    @Req() request: Request,
  ) {
    return this.passwordRecoveryService.confirm(body, requestMeta(request));
  }
}
