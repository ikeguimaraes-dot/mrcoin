import { Injectable } from '@nestjs/common';
import { Prisma, Spin } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { WalletsService } from '../wallets/wallets.service';
import { IdempotencyConflictException } from '../distributions/exceptions/idempotency-conflict.exception';
import { NoSpinAvailableException } from './exceptions/no-spin-available.exception';
import { drawSector } from './sector-draw.util';
import { SPIN_RESERVED_AMOUNT, SPIN_SECTORS } from './spins.constants';

export interface RedeemSpinResult {
  sectorIndex: number;
  coinsAwarded: number;
}

export interface SpinsAvailableResult {
  availableSpins: number;
  sectors: number[];
}

/**
 * Consulta e resgate de giros. A reserva de estoque já aconteceu na concessão
 * (SpinsAdminService) — aqui só decide QUAL setor sai (crypto.randomInt, nunca Math.random) e
 * credita o valor sorteado, devolvendo a sobra (SPIN_RESERVED_AMOUNT − sorteado) pro lote que
 * financiou a reserva. Expiração é preguiçosa (mesmo padrão do OTP nesta base): giros vencidos
 * só são marcados EXPIRED (com liberação da reserva) quando alguém consulta ou tenta resgatar.
 */
@Injectable()
export class SpinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly walletsService: WalletsService,
  ) {}

  async getAvailableCount(userId: string, organizationId: string): Promise<SpinsAvailableResult> {
    const { membershipId } = await this.walletsService.resolveWalletId(userId, organizationId);

    await this.expireCallerSpins(membershipId);

    const availableSpins = await this.prisma.spin.count({
      where: { membershipId, status: 'PENDING', expiresAt: { gt: new Date() } },
    });

    return { availableSpins, sectors: Array.from(SPIN_SECTORS) };
  }

  async redeem(userId: string, organizationId: string, idempotencyKey: string): Promise<RedeemSpinResult> {
    const { membershipId, walletId } = await this.walletsService.resolveWalletId(userId, organizationId);

    const existing = await this.prisma.spin.findFirst({ where: { redeemIdempotencyKey: idempotencyKey } });
    if (existing) {
      if (existing.membershipId !== membershipId || existing.sectorIndex === null || existing.coinsAwarded === null) {
        throw new IdempotencyConflictException(idempotencyKey, { spinId: existing.id });
      }
      return { sectorIndex: existing.sectorIndex, coinsAwarded: existing.coinsAwarded };
    }

    for (;;) {
      const candidate = await this.prisma.spin.findFirst({
        where: { membershipId, status: 'PENDING' },
        orderBy: { expiresAt: 'asc' },
      });

      if (!candidate) {
        throw new NoSpinAvailableException();
      }

      if (candidate.expiresAt < new Date()) {
        await this.expireOne(candidate);
        continue;
      }

      const { sectorIndex, coinsAwarded } = drawSector();
      const claimed = await this.claimAndCredit(candidate, walletId, sectorIndex, coinsAwarded, idempotencyKey);

      if (claimed) {
        return { sectorIndex, coinsAwarded };
      }
      // count === 0 nesse claim: outra requisição concorrente já pegou esse giro — tenta o
      // próximo candidato PENDING, sem repetir o sorteio no giro perdido.
    }
  }

  /** Claim atômico do giro + crédito via LedgerService — tudo numa transação. `null` sinaliza
   * corrida perdida (outra requisição já reivindicou este giro específico); quem chama tenta
   * o próximo candidato. */
  private async claimAndCredit(
    candidate: Spin,
    walletId: string,
    sectorIndex: number,
    coinsAwarded: number,
    idempotencyKey: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.spin.updateMany({
        where: { id: candidate.id, status: 'PENDING' },
        data: {
          status: 'REDEEMED',
          sectorIndex,
          coinsAwarded,
          redeemIdempotencyKey: idempotencyKey,
          redeemedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        return false;
      }

      const remainder = SPIN_RESERVED_AMOUNT - coinsAwarded;
      if (remainder > 0) {
        await tx.coinBatch.update({
          where: { id: candidate.reservedBatchId },
          data: { remainingCoins: { increment: remainder } },
        });
      }

      const entry = await this.ledgerService.post(
        {
          walletId,
          type: 'CREDIT',
          amount: coinsAwarded,
          referenceType: 'SPIN',
          referenceId: candidate.id,
          description: 'Prêmio da roleta',
          batchId: candidate.reservedBatchId,
          idempotencyKey: `spin-redeem:${idempotencyKey}`,
        },
        tx,
      );

      await tx.spin.update({ where: { id: candidate.id }, data: { ledgerEntryId: entry.id } });

      return true;
    });
  }

  /** Varre e libera só os giros PENDING vencidos do PRÓPRIO chamador (escopo pequeno,
   * intencional — não é uma varredura global da plataforma, isso exigiria um job dedicado,
   * mesma situação do expire-coins de CoinBatch que ainda não existe). */
  private async expireCallerSpins(membershipId: string): Promise<void> {
    const expired = await this.prisma.spin.findMany({
      where: { membershipId, status: 'PENDING', expiresAt: { lt: new Date() } },
    });

    for (const spin of expired) {
      await this.expireOne(spin);
    }
  }

  private async expireOne(spin: Spin): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.spin.updateMany({ where: { id: spin.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      if (updated.count === 1) {
        await tx.coinBatch.update({
          where: { id: spin.reservedBatchId },
          data: { remainingCoins: { increment: SPIN_RESERVED_AMOUNT } },
        });
      }
    });
  }
}
