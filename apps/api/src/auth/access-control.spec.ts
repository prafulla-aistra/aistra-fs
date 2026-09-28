import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AccessGuard, Public } from './access-control';
import type { AuthProvider } from './auth-provider';
import type { SessionUserLoader } from './session-user';

@Controller()
class Sample {
  @Get('open')
  @Public()
  open(): void {}

  @Get('forgotten')
  forgotten(): void {}
}

function contextFor(handler: () => void): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Sample,
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  } as unknown as ExecutionContext;
}

describe('AccessGuard', () => {
  const guard = new AccessGuard(new Reflector(), {} as AuthProvider, {} as SessionUserLoader);

  it('lets @Public endpoints through without a token', async () => {
    await expect(guard.canActivate(contextFor(Sample.prototype.open))).resolves.toBe(true);
  });

  it('denies by default an endpoint that declares no access policy', async () => {
    await expect(guard.canActivate(contextFor(Sample.prototype.forgotten))).rejects.toMatchObject({
      status: 403,
    });
  });
});
