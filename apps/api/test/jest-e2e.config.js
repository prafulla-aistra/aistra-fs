/** API integration tests: real Nest app + real (test) PostgreSQL database. */
module.exports = {
  rootDir: '..',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/global-setup.ts',
  testTimeout: 60000,
};
