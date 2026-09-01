import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SignupRateLimitGuard } from '../../common/guards/signup-rate-limit.guard';
import { SignupService } from './signup.service';
import { RequestSignupDto, requestSignupSchema } from './dto/request-signup.schema';
import { VerifySignupDto, verifySignupSchema } from './dto/verify-signup.schema';
import { RequestOtpResponseDto, UserTokenPairResponseDto } from './dto/otp-response.schema';
import { RequestMeta } from './user-token.service';

function requestMeta(request: Request): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('users')
@Controller('users/signup')
export class SignupController {
  constructor(private readonly signupService: SignupService) {}

  @Post()
  @UseGuards(SignupRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia o claim de uma conta pendente (criada por distribuição) e envia o código por e-mail' })
  @ApiOkResponse({ type: RequestOtpResponseDto })
  requestOtp(@Body(new ZodValidationPipe(requestSignupSchema)) body: RequestSignupDto) {
    return this.signupService.requestOtp(body);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma o código — cria/promove User+Membership+Wallet e retorna sessão' })
  @ApiOkResponse({ type: UserTokenPairResponseDto })
  verify(@Body(new ZodValidationPipe(verifySignupSchema)) body: VerifySignupDto, @Req() request: Request) {
    return this.signupService.verifyOtp(body, requestMeta(request));
  }
}
