import { createHmac } from 'node:crypto';
import { decryptWithKey, encryptWithKey } from './aes-gcm.util';

function getEncryptionKey(): string {
  const hex = process.env.CPF_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('CPF_ENCRYPTION_KEY não definida no ambiente');
  }
  return hex;
}

function getHashSecret(): string {
  const secret = process.env.CPF_HASH_SECRET;
  if (!secret) {
    throw new Error('CPF_HASH_SECRET não definida no ambiente');
  }
  return secret;
}

/** Criptografa o CPF em repouso (AES-256-GCM). Formato: iv:ciphertext:authTag, tudo em hex. */
export function encryptCpf(cpf: string): string {
  return encryptWithKey(cpf, getEncryptionKey());
}

/** Reverte encryptCpf. Não é usado pelo seed, mas fica junto por ser a mesma fronteira de criptografia. */
export function decryptCpf(encrypted: string): string {
  return decryptWithKey(encrypted, getEncryptionKey());
}

/** HMAC-SHA256 do CPF, usado como coluna buscável (cpfHash) sem expor o valor em claro. */
export function hashCpf(cpf: string): string {
  return createHmac('sha256', getHashSecret()).update(cpf).digest('hex');
}
