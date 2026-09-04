import {
  isTrivialPassword,
  passwordContainsCpf,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './password-rules.util';

describe('isTrivialPassword', () => {
  it.each(['12345678', 'password123', 'senha1234', 'minhasenha', 'qwerty123'])(
    'rejeita entrada da lista de senhas comuns: %s',
    (password) => {
      expect(isTrivialPassword(password)).toBe(true);
    },
  );

  it('rejeita entrada da lista de senhas comuns ignorando maiúsculas/minúsculas', () => {
    expect(isTrivialPassword('PaSsWoRd123')).toBe(true);
  });

  it.each(['aaaaaaaa', '11111111', 'zzzzzzzzzzzz'])(
    'rejeita mesmo caractere repetido do início ao fim: %s',
    (password) => {
      expect(isTrivialPassword(password)).toBe(true);
    },
  );

  it.each(['abcdefgh', 'wxyz0123', 'mnopqrst', '01234567'])(
    'rejeita substring de sequência alfanumérica ascendente: %s',
    (password) => {
      expect(isTrivialPassword(password)).toBe(true);
    },
  );

  it.each(['87654321', 'zyxwvuts', 'srqponml'])(
    'rejeita substring de sequência alfanumérica descendente: %s',
    (password) => {
      expect(isTrivialPassword(password)).toBe(true);
    },
  );

  it.each(['Xk9$mQ2vL7', 'correto-cavalo-bateria', 'Tr0pic4lF3st4!'])(
    'aceita senha não trivial: %s',
    (password) => {
      expect(isTrivialPassword(password)).toBe(false);
    },
  );
});

describe('passwordContainsCpf', () => {
  it('rejeita senha contendo o CPF como substring', () => {
    expect(passwordContainsCpf('senha12345678901fim', '12345678901')).toBe(true);
  });

  it('aceita senha sem relação com o CPF', () => {
    expect(passwordContainsCpf('Xk9$mQ2vL7', '12345678901')).toBe(false);
  });
});

describe('limites de tamanho', () => {
  it('PASSWORD_MIN_LENGTH é 8', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it('PASSWORD_MAX_LENGTH é 128', () => {
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });
});
