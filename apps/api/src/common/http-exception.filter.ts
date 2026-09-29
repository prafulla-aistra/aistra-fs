import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiErrorCode } from '@finance-close/shared';
import type { Response } from 'express';
import { ApiError } from './api-error';

/**
 * Gives every error response the { statusCode, code, message } shape, including Nest's
 * built-in exceptions (bad UUID, unknown route) and unexpected crashes. Internal details
 * of unexpected errors are logged, never sent to the browser.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof ApiError) {
      res.status(err.getStatus()).json(err.getResponse());
      return;
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const body = err.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      const message =
        status === HttpStatus.PAYLOAD_TOO_LARGE
          ? 'The file is larger than the 10 MB limit.'
          : Array.isArray(raw)
            ? raw.join('; ')
            : String(raw ?? err.message);
      res.status(status).json({ statusCode: status, code: codeFor(status), message });
      return;
    }

    if (isDatabaseUnavailable(err)) {
      const lastLine = (err as Error).message.trim().split('\n').at(-1);
      this.logger.error(`Database unavailable: ${lastLine}`);
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: ApiErrorCode.DatabaseUnavailable,
        message:
          "The server can't reach its database right now. Check the app is running (npm run dev) and try again.",
      });
      return;
    }

    this.logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.InternalError,
      message:
        'Something went wrong on the server. Please try again; if it keeps happening, contact support.',
    });
  }
}

function codeFor(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return ApiErrorCode.ValidationFailed;
    case 401:
      return ApiErrorCode.NotAuthenticated;
    case 403:
      return ApiErrorCode.PermissionDenied;
    case 404:
      return ApiErrorCode.NotFound;
    case 409:
      return ApiErrorCode.Conflict;
    case 413:
      return ApiErrorCode.FileRejected;
    default:
      return status >= 500 ? ApiErrorCode.InternalError : ApiErrorCode.ValidationFailed;
  }
}

/** Prisma errors that mean "cannot talk to PostgreSQL", as opposed to a bug or bad data. */
const CONNECTION_ERROR_CODES = new Set([
  'P1001', // can't reach database server
  'P1002', // database server timed out
  'P1008', // operation timed out
  'P1017', // server closed the connection
  'P2024', // timed out waiting for a connection from the pool
]);

export function isDatabaseUnavailable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError)
    return CONNECTION_ERROR_CODES.has(err.code);
  return false;
}
