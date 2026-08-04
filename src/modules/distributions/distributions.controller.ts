import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuth } from '../../common/decorators/admin-auth.decorator';
import { TenantOrganizationId } from '../../common/decorators/tenant-organization-id.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminJwtPayload } from '../../common/guards/jwt-payload.types';
import { DistributionsService } from './distributions.service';
import { DistributionsCsvService } from './distributions-csv.service';
import { CreateDistributionDto, createDistributionSchema } from './dto/create-distribution.schema';
import { UploadDistributionCsvDto, uploadDistributionCsvSchema } from './dto/upload-distribution-csv.schema';
import {
  ListDistributionItemsQueryDto,
  listDistributionItemsQuerySchema,
} from './dto/list-distribution-items.schema';
import { ListDistributionsQueryDto, listDistributionsQuerySchema } from './dto/list-distributions.schema';
import { ListDistributionsResponseDto, DistributionResponseDto } from './dto/distribution-response.schema';
import {
  DistributeIndividualResponseDto,
  DistributionWithItemsResponseDto,
} from './dto/distribution-item-response.schema';

function requireIdempotencyKey(idempotencyKey: string | undefined): string {
  if (!idempotencyKey?.trim()) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Header Idempotency-Key é obrigatório.',
    });
  }
  return idempotencyKey;
}

@ApiTags('distributions')
@Controller('admin/distributions')
export class DistributionsController {
  constructor(
    private readonly distributionsService: DistributionsService,
    private readonly distributionsCsvService: DistributionsCsvService,
  ) {}

  @Post()
  @AdminAuth(AdminRole.OWNER, AdminRole.MANAGER)
  @AuditAction('DISTRIBUTION_CREATED')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Credita coins pra um CPF, consumindo o lote que expira primeiro (OWNER/MANAGER)' })
  @ApiCreatedResponse({ type: DistributeIndividualResponseDto })
  createDistribution(
    @TenantOrganizationId() organizationId: string,
    @CurrentAdmin() admin: AdminJwtPayload,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createDistributionSchema)) body: CreateDistributionDto,
  ) {
    return this.distributionsService.distributeIndividual(
      organizationId,
      admin.sub,
      body,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post('csv')
  @AdminAuth(AdminRole.OWNER, AdminRole.MANAGER)
  @AuditAction('DISTRIBUTION_CSV_UPLOADED')
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Upload de CSV pra distribuição em massa — valida e devolve preview, sem creditar nada (OWNER/MANAGER)' })
  @ApiCreatedResponse({ type: DistributionWithItemsResponseDto })
  @UseInterceptors(FileInterceptor('file'))
  uploadCsv(
    @TenantOrganizationId() organizationId: string,
    @CurrentAdmin() admin: AdminJwtPayload,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(uploadDistributionCsvSchema)) body: UploadDistributionCsvDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.distributionsCsvService.uploadAndValidate(
      organizationId,
      admin.sub,
      body,
      file,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post(':id/confirm')
  @AdminAuth(AdminRole.OWNER, AdminRole.MANAGER)
  @AuditAction('DISTRIBUTION_CONFIRMED')
  @ApiOperation({ summary: 'Confirma o preview e dispara o processamento em massa via fila (OWNER/MANAGER)' })
  @ApiCreatedResponse({ type: DistributionResponseDto })
  confirmDistribution(@TenantOrganizationId() organizationId: string, @Param('id') id: string) {
    return this.distributionsService.confirmBulkDistribution(organizationId, id);
  }

  @Get()
  @AdminAuth()
  @ApiOperation({ summary: 'Lista as distribuições da organização do chamador' })
  @ApiOkResponse({ type: ListDistributionsResponseDto })
  listDistributions(
    @TenantOrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listDistributionsQuerySchema)) query: ListDistributionsQueryDto,
  ) {
    return this.distributionsService.listDistributions(organizationId, query);
  }

  @Get(':id')
  @AdminAuth()
  @ApiOperation({ summary: 'Progresso de uma distribuição (individual ou em massa) e suas linhas' })
  @ApiOkResponse({ type: DistributionWithItemsResponseDto })
  async getDistribution(
    @TenantOrganizationId() organizationId: string,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listDistributionItemsQuerySchema)) query: ListDistributionItemsQueryDto,
  ) {
    const distribution = await this.distributionsService.getDistribution(organizationId, id);
    const items = await this.distributionsService.listItems(id, query.cursor, query.limit);
    return { distribution, items };
  }
}
