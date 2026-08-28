import { createHash, randomBytes } from 'node:crypto';
import { ADMIN_INVITE_TTL_DAYS } from './organizations.constants';

export interface GeneratedInviteToken {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

/** Mesmo algoritmo usado por todo emissor de AdminInvite — AdminInvitesService.invite() e
 * createOrganizationWithOwnerInvite() (via bootstrap-owner.ts e o CRUD de platform admin)
 * precisam gerar o hash do mesmo jeito, senão AdminInvitesService.accept() nunca acha o
 * convite pelo tokenHash. */
export function generateInviteToken(): GeneratedInviteToken {
  const rawToken = randomBytes(32).toString('hex');
  return {
    rawToken,
    tokenHash: hashInviteToken(rawToken),
    expiresAt: new Date(Date.now() + ADMIN_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}

export function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
