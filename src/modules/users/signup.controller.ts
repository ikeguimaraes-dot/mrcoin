import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SignupRateLimitGuard } from '../../common/guards/signup-rate-limit.guard';
import { SignupService } from './signup.service';
import { RequestSignupDto, requestSignupSchema } from './dto/request-signup.schema';
import { VerifySignupDto, verifySignupSchema } from './dto/verify-signup.schema';
import { RequestOtpResponseDto, SignupSessionResponseDto } from './dto/otp-response.schema';

@ApiTags('users')
@Controller('users/signup')
export class SignupController {
  constructor(private readonly signupService: SignupService) {}

  @Post()
  @UseGuards(SignupRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia o cadastro (ou vínculo a uma nova organização) e envia o código por e-mail' })
  @ApiOkResponse({ type: RequestOtpResponseDto })
  requestOtp(@Body(new ZodValidationPipe(requestSignupSchema)) body: RequestSignupDto) {
    return this.signupService.requestOtp(body);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma o código — cria User/Membership/Wallet e retorna sessão' })
  @ApiOkResponse({ type: SignupSessionResponseDto })
  verify(@Body(new ZodValidationPipe(verifySignupSchema)) body: VerifySignupDto) {
    return this.signupService.verifyOtp(body);
  }
}
