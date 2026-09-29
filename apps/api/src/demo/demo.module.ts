import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { DemoController } from './demo.controller';

/**
 * Demo accounts and one-click sign-in. Imported by AppModule only when DEMO_MODE=true
 * (ConditionalModule), so with demo mode off its routes are simply not there.
 */
@Module({ controllers: [DemoController] })
export class DemoModule implements OnModuleInit {
  onModuleInit(): void {
    Logger.warn(
      'DEMO MODE is ON: demo accounts can sign in without a password. Never enable this in production.',
      'DemoModule',
    );
  }
}

/** Demo mode is on only for an explicit "true". */
export function demoModeEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.DEMO_MODE?.trim().toLowerCase() === 'true';
}
