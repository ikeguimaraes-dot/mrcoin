import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { MeService } from './me.service';
import { TransactionPinService } from './transaction-pin.service';
import { MeResponseDto } from './dto/me-response.schema';
import { SetTransactionPinDto, setTransactionPinSchema } from './dto/set-transaction-pin.schema';

@ApiTags('users')
@Controller('users/me')
@UseGuards(UserJwtGuard)
export class MeController {
  constructor(
    private readonly meService: MeService,
    private readonly transactionPinService: TransactionPinService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Dados do usuário autenticado — nome, e-mail, CPF mascarado, preferência de notificação, se já tem PIN de transação' })
  @ApiOkResponse({ type: MeResponseDto })
  getMe(@CurrentUser() user: UserJwtPayload) {
    return this.meService.getMe(user.sub);
  }

  @Post('transaction-pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Define ou troca o PIN de transação (4-6 dígitos) — exigido em POST /redemptions' })
  setTransactionPin(
    @CurrentUser() user: UserJwtPayload,
    @Body(new ZodValidationPipe(setTransactionPinSchema)) body: SetTransactionPinDto,
  ) {
    return this.transactionPinService.setPin(user.sub, body.pin);
  }
}
