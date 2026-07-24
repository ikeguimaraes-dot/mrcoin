import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

/** Criptografa com AES-256-GCM. Formato: iv:ciphertext:authTag, tudo em hex. */
export function encryptWithKey(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, ciphertext, authTag].map((buffer) => buffer.toString('hex')).join(':');
}

/** Reverte encryptWithKey. */
export function decryptWithKey(encrypted: string, keyHex: string): string {
  const [ivHex, ciphertextHex, authTagHex] = encrypted.split(':');
  if (!ivHex || !ciphertextHex || !authTagHex) {
    throw new Error('Formato inválido de valor criptografado');
  }

  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}
