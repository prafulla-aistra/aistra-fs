import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiErrorCode } from '@finance-close/shared';

/**
 * Every error the API returns has the same body: { statusCode, code, message }.
 * `code` is stable for the web app to branch on; `message` is written for the end user.
 */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ApiErrorCode,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super({ statusCode: status, code, message, ...extra }, status);
  }

  static validation(message: string): ApiError {
    return new ApiError(HttpStatus.BAD_REQUEST, ApiErrorCode.ValidationFailed, message);
  }
  static notFound(message: string): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, ApiErrorCode.NotFound, message);
  }
  static conflict(message: string): ApiError {
    return new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, message);
  }
  /** A request that is understood but breaks a business rule (e.g. deactivating the master). */
  static notAllowed(message: string): ApiError {
    return new ApiError(HttpStatus.FORBIDDEN, ApiErrorCode.NotAllowed, message);
  }
}
