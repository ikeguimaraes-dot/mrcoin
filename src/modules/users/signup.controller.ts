import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SignupRateLimitGuard } from '../../common/guards/signup-rate-limit.guard';
import { SignupService } from './signup.service';
import { RequestSignupInput, requestSignupSchema } from './dto/request-signup.schema';
import { VerifySignupInput, verifySignupSchema } from './dto/verify-signup.schema';

@ApiTags('users')
@Controller('users/signup')
export class SignupController {
  constructor(private readonly signupService: SignupService) {}

  @Post()
  @UseGuards(SignupRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia o cadastro (ou vínculo a uma nova organização) e envia o código por e-mail' })
  requestOtp(@Body(new ZodValidationPipe(requestSignupSchema)) body: RequestSignupInput) {
    return this.signupService.requestOtp(body);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma o código — cria User/Membership/Wallet e retorna sessão' })
  verify(@Body(new ZodValidationPipe(verifySignupSchema)) body: VerifySignupInput) {
    return this.signupService.verifyOtp(body);
  }
}
