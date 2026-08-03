import { createHash, randomInt } from 'node:crypto';
import { OTP_CODE_LENGTH } from './users.constants';

export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_CODE_LENGTH).toString().padStart(OTP_CODE_LENGTH, '0');
}

export function hashOtpCode(rawCode: string): string {
  return createHash('sha256').update(rawCode).digest('hex');
}
