import * as argon2 from 'argon2';

/** Hash de senha com argon2id (regra do CLAUDE.md — nunca argon2i/argon2d puro). */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
