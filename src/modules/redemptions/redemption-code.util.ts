import { randomInt } from 'node:crypto';

/** Só dígitos — sem letra misturada não existe ambiguidade O/0 ou I/1 pra evitar. */
const PICKUP_CODE_ALPHABET = '0123456789';
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
