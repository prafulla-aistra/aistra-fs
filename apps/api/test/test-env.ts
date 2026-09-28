/** Fixed settings for the integration tests (the database URL is derived in global-setup). */
export const TEST_ENV = {
  MASTER_NAME: 'Test master',
  MASTER_EMAIL: 'master@test.local',
  MASTER_PASSWORD: 'MasterPass123',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BCRYPT_ROUNDS: '4', // fast hashing for tests
  COOKIE_SECURE: 'false',
};
