import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Env } from '../../config/env.schema';
import { AsaasClient } from '../billing/asaas.client';
import { BillingService } from '../billing/billing.service';
import { ConversionRateService } from '../settings/conversion-rate.service';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';
import { BatchesService, CreateBatchResult } from './batches.service';

/**
 * Regressão do caminho legado (ASAAS_ENABLED=true) — instancia BatchesService direto com
 * uma config própria em vez de subir o AppModule inteiro com ConfigService sobrescrito
 * (mais frágil: overrides globais vazam entre describe blocks na mesma suíte HTTP). Mesmo
 * padrão de asaas.client.spec.ts: bate no sandbox real do Asaas, sem mock.
 */
const prisma = new PrismaService();
const asaasEnabledConfig = new ConfigService<Env, true>({ ...process.env, ASAAS_ENABLED: true });
const asaasClient = new AsaasClient(asaasEnabledConfig);
const billingService = new BillingService(prisma, asaasClient);
const conversionRateService = new ConversionRateService(prisma);
const batchesService = new BatchesService(prisma, billingService, conversionRateService, asaasEnabledConfig);

const createdOrgIds: string[] = [];
const createdBatchIds: string[] = [];

function generateValidCnpj(): string {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const calcDigit = (nums: number[]): number => {
    const weights = nums.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = nums.reduce((acc, n, i) => acc + n * (weights[i] ?? 0), 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const firstDigit = calcDigit(base);
  const secondDigit = calcDigit([...base, firstDigit]);
  return [...base, firstDigit, secondDigit].join('');
}

async function createOrg(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Batches Service Test Org ${suffix}`, cnpj: generateValidCnpj() },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  return organization;
}

afterAll(async () => {
  await prisma.coinBatch.deleteMany({ where: { id: { in: createdBatchIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('BatchesService com ASAAS_ENABLED=true (caminho legado, sandbox real)', () => {
  it('cria cobrança Pix real no Asaas e persiste o pspChargeId', async () => {
    const org = await createOrg();
    const idempotencyKey = `test-${randomUUID()}`;

    const result: CreateBatchResult = await batchesService.createPendingBatch(
      org.id,
      { totalCoins: 2000, validityMonths: 12 },
      idempotencyKey,
    );
    createdBatchIds.push(result.batch.id);

    expect(result.batch.status).toBe('PENDING');
    expect(result.pix?.method).toBe('ASAAS');
    if (result.pix?.method === 'ASAAS') {
      expect(result.pix.qrCodeImage.length).toBeGreaterThan(0);
      expect(result.pix.copyPasteCode.length).toBeGreaterThan(0);
    }

    const storedBatch = await prisma.coinBatch.findUniqueOrThrow({ where: { id: result.batch.id } });
    expect(storedBatch.pspChargeId).toBeTruthy();
  }, 30000);

  it('replay por Idempotency-Key rebusca o QR Code no PSP em vez de quebrar', async () => {
    const org = await createOrg();
    const idempotencyKey = `test-${randomUUID()}`;

    const first = await batchesService.createPendingBatch(org.id, { totalCoins: 1000, validityMonths: 12 }, idempotencyKey);
    createdBatchIds.push(first.batch.id);

    const replay = await batchesService.createPendingBatch(org.id, { totalCoins: 1000, validityMonths: 12 }, idempotencyKey);
    expect(replay.batch.id).toBe(first.batch.id);
    expect(replay.pix?.method).toBe('ASAAS');
  }, 30000);
});
