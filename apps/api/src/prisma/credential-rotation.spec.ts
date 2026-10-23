import { Prisma } from '@prisma/client';
import {
  isDatabaseAuthFailure,
  resetCredentialRotationState,
  restartIfDatabaseCredentialsRotated,
} from './credential-rotation';

const authError = new Prisma.PrismaClientKnownRequestError(
  'Authentication failed against database server, the provided database credentials for `mis_app` are not valid.',
  { code: 'P1000', clientVersion: '6.19.3' },
);
const otherError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: '6.19.3',
});

describe('credential rotation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetCredentialRotationState();
  });
  afterEach(() => jest.useRealTimers());

  it('recognises a rejected password', () => {
    expect(isDatabaseAuthFailure(authError)).toBe(true);
    expect(isDatabaseAuthFailure(new Error('password authentication failed for user "x"'))).toBe(
      true,
    );
    expect(isDatabaseAuthFailure(otherError)).toBe(false);
    expect(isDatabaseAuthFailure('nope')).toBe(false);
  });

  it('exits once, only when the password comes from a rotating secret', () => {
    const exit = jest.fn();
    expect(restartIfDatabaseCredentialsRotated(authError, {}, exit)).toBe(false);
    expect(restartIfDatabaseCredentialsRotated(otherError, { DB_SECRET_ARN: 'arn' }, exit)).toBe(
      false,
    );
    expect(restartIfDatabaseCredentialsRotated(authError, { DB_SECRET_ARN: 'arn' }, exit)).toBe(
      true,
    );
    expect(restartIfDatabaseCredentialsRotated(authError, { DB_SECRET_ARN: 'arn' }, exit)).toBe(
      false,
    );
    expect(exit).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
