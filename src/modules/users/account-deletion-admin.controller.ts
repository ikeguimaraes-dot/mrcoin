import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PlatformAdminAuth } from '../platform-admin/decorators/platform-admin-auth.decorator';
import { CurrentPlatformAdmin } from '../platform-admin/decorators/current-platform-admin.decorator';
import { PlatformAdminJwtPayload } from '../../common/guards/jwt-payload.types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AccountDeletionService } from './account-deletion.service';
import {
  AccountDeletionResponseDto,
  AccountDeletionQueueDto,
  AccountDeletionReviewDto,
  CompleteAccountDeletionDto,
  completeAccountDeletionSchema,
} from './dto/account-deletion.schema';

@ApiTags('platform-account-deletion')
@Controller('platform/account-deletion-requests')
@PlatformAdminAuth()
export class AccountDeletionAdminController {
  constructor(private readonly service: AccountDeletionService) {}

  @Get()
  @ApiOkResponse({ type: AccountDeletionQueueDto })
  @ApiOperation({
    summary:
      'Fila de pedidos de exclusão pendentes ou aguardando confirmação de e-mail; até 50 itens por página',
  })
  list(@Query('cursor') cursor?: string) {
    return this.service.listPending(cursor);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Revisão de uma exclusão: identificação, carteiras, registros e resgates pendentes',
  })
  @ApiOkResponse({ type: AccountDeletionReviewDto })
  review(@Param('id') id: string) {
    return this.service.review(id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Conclui exclusão após revisão da retenção: remove identificação/acesso, preserva operações e envia confirmação',
  })
  @ApiOkResponse({ type: AccountDeletionResponseDto })
  complete(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminJwtPayload,
    @Body(new ZodValidationPipe(completeAccountDeletionSchema)) body: CompleteAccountDeletionDto,
    @Req() request: Request,
  ) {
    return this.service.complete(id, admin.sub, body.retentionReason, request.ip);
  }
}
