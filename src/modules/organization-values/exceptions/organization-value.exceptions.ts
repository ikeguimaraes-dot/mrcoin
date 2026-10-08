import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

/** CRUD: id inexistente OU de outra organização — mesma resposta nos dois casos, pra não
 * revelar que o valor existe em outra empresa. */
export class OrganizationValueNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'ORGANIZATION_VALUE_NOT_FOUND', message: 'Valor não encontrado.' });
  }
}

export class OrganizationValueNameTakenException extends ConflictException {
  constructor() {
    super({
      code: 'ORGANIZATION_VALUE_NAME_TAKEN',
      message: 'Já existe um valor com este nome na organização.',
    });
  }
}

export class OrganizationValueInUseException extends ConflictException {
  constructor() {
    super({
      code: 'ORGANIZATION_VALUE_IN_USE',
      message: 'Este valor já foi usado em reconhecimentos e não pode ser apagado. Desative-o.',
    });
  }
}

/** Distribuição: `organizationValueId` do body não existe ou é de outra organização. 422 (e
 * não 404) porque a rota existe — o que está errado é um campo do body. */
export class RecognitionValueNotFoundException extends UnprocessableEntityException {
  constructor() {
    super({
      code: 'ORGANIZATION_VALUE_NOT_FOUND',
      message: 'Valor da organização não encontrado.',
    });
  }
}

export class RecognitionValueInactiveException extends UnprocessableEntityException {
  constructor() {
    super({
      code: 'ORGANIZATION_VALUE_INACTIVE',
      message: 'Este valor está desativado e não pode ser usado.',
    });
  }
}
