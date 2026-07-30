import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AsaasClient } from './asaas.client';

export interface PixChargeResult {
  pspChargeId: string;
  qrCodeImage: string;
  copyPasteCode: string;
  expirationDate: string;
}

/** Única porta de saída pro PSP (Asaas) — garante que a Organization tem um customer
 * cadastrado, cria a cobrança Pix e devolve o QR Code. Não escreve em CoinBatch. */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasClient: AsaasClient,
  ) {}

  async createChargeForOrganization(
    organizationId: string,
    priceInCents: number,
    description: string,
    externalReference: string,
  ): Promise<PixChargeResult> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Organização não encontrada.' });
    }

    const asaasCustomerId =
      organization.asaasCustomerId ?? (await this.ensureAsaasCustomer(organization.id, organization.name, organization.cnpj));

    const charge = await this.asaasClient.createPixCharge({
      customerId: asaasCustomerId,
      valueInCents: priceInCents,
      dueDate: todayAsDateString(),
      description,
      externalReference,
    });

    const qrCode = await this.asaasClient.getPixQrCode(charge.id);

    return {
      pspChargeId: charge.id,
      qrCodeImage: qrCode.encodedImage,
      copyPasteCode: qrCode.payload,
      expirationDate: qrCode.expirationDate,
    };
  }

  /** Rebusca o QR Code de uma cobrança já criada — usado no replay de uma requisição
   * idempotente, pra não precisar persistir a imagem do QR Code. */
  async refetchQrCode(pspChargeId: string): Promise<Pick<PixChargeResult, 'qrCodeImage' | 'copyPasteCode' | 'expirationDate'>> {
    const qrCode = await this.asaasClient.getPixQrCode(pspChargeId);

    return {
      qrCodeImage: qrCode.encodedImage,
      copyPasteCode: qrCode.payload,
      expirationDate: qrCode.expirationDate,
    };
  }

  private async ensureAsaasCustomer(organizationId: string, name: string, cnpj: string): Promise<string> {
    const customer = await this.asaasClient.createCustomer({ name, cpfCnpj: cnpj });

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { asaasCustomerId: customer.id },
    });

    return customer.id;
  }
}

function todayAsDateString(): string {
  return new Date().toISOString().slice(0, 10);
}
