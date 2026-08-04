import { maskCpf } from './cpf-crypto.util';

describe('maskCpf', () => {
  it('mantém os 3 primeiros e os 2 últimos dígitos, escondendo o miolo', () => {
    expect(maskCpf('52912345625')).toBe('529..-25');
  });

  it('formato é sempre 3 dígitos + ".." + "-" + 2 dígitos, pra qualquer CPF de 11 dígitos', () => {
    expect(maskCpf('00000000000')).toBe('000..-00');
    expect(maskCpf('98765432100')).toBe('987..-00');
  });
});
