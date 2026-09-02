import { isTrivialPin } from './transaction-pin.util';

describe('isTrivialPin', () => {
  it.each(['1111', '0000', '2222', '999999'])('rejeita todos os dígitos iguais: %s', (pin) => {
    expect(isTrivialPin(pin)).toBe(true);
  });

  it.each(['1234', '2345', '6789', '123456'])('rejeita sequência ascendente: %s', (pin) => {
    expect(isTrivialPin(pin)).toBe(true);
  });

  it.each(['4321', '9876', '654321'])('rejeita sequência descendente: %s', (pin) => {
    expect(isTrivialPin(pin)).toBe(true);
  });

  it.each(['8264', '3179', '051829', '9042'])('aceita PIN não trivial: %s', (pin) => {
    expect(isTrivialPin(pin)).toBe(false);
  });
});
