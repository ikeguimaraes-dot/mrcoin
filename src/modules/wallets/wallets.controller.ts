import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { WalletsService } from './wallets.service';
import { WalletQueryDto, walletQuerySchema } from './dto/wallet-query.schema';
import { WalletEntriesQueryDto, walletEntriesQuerySchema } from './dto/wallet-entries-query.schema';
import { WalletResponseDto } from './dto/wallet-response.schema';

@ApiTags('wallets')
@Controller('wallet')
@UseGuards(UserJwtGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  @ApiOperation({ summary: 'Saldo da wallet do usuário na organização informada + coins a expirar' })
  @ApiOkResponse({ type: WalletResponseDto })
  getWallet(
    @CurrentUser() user: UserJwtPayload,
    @Query(new ZodValidationPipe(walletQuerySchema)) query: WalletQueryDto,
  ) {
    return this.walletsService.getWallet(user.sub, query.organizationId);
  }

  @Get('entries')
  @ApiOperation({ summary: 'Extrato da wallet, paginado por cursor — items é LedgerEntry (Prisma), sem schema de resposta ainda' })
  getEntries(
    @CurrentUser() user: UserJwtPayload,
    @Query(new ZodValidationPipe(walletEntriesQuerySchema)) query: WalletEntriesQueryDto,
  ) {
    return this.walletsService.getEntries(user.sub, query.organizationId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
