/** Fixed settings for the integration tests (the database URL is derived in global-setup). */
export const TEST_ENV = {
  MASTER_NAME: 'Test master',
  MASTER_EMAIL: 'master@test.local',
  MASTER_PASSWORD: 'MasterPass123',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BCRYPT_ROUNDS: '4', // fast hashing for tests
  COOKIE_SECURE: 'false',
  DEMO_MODE: 'true', // seeds the demo users and demo tasks into the test database
  FIXED_TODAY: '2026-09-29', // dashboard logic is tested against a known date
  STORAGE_LOCAL_DIR: './data/uploads-test', // test uploads never mix with development files
  MAIL_DRIVER: 'outbox',
  MAIL_OUTBOX_DIR: './data/outbox-test', // emails written by the tests
};
