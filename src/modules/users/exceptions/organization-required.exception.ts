import { BadRequestException } from '@nestjs/common';

export class OrganizationRequiredException extends BadRequestException {
  constructor() {
    super({
      code: 'ORGANIZATION_REQUIRED',
      message: 'organizationId e membershipType são obrigatórios pra quem ainda não tem conta pendente de reivindicação.',
    });
  }
}
