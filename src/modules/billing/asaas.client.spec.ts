import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { AsaasClient } from './asaas.client';

/** Bate direto no sandbox real do Asaas (sem mock) — mesma filosofia de teste do resto do
 * repo (Neon/Redis reais). Exige ASAAS_API_KEY sandbox válida no `.env`. */
const configService = new ConfigService<Env, true>(process.env);
const asaasClient = new AsaasClient(configService);

/** Gera um CNPJ com dígitos verificadores válidos (mod 11) — o Asaas rejeita
 * `cpfCnpj` com checksum inválido ao criar um customer. */
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

describe('AsaasClient (sandbox real)', () => {
  it('cria customer, cria cobrança Pix e busca o QR Code', async () => {
    const customer = await asaasClient.createCustomer({
      name: `Coins API Teste ${randomUUID()}`,
      cpfCnpj: generateValidCnpj(),
    });
    expect(customer.id.length).toBeGreaterThan(0);

    const dueDate = new Date().toISOString().slice(0, 10);
    const charge = await asaasClient.createPixCharge({
      customerId: customer.id,
      valueInCents: 150000,
      dueDate,
      description: 'Teste automatizado — coins-api',
      externalReference: `test-${randomUUID()}`,
    });
    expect(charge.id.length).toBeGreaterThan(0);
    expect(charge.status).toBe('PENDING');

    const qrCode = await asaasClient.getPixQrCode(charge.id);
    expect(qrCode.encodedImage.length).toBeGreaterThan(0);
    expect(qrCode.payload.length).toBeGreaterThan(0);
    expect(qrCode.expirationDate).toBeTruthy();
  }, 30000);
});
