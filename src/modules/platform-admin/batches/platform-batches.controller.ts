import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PlatformAdminAuth } from '../decorators/platform-admin-auth.decorator';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { PlatformAdminJwtPayload } from '../../../common/guards/jwt-payload.types';
import { PlatformBatchesService } from './platform-batches.service';
import { ListPlatformBatchesQueryDto, listPlatformBatchesQuerySchema } from './dto/list-platform-batches-query.schema';
import { PlatformBatchItemDto, PlatformBatchListResponseDto } from './dto/platform-batch-item.schema';
import { RejectBatchDto, rejectBatchSchema } from './dto/reject-batch.schema';

@ApiTags('platform-batches')
@Controller('platform/batches')
export class PlatformBatchesController {
  constructor(private readonly batchesService: PlatformBatchesService) {}

  @Get()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Lista pedidos de lote de todas as organizações, com filtro opcional por status, paginado por cursor' })
  @ApiOkResponse({ type: PlatformBatchListResponseDto })
  list(@Query(new ZodValidationPipe(listPlatformBatchesQuerySchema)) query: ListPlatformBatchesQueryDto) {
    return this.batchesService.list(query);
  }

  @Post(':id/approve')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Aprova um pedido de lote (marca como pago) — libera o estoque de coins da organização, idempotente' })
  @ApiOkResponse({ type: PlatformBatchItemDto })
  approve(
    @Param('id') id: string,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.batchesService.approve(platformAdmin.sub, id, request.ip);
  }

  @Post(':id/reject')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Recusa um pedido de lote, com motivo opcional, idempotente' })
  @ApiOkResponse({ type: PlatformBatchItemDto })
  reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectBatchSchema)) body: RejectBatchDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.batchesService.reject(platformAdmin.sub, id, body, request.ip);
  }
}
