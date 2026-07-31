import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Distribution, DistributionItem, DistributionItemStatus } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { STORAGE_PORT, StoragePort } from '../../common/storage/storage.port';
import { CSV_MAX_FILE_SIZE_BYTES, CSV_MAX_ROWS } from './distributions.constants';
import { UploadDistributionCsvInput } from './dto/upload-distribution-csv.schema';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';
import { listDistributionItems } from './list-distribution-items.util';

const CPF_REGEX = /^\d{11}$/;

interface CsvRow {
  cpf?: string;
  name?: string;
  amount?: string;
  externalRef?: string;
}

interface ValidatedRow {
  status: DistributionItemStatus;
  errorReason?: string;
  cpfHash?: string;
  cpfEncrypted?: string;
  name?: string;
  amount: number;
  externalRef?: string;
}

export interface UploadCsvResult {
  distribution: Distribution;
  items: { items: DistributionItem[]; nextCursor: string | null };
}

/** Upload + validação prévia do CSV de distribuição em massa — nada é creditado aqui,
 * só persistido pra revisão (ver POST /admin/distributions/:id/confirm). */
@Injectable()
export class DistributionsCsvService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
  ) {}

  async uploadAndValidate(
    organizationId: string,
    adminUserId: string,
    input: UploadDistributionCsvInput,
    file: Express.Multer.File | undefined,
    idempotencyKey: string,
  ): Promise<UploadCsvResult> {
    if (!file || file.size === 0) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Arquivo CSV é obrigatório.' });
    }

    if (file.size > CSV_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Arquivo excede o limite de ${CSV_MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
      });
    }

    const rows = this.parseCsv(file.buffer);

    if (rows.length === 0) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'CSV vazio.' });
    }

    if (rows.length > CSV_MAX_ROWS) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `CSV excede o limite de ${CSV_MAX_ROWS} linhas.`,
      });
    }

    const existing = await this.prisma.distribution.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.organizationId !== organizationId || existing.totalItems !== rows.length) {
        throw new IdempotencyConflictException(idempotencyKey, { distributionId: existing.id });
      }
      const items = await listDistributionItems(this.prisma, existing.id, undefined);
      return { distribution: existing, items };
    }

    const { url } = await this.storagePort.upload({
      key: `distributions/${organizationId}/${randomUUID()}.csv`,
      contentType: 'text/csv',
      body: file.buffer,
    });

    const validatedRows = this.validateRows(rows);
    const failedCount = validatedRows.filter((row) => row.status === 'FAILED').length;

    const distribution = await this.prisma.$transaction(async (tx) => {
      const created = await tx.distribution.create({
        data: {
          organizationId,
          adminUserId,
          csvFileUrl: url,
          totalItems: validatedRows.length,
          successItems: 0,
          failedItems: failedCount,
          status: 'PENDING',
          idempotencyKey,
        },
      });

      await tx.distributionItem.createMany({
        data: validatedRows.map((row) => ({
          distributionId: created.id,
          amount: row.amount,
          status: row.status,
          errorReason: row.errorReason,
          cpfHash: row.cpfHash,
          cpfEncrypted: row.cpfEncrypted,
          name: row.name,
          membershipType: row.status === 'FAILED' ? undefined : input.membershipType,
          externalRef: row.externalRef,
        })),
      });

      return created;
    });

    const items = await listDistributionItems(this.prisma, distribution.id, undefined);
    return { distribution, items };
  }

  private parseCsv(buffer: Buffer): CsvRow[] {
    try {
      return parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
    } catch (error) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `CSV mal formatado: ${(error as Error).message}`,
      });
    }
  }

  private validateRows(rows: CsvRow[]): ValidatedRow[] {
    const cpfOccurrences = new Map<string, number>();

    for (const row of rows) {
      const cpf = (row.cpf ?? '').trim();
      if (CPF_REGEX.test(cpf)) {
        const cpfHash = hashCpf(cpf);
        cpfOccurrences.set(cpfHash, (cpfOccurrences.get(cpfHash) ?? 0) + 1);
      }
    }

    return rows.map((row) => this.validateRow(row, cpfOccurrences));
  }

  private validateRow(row: CsvRow, cpfOccurrences: Map<string, number>): ValidatedRow {
    const cpf = (row.cpf ?? '').trim();
    const name = (row.name ?? '').trim() || undefined;
    const externalRef = (row.externalRef ?? '').trim() || undefined;

    if (!CPF_REGEX.test(cpf)) {
      return { status: 'FAILED', errorReason: 'CPF inválido', name, externalRef, amount: 0 };
    }

    const cpfHash = hashCpf(cpf);
    const cpfEncrypted = encryptCpf(cpf);

    if ((cpfOccurrences.get(cpfHash) ?? 0) > 1) {
      return {
        status: 'FAILED',
        errorReason: 'CPF duplicado no arquivo',
        cpfHash,
        cpfEncrypted,
        name,
        externalRef,
        amount: 0,
      };
    }

    const amount = Number(row.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      return {
        status: 'FAILED',
        errorReason: 'Valor inválido',
        cpfHash,
        cpfEncrypted,
        name,
        externalRef,
        amount: 0,
      };
    }

    if (!name) {
      return {
        status: 'FAILED',
        errorReason: 'Nome obrigatório',
        cpfHash,
        cpfEncrypted,
        externalRef,
        amount: 0,
      };
    }

    return { status: 'PENDING', cpfHash, cpfEncrypted, name, amount, externalRef };
  }
}
