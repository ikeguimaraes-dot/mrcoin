import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { centsToReais } from '../../common/money/cents-to-reais.util';
import { PspChargeFailedException } from './exceptions/psp-charge-failed.exception';

export interface CreateCustomerInput {
  name: string;
  cpfCnpj: string;
}

export interface CreateCustomerResult {
  id: string;
}

export interface CreatePixChargeInput {
  customerId: string;
  valueInCents: number;
  dueDate: string;
  description: string;
  externalReference: string;
}

export interface CreatePixChargeResult {
  id: string;
  status: string;
}

export interface PixQrCodeResult {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

/** Cliente HTTP fino pro Asaas — só monta requisições e traduz erros. Toda decisão de
 * negócio (criar customer só se faltar, formato do dueDate) fica no BillingService. */
@Injectable()
export class AsaasClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
    return this.request<CreateCustomerResult>('POST', '/customers', {
      name: input.name,
      cpfCnpj: input.cpfCnpj,
    });
  }

  async createPixCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult> {
    return this.request<CreatePixChargeResult>('POST', '/payments', {
      customer: input.customerId,
      billingType: 'PIX',
      value: centsToReais(input.valueInCents),
      dueDate: input.dueDate,
      description: input.description,
      externalReference: input.externalReference,
    });
  }

  async getPixQrCode(chargeId: string): Promise<PixQrCodeResult> {
    return this.request<PixQrCodeResult>('GET', `/payments/${chargeId}/pixQrCode`);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const baseUrl = this.config.get('ASAAS_BASE_URL', { infer: true });
    const apiKey = this.config.get('ASAAS_API_KEY', { infer: true });

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'coins-api',
          access_token: apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new PspChargeFailedException(path, { cause: (error as Error).message });
    }

    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      throw new PspChargeFailedException(path, { status: response.status, payload });
    }

    return payload as T;
  }
}
