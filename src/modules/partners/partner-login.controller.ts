import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PartnerLoginRateLimitGuard } from '../../common/guards/partner-login-rate-limit.guard';
import { PartnerLoginService } from './partner-login.service';
import { PartnerLoginDto, partnerLoginSchema } from './dto/login.schema';
import { PartnerTokenPairResponseDto } from './dto/token-pair-response.schema';
import { RequestMeta } from './partner-token.service';

function requestMeta(request: Request): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('partners')
@Controller('partners/login')
export class PartnerLoginController {
  constructor(private readonly partnerLoginService: PartnerLoginService) {}

  @Post()
  @UseGuards(PartnerLoginRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login do parceiro (e-mail + senha)' })
  @ApiOkResponse({ type: PartnerTokenPairResponseDto })
  login(@Body(new ZodValidationPipe(partnerLoginSchema)) body: PartnerLoginDto, @Req() request: Request) {
    return this.partnerLoginService.login(body.email, body.password, requestMeta(request));
  }
}
