import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PartnerRefreshTokenDto, partnerRefreshTokenSchema } from './dto/refresh-token.schema';
import { PartnerLogoutDto, partnerLogoutSchema } from './dto/logout.schema';
import { PartnerTokenPairResponseDto } from './dto/token-pair-response.schema';
import { PartnerTokenService, RequestMeta } from './partner-token.service';

function requestMeta(request: Request): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('partners')
@Controller('partners')
export class PartnerRefreshController {
  constructor(private readonly partnerTokenService: PartnerTokenService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotaciona o refresh token do parceiro (detecta reuso)' })
  @ApiOkResponse({ type: PartnerTokenPairResponseDto })
  refresh(
    @Body(new ZodValidationPipe(partnerRefreshTokenSchema)) body: PartnerRefreshTokenDto,
    @Req() request: Request,
  ) {
    return this.partnerTokenService.rotateRefreshToken(body.refreshToken, requestMeta(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token informado' })
  async logout(@Body(new ZodValidationPipe(partnerLogoutSchema)) body: PartnerLogoutDto): Promise<void> {
    await this.partnerTokenService.revokeRefreshToken(body.refreshToken);
  }
}
