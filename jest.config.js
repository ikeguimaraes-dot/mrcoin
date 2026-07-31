module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testTimeout: 30000,
  // Cada arquivo de spec abre seu próprio pool de conexões Prisma contra o Neon real (sem
  // Docker/mocks). maxWorkers: 2 ainda deixava a suíte inteira ocasionalmente flaky
  // (specs sem relação nenhuma com o que mudou, tipo signup/wallets, falhando por timeout
  // de cleanup) — só serial (maxWorkers: 1, equivalente a --runInBand) ficou consistente
  // em execuções repetidas. Mais lento, mas essa suíte roda contra Neon/Redis reais (sem
  // Docker), preferimos confiabilidade a velocidade aqui.
  maxWorkers: 1,
  transformIgnorePatterns: ['node_modules/(?!.*(@scure|@noble))'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true, tsconfig: { allowJs: true } }],
  },
};
