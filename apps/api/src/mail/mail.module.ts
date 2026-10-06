import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { resolveFromRepoRoot } from '../config/paths';
import { MailService, OutboxMailService, SmtpMailService } from './mail.service';

/** Provides MailService; the back-end is chosen by MAIL_DRIVER. */
@Global()
@Module({
  providers: [
    {
      provide: MailService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailService => {
        const from = config.get('MAIL_FROM', { infer: true });
        if (config.get('MAIL_DRIVER', { infer: true }) === 'smtp') {
          const host = config.get('SMTP_HOST', { infer: true });
          Logger.log(`Email: SMTP ${host}`, 'MailModule');
          return new SmtpMailService(
            {
              host,
              port: config.get('SMTP_PORT', { infer: true }),
              secure: config.get('SMTP_SECURE', { infer: true }),
              user: config.get('SMTP_USER', { infer: true }),
              password: config.get('SMTP_PASSWORD', { infer: true }),
            },
            from,
          );
        }
        const dir = resolveFromRepoRoot(config.get('MAIL_OUTBOX_DIR', { infer: true }));
        Logger.log(`Email: local outbox ${dir}`, 'MailModule');
        return new OutboxMailService(dir, from);
      },
    },
  ],
  exports: [MailService],
})
export class MailModule {}
