module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testTimeout: 30000,
  // Cada arquivo de spec abre seu próprio pool de conexões Prisma contra o Neon real (sem
  // Docker/mocks). Com o default do Jest (paralelismo ~= núcleos - 1) rodando muitos
  // arquivos ao mesmo tempo, o teste de 1.000 linhas do módulo distributions (alta
  // concorrência interna) mais o resto da suíte em paralelo estourava o limite de conexões
  // do Neon — sintoma: até specs sem relação nenhuma (ex.: auth) davam timeout no cleanup.
  // Reproduzido com --runInBand (100% serial) passando limpo vs. falhando no default.
  maxWorkers: 2,
  transformIgnorePatterns: ['node_modules/(?!.*(@scure|@noble))'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true, tsconfig: { allowJs: true } }],
  },
};
