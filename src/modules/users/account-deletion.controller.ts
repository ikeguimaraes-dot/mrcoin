import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionRateLimitGuard } from './account-deletion-rate-limit.guard';
import {
  AccountDeletionResponseDto,
  AccountDeletionStatusDto,
  RequestAccountDeletionDto,
  requestAccountDeletionSchema,
} from './dto/account-deletion.schema';

@ApiTags('users')
@Controller('users/me/account-deletion')
@UseGuards(UserJwtGuard)
export class AccountDeletionController {
  constructor(private readonly service: AccountDeletionService) {}

  @Get()
  @ApiOperation({ summary: 'Consulta o pedido de exclusão da própria conta' })
  @ApiOkResponse({ type: AccountDeletionStatusDto })
  async status(@CurrentUser() user: UserJwtPayload) {
    return { request: await this.service.getStatus(user.sub) };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccountDeletionRateLimitGuard)
  @ApiOperation({
    summary:
      'Confirma pedido de exclusão com senha; aceita qualquer saldo; prazo de sete dias corridos',
  })
  @ApiOkResponse({ type: AccountDeletionResponseDto })
  request(
    @CurrentUser() user: UserJwtPayload,
    @Body(new ZodValidationPipe(requestAccountDeletionSchema)) body: RequestAccountDeletionDto,
  ) {
    return this.service.request(user.sub, body);
  }
}
