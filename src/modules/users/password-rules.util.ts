export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Substring contígua de 8+ caracteres cobre qualquer sequência ascendente detectável nesta
 * lista (letras minúsculas seguidas de dígitos) e sua reversa cobre o caso descendente. */
const ASCENDING_RUN = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DESCENDING_RUN = ASCENDING_RUN.split('').reverse().join('');

/** Lista estática de senhas triviais/comuns (genéricas + pt-BR) — substitui uma checagem de
 * vazamento via API externa (fora de escopo, sem tecnologia nova sem discussão). Case-
 * insensitive na comparação (ver isTrivialPassword). */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '11111111',
  '00000000',
  '123123123',
  'qwertyui',
  'qwertyuiop',
  'qwerty123',
  'qwerty1234',
  'asdfghjk',
  'asdfghjkl',
  'zxcvbnm12',
  '1qaz2wsx',
  '1qaz2wsx3edc',
  'qazwsxedc',
  'letmein123',
  'iloveyou123',
  'welcome123',
  'welcome1234',
  'admin1234',
  'admin12345',
  'dragon123',
  'monkey123',
  'football123',
  'baseball123',
  'master1234',
  'superman123',
  'trustno123',
  'sunshine123',
  'princess123',
  'shadow1234',
  'freedom123',
  'whatever12',
  'starwars12',
  'summer2024',
  'summer2025',
  'summer2026',
  'senha1234',
  'senha12345',
  'senha123456',
  'minhasenha',
  'minhasenha1',
  'minhasenha123',
  'brasil1234',
  'brasil12345',
  'futebol123',
  'vitoria123',
  'palmeiras123',
  'flamengo123',
  'corinthians1',
  'gostosa123',
  'gostoso123',
  'amoreoso12',
  'mudar1234',
  'trocar1234',
  'acesso1234',
  'acesso12345',
  'cliente123',
  'cliente1234',
  'usuario123',
  'usuario1234',
  'contasenha',
  'novasenha1',
  'novasenha123',
  'primeira123',
  'segunda1234',
  'terceira123',
  '12345678910',
  '00000000000',
  '11111111111',
]);

/** Rejeita senha (case-insensitive) igual a: entrada da lista de senhas comuns, mesmo
 * caractere repetido do início ao fim, ou substring de 8+ caracteres de uma sequência
 * alfanumérica ascendente/descendente ("abcdefgh", "wxyz0123", "87654321", ...). */
export function isTrivialPassword(password: string): boolean {
  const lower = password.toLowerCase();

  if (COMMON_PASSWORDS.has(lower)) {
    return true;
  }

  const allSameChar = lower.split('').every((char) => char === lower[0]);
  if (allSameChar) {
    return true;
  }

  if (ASCENDING_RUN.includes(lower) || DESCENDING_RUN.includes(lower)) {
    return true;
  }

  return false;
}

/** Cross-field: senha não pode conter o CPF (11 dígitos crus) como substring. */
export function passwordContainsCpf(password: string, cpf: string): boolean {
  return password.includes(cpf);
}
