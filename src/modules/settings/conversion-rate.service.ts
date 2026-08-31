import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConversionRate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Taxa global de conversão R$→coins. Sem HTTP, sem auth — puro Prisma, importável tanto por
 * BatchesModule (que só LÊ, pra calcular totalCoins na compra de lote) quanto por
 * platform-admin/settings (que LÊ e ESCREVE via HTTP). Append-only: setRate() sempre insere
 * uma linha nova, nunca atualiza — ver comentário do model ConversionRate no schema.
 */
@Injectable()
export class ConversionRateService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentRate(): Promise<ConversionRate> {
    const rate = await this.prisma.conversionRate.findFirst({ orderBy: { createdAt: 'desc' } });

    if (!rate) {
      // Não deveria acontecer — a migration semeia a primeira linha. Falha alto em vez de
      // assumir um valor default silencioso pra um cálculo financeiro.
      throw new InternalServerErrorException('Nenhuma taxa de conversão configurada.');
    }

    return rate;
  }

  setRate(coinsPerRealScaled: number): Promise<ConversionRate> {
    return this.prisma.conversionRate.create({ data: { coinsPerRealScaled } });
  }
}
