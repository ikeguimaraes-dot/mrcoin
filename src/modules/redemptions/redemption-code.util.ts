import { randomInt } from 'node:crypto';

/** Alfabeto sem ambiguidade visual: sem O/0 e I/1 (24 letras + 8 dígitos = 32 símbolos). */
const PICKUP_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PICKUP_CODE_LENGTH = 6;

/** Código de retirada curto e legível — o cliente apresenta na entrega (o QR cobre o fluxo
 * de leitura — ver qrPayload). Unicidade é garantida na criação (retry em colisão, ver
 * RedemptionsService), não aqui — essa função só gera o formato. */
export function generatePickupCode(): string {
  let code = '';
  for (let i = 0; i < PICKUP_CODE_LENGTH; i += 1) {
    code += PICKUP_CODE_ALPHABET[randomInt(0, PICKUP_CODE_ALPHABET.length)];
  }
  return code;
}
