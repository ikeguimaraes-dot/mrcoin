import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { requireIdempotencyKey } from '../../common/http/require-idempotency-key.util';
import { SpinsService } from './spins.service';
import { SpinsQueryDto, spinsQuerySchema } from './dto/spins-query.schema';
import { RedeemSpinDto, redeemSpinSchema } from './dto/redeem-spin.schema';
import { SpinsAvailableResponseDto } from './dto/spins-available-response.schema';
import { RedeemSpinResponseDto } from './dto/redeem-spin-response.schema';

@ApiTags('spins')
@Controller('spins')
@UseGuards(UserJwtGuard)
export class SpinsController {
  constructor(private readonly spinsService: SpinsService) {}

  @Get()
  @ApiOperation({ summary: 'Quantos giros de roleta o usuário tem disponíveis na organização informada' })
  @ApiOkResponse({ type: SpinsAvailableResponseDto })
  getAvailable(@CurrentUser() user: UserJwtPayload, @Query(new ZodValidationPipe(spinsQuerySchema)) query: SpinsQueryDto) {
    return this.spinsService.getAvailableCount(user.sub, query.organizationId);
  }

  @Post('redeem')
  @ApiOperation({ summary: 'Gira a roleta — sorteia o setor no servidor, credita e devolve o resultado' })
  @ApiCreatedResponse({ type: RedeemSpinResponseDto })
  redeem(
    @CurrentUser() user: UserJwtPayload,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(redeemSpinSchema)) body: RedeemSpinDto,
  ) {
    return this.spinsService.redeem(user.sub, body.organizationId, requireIdempotencyKey(idempotencyKey));
  }
}
