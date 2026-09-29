import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env';
import { AccessGuard } from './access-control';
import { AuthController } from './auth.controller';
import { AuthProvider } from './auth-provider';
import { LocalAuthProvider } from './local-auth.provider';
import { SessionCookies } from './session-cookies';
import { SessionUserLoader } from './session-user';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    SessionUserLoader,
    SessionCookies,
    // Swap LocalAuthProvider for a Cognito implementation here; nothing else changes.
    { provide: AuthProvider, useClass: LocalAuthProvider },
    // Applies to every endpoint in the API (deny by default).
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AuthProvider, SessionUserLoader, SessionCookies],
})
export class AuthModule {}
