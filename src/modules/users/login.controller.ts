import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserLoginRateLimitGuard } from '../../common/guards/user-login-rate-limit.guard';
import { LoginService } from './login.service';
import { LoginDto, loginSchema } from './dto/login.schema';
import { UserTokenPairResponseDto } from './dto/otp-response.schema';
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
  @ApiOperation({ summary: 'Login por CPF + senha — retorna a sessão direto, sem OTP' })
  @ApiOkResponse({ type: UserTokenPairResponseDto })
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginDto, @Req() request: Request) {
    return this.loginService.login(body, requestMeta(request));
  }
}
