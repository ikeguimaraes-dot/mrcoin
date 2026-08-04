import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserLoginRateLimitGuard } from '../../common/guards/user-login-rate-limit.guard';
import { LoginService } from './login.service';
import { RequestLoginDto, requestLoginSchema } from './dto/request-login.schema';
import { VerifyLoginDto, verifyLoginSchema } from './dto/verify-login.schema';
import { RequestOtpResponseDto, UserTokenPairResponseDto } from './dto/otp-response.schema';
import { RequestMeta } from './user-token.service';

function requestMeta(request: Request): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('users')
@Controller('users/login')
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @Post()
  @UseGuards(UserLoginRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envia o código de acesso por e-mail pro CPF de uma conta já existente' })
  @ApiOkResponse({ type: RequestOtpResponseDto })
  requestOtp(@Body(new ZodValidationPipe(requestLoginSchema)) body: RequestLoginDto) {
    return this.loginService.requestOtp(body);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma o código e retorna a sessão — sem vínculo com organização' })
  @ApiOkResponse({ type: UserTokenPairResponseDto })
  verify(@Body(new ZodValidationPipe(verifyLoginSchema)) body: VerifyLoginDto, @Req() request: Request) {
    return this.loginService.verifyOtp(body, requestMeta(request));
  }
}
