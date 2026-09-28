import bcrypt from 'bcryptjs';
import { passwordProblems } from '@finance-close/shared';
import { ApiError } from '../common/api-error';

// bcryptjs: the bcrypt algorithm in plain JavaScript (no native build tools needed).

export function hashPassword(password: string, rounds: number): Promise<string> {
  return bcrypt.hash(password, rounds);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Throws a 400 with a readable message if the password breaks the policy. */
export function assertPasswordPolicy(password: string, label = 'Password'): void {
  const problems = passwordProblems(password);
  if (problems.length > 0) throw ApiError.validation(`${label} ${problems.join(', ')}.`);
}

/** Emails are the login id: compared and stored trimmed and lower-case. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
