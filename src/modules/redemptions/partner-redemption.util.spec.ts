import { extractFirstName } from './partner-redemption.util';

describe('extractFirstName', () => {
  it('devolve só o primeiro nome de um nome completo', () => {
    expect(extractFirstName('Maria Aparecida da Silva')).toBe('Maria');
  });

  it('mantém nome já composto por uma palavra só', () => {
    expect(extractFirstName('Maria')).toBe('Maria');
  });

  it('ignora espaços extras entre/antes/depois do nome', () => {
    expect(extractFirstName('  Maria   Aparecida  ')).toBe('Maria');
  });
});
