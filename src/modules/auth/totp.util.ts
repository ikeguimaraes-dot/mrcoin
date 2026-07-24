import { generateSecret, generateURI, verify } from 'otplib';

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildOtpauthUrl(secret: string, accountEmail: string, issuer: string): string {
  return generateURI({ issuer, label: accountEmail, secret });
}

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  const result = await verify({ secret, token: code });
  return result.valid;
}
