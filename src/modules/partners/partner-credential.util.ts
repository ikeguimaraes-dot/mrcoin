import { randomBytes } from 'node:crypto';

/** Gera a senha de portal do parceiro — usado tanto na criação (senha inicial) quanto no
 * reset (senha nova). Partner não tem fluxo de convite/aceite como AdminInvite (Organization),
 * então a senha nasce no servidor e é devolvida uma única vez na resposta HTTP, mesma
 * entropia de bootstrap-platform-admin.ts. */
export function generatePartnerPassword(): string {
  return randomBytes(24).toString('base64url');
}
