import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RefreshTokenDto, refreshTokenSchema } from './dto/refresh-token.schema';
import { LogoutDto, logoutSchema } from './dto/logout.schema';
import { UserTokenPairResponseDto } from './dto/otp-response.schema';
import { RequestMeta, UserTokenService } from './user-token.service';

function requestMeta(request: Request): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('users')
@Controller('users')
export class RefreshController {
  constructor(private readonly userTokenService: UserTokenService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotaciona o refresh token do usuário (detecta reuso)' })
  @ApiOkResponse({ type: UserTokenPairResponseDto })
  refresh(@Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenDto, @Req() request: Request) {
    return this.userTokenService.rotateRefreshToken(body.refreshToken, requestMeta(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token informado' })
  async logout(@Body(new ZodValidationPipe(logoutSchema)) body: LogoutDto): Promise<void> {
    await this.userTokenService.revokeRefreshToken(body.refreshToken);
  }
}
