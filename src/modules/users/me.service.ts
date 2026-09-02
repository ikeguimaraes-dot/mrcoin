import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptCpf, maskCpf } from '../../common/crypto/cpf-crypto.util';

export interface MeResponse {
  id: string;
  name: string;
  email: string | null;
  cpfMasked: string;
  notificationsEnabled: boolean;
  hasTransactionPin: boolean;
}

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        cpfEncrypted: true,
        notificationsEnabled: true,
        transactionPinHash: true,
      },
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      cpfMasked: maskCpf(decryptCpf(user.cpfEncrypted)),
      notificationsEnabled: user.notificationsEnabled,
      hasTransactionPin: user.transactionPinHash !== null,
    };
  }
}
