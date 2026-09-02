import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { RedemptionsService } from './redemptions.service';
import { CreateRedemptionDto, createRedemptionSchema } from './dto/create-redemption.schema';
import { RedemptionResponseDto } from './dto/redemption-response.schema';
import { ListRedemptionsQueryDto, listRedemptionsQuerySchema } from './dto/list-redemptions-query.schema';
import { RedemptionListResponseDto } from './dto/redemption-list-item.schema';

function requireIdempotencyKey(idempotencyKey: string | undefined): string {
  if (!idempotencyKey?.trim()) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Header Idempotency-Key é obrigatório.',
    });
  }
  return idempotencyKey;
}

@ApiTags('redemptions')
@Controller('redemptions')
@UseGuards(UserJwtGuard)
export class RedemptionsController {
  constructor(private readonly redemptionsService: RedemptionsService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Compra um item com coins — exige PIN de transação, debita imediatamente e devolve o ' +
      'resgate já CONFIRMED com código de retirada + QR',
  })
  @ApiCreatedResponse({ type: RedemptionResponseDto })
  create(
    @CurrentUser() user: UserJwtPayload,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createRedemptionSchema)) body: CreateRedemptionDto,
  ) {
    return this.redemptionsService.create(user.sub, body, requireIdempotencyKey(idempotencyKey));
  }

  @Get()
  @ApiOperation({ summary: 'Lista os resgates do usuário autenticado numa organização, paginado por cursor' })
  @ApiOkResponse({ type: RedemptionListResponseDto })
  list(
    @CurrentUser() user: UserJwtPayload,
    @Query(new ZodValidationPipe(listRedemptionsQuerySchema)) query: ListRedemptionsQueryDto,
  ) {
    return this.redemptionsService.list(user.sub, query.organizationId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consulta um resgate já feito — código de retirada, QR e status de entrega' })
  @ApiOkResponse({ type: RedemptionResponseDto })
  getById(@CurrentUser() user: UserJwtPayload, @Param('id') id: string) {
    return this.redemptionsService.getById(user.sub, id);
  }
}
