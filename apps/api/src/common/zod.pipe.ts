import { PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { ApiError } from './api-error';

/**
 * Validates a request body / query against a zod schema:
 *   @Body(new ZodPipe(schema)) body: Output
 * Failures become 400 VALIDATION_FAILED with a readable message naming each field.
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const message = result.error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    throw ApiError.validation(message);
  }
}
