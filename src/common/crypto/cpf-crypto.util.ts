import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

function getEncryptionKey(): Buffer {
  const hex = process.env.CPF_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('CPF_ENCRYPTION_KEY não definida no ambiente');
  }
  return Buffer.from(hex, 'hex');
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
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(cpf, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, ciphertext, authTag].map((buffer) => buffer.toString('hex')).join(':');
}

/** Reverte encryptCpf. Não é usado pelo seed, mas fica junto por ser a mesma fronteira de criptografia. */
export function decryptCpf(encrypted: string): string {
  const [ivHex, ciphertextHex, authTagHex] = encrypted.split(':');
  if (!ivHex || !ciphertextHex || !authTagHex) {
    throw new Error('Formato inválido de CPF criptografado');
  }

  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

/** HMAC-SHA256 do CPF, usado como coluna buscável (cpfHash) sem expor o valor em claro. */
export function hashCpf(cpf: string): string {
  return createHmac('sha256', getHashSecret()).update(cpf).digest('hex');
}
