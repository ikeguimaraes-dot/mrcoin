import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { verifyPassword } from '../auth/password.util';
import { InvalidCredentialsException } from '../auth/exceptions/invalid-credentials.exception';
import { PartnerTokenPair, PartnerTokenService, RequestMeta } from './partner-token.service';

/**
 * Login do parceiro por e-mail (contactEmail) + senha. Um Partner sem passwordHash setado
 * (ainda não provisionado) falha exatamente como senha errada — mesma exceção genérica, pra
 * não vazar se o e-mail existe ou só não tem acesso liberado.
 */
@Injectable()
export class PartnerLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnerTokenService: PartnerTokenService,
  ) {}

  async login(email: string, password: string, meta: RequestMeta = {}): Promise<PartnerTokenPair> {
    const partner = await this.prisma.partner.findFirst({ where: { contactEmail: email.toLowerCase() } });

    if (!partner || !partner.passwordHash) {
      throw new InvalidCredentialsException();
    }

    const passwordValid = await verifyPassword(partner.passwordHash, password);
    if (!passwordValid) {
      throw new InvalidCredentialsException();
    }

    return this.partnerTokenService.issueTokenPair(partner.id, meta);
  }
}
