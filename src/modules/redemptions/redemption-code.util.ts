import { randomInt } from 'node:crypto';

/** Código de 6 dígitos pra confirmação manual/verbal (o QR cobre o fluxo de leitura —
 * ver qrPayload). Unicidade é garantida na criação (retry em colisão, ver
 * RedemptionsService.generateUniqueCode), não aqui — essa função só gera o formato. */
export function generateRedemptionCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
