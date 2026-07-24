import { decryptWithKey, encryptWithKey } from './aes-gcm.util';

function getEncryptionKey(): string {
  const hex = process.env.MFA_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('MFA_ENCRYPTION_KEY não definida no ambiente');
  }
  return hex;
}

/** Criptografa o secret TOTP em repouso (AES-256-GCM), chave separada da do CPF. */
export function encryptMfaSecret(secret: string): string {
  return encryptWithKey(secret, getEncryptionKey());
}

/** Reverte encryptMfaSecret. */
export function decryptMfaSecret(encrypted: string): string {
  return decryptWithKey(encrypted, getEncryptionKey());
}
