import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { WalletsService } from './wallets.service';
import { WalletQuery, walletQuerySchema } from './dto/wallet-query.schema';
import { WalletEntriesQuery, walletEntriesQuerySchema } from './dto/wallet-entries-query.schema';

@ApiTags('wallets')
@Controller('wallet')
@UseGuards(UserJwtGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  @ApiOperation({ summary: 'Saldo da wallet do usuário na organização informada + coins a expirar' })
  getWallet(
    @CurrentUser() user: UserJwtPayload,
    @Query(new ZodValidationPipe(walletQuerySchema)) query: WalletQuery,
  ) {
    return this.walletsService.getWallet(user.sub, query.organizationId);
  }

  @Get('entries')
  @ApiOperation({ summary: 'Extrato da wallet, paginado por cursor' })
  getEntries(
    @CurrentUser() user: UserJwtPayload,
    @Query(new ZodValidationPipe(walletEntriesQuerySchema)) query: WalletEntriesQuery,
  ) {
    return this.walletsService.getEntries(user.sub, query.organizationId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
