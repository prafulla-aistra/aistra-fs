import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The caller's IP address for the audit log. Express resolves X-Forwarded-For only from
 * trusted proxies (see `trust proxy` in main.ts), so this cannot be spoofed by clients.
 */
export function clientIp(req: Request): string | null {
  const ip = req.ip ?? req.socket.remoteAddress ?? null;
  return ip ? ip.replace(/^::ffff:/, '') : null;
}

/** Controller parameter decorator: `@ClientIp() ip: string | null`. */
export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  clientIp(ctx.switchToHttp().getRequest<Request>()),
);
