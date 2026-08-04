import { BadRequestException, Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BatchesService } from './batches.service';
import { CreateBatchDto, createBatchSchema } from './dto/create-batch.schema';
import { ListBatchesQueryDto, listBatchesQuerySchema } from './dto/list-batches.schema';
import { CreateBatchResponseDto, ListBatchesResponseDto } from './dto/coin-batch-response.schema';

@ApiTags('batches')
@Controller('admin/batches')
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Post()
  @AdminAuth(AdminRole.OWNER)
  @AuditAction('BATCH_CREATED')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Cria um lote pendente e a cobrança Pix correspondente (somente OWNER)' })
  @ApiCreatedResponse({ type: CreateBatchResponseDto })
  createBatch(
    @TenantOrganizationId() organizationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createBatchSchema)) body: CreateBatchDto,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Header Idempotency-Key é obrigatório.',
      });
    }

    return this.batchesService.createPendingBatch(organizationId, body, idempotencyKey);
  }

  @Get()
  @AdminAuth()
  @ApiOperation({ summary: 'Lista os lotes de coins da organização do chamador' })
  @ApiOkResponse({ type: ListBatchesResponseDto })
  listBatches(
    @TenantOrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listBatchesQuerySchema)) query: ListBatchesQueryDto,
  ) {
    return this.batchesService.listBatches(organizationId, query);
  }
}
