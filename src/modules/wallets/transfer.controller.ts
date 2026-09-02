import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { requireIdempotencyKey } from '../../common/http/require-idempotency-key.util';
import { TransferService } from './transfer.service';
import { SearchRecipientsQueryDto, searchRecipientsQuerySchema } from './dto/search-recipients-query.schema';
import { RecipientListResponseDto } from './dto/recipient-list-item.schema';
import { CreateTransferDto, createTransferSchema } from './dto/create-transfer.schema';
import { TransferResponseDto } from './dto/transfer-response.schema';

@ApiTags('wallets')
@Controller('wallet/transfer')
@UseGuards(UserJwtGuard)
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Get('recipients')
  @ApiOperation({ summary: 'Busca membros ACTIVE da mesma organização por nome (parcial) pra escolher destinatário' })
  @ApiOkResponse({ type: RecipientListResponseDto })
  async searchRecipients(
    @CurrentUser() user: UserJwtPayload,
    @Query(new ZodValidationPipe(searchRecipientsQuerySchema)) query: SearchRecipientsQueryDto,
  ) {
    const items = await this.transferService.searchRecipients(user.sub, query.organizationId, query.query);
    return { items };
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Transfere coins pra outro membro da mesma organização — exige PIN de transação, ' +
      'limite de 1000 coins/dia por usuário',
  })
  @ApiCreatedResponse({ type: TransferResponseDto })
  create(
    @CurrentUser() user: UserJwtPayload,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createTransferSchema)) body: CreateTransferDto,
  ) {
    return this.transferService.create(user.sub, body, requireIdempotencyKey(idempotencyKey));
  }
}
