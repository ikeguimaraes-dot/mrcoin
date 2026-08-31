import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConversionRate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Taxa de conversão R$→coins, por organização. Sem HTTP, sem auth — puro Prisma, importável
 * tanto por BatchesModule (que só LÊ, pra calcular priceInCents na compra de lote) quanto
 * por platform-admin/organizations (que LÊ e ESCREVE via HTTP). Append-only: setRate*()
 * sempre insere uma linha nova, nunca atualiza — ver comentário do model ConversionRate no
 * schema.
 */
@Injectable()
export class ConversionRateService {
  constructor(private readonly prisma: PrismaService) {}

  getCurrentRateForOrganizationOrNull(organizationId: string): Promise<ConversionRate | null> {
    return this.prisma.conversionRate.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCurrentRateForOrganization(organizationId: string): Promise<ConversionRate> {
    const rate = await this.getCurrentRateForOrganizationOrNull(organizationId);

    if (!rate) {
      // Não deveria acontecer — toda organização ganha uma linha na criação (create ou
      // migration de backfill). Falha alto em vez de assumir um valor default silencioso
      // pra um cálculo financeiro (compra de lote, endpoint dedicado de taxa). Pra contexto
      // de LISTAGEM (várias organizações de uma vez), use getCurrentRateForOrganizationOrNull
      // — uma linha ruim não pode derrubar a página inteira.
      throw new InternalServerErrorException(
        `Nenhuma taxa de conversão configurada para a organização ${organizationId}.`,
      );
    }

    return rate;
  }

  setRateForOrganization(organizationId: string, coinsPerRealScaled: number): Promise<ConversionRate> {
    return this.prisma.conversionRate.create({ data: { organizationId, coinsPerRealScaled } });
  }
}
