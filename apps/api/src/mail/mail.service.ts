import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text body. */
  text: string;
}

/**
 * Sending email, behind one interface (like StorageService): business code never talks to a
 * mail server directly. MAIL_DRIVER chooses the back-end.
 */
export abstract class MailService {
  abstract send(message: MailMessage): Promise<void>;
  /** Where mail goes, for the UI ("your email" vs "the local outbox"). */
  abstract readonly delivery: 'EMAIL' | 'OUTBOX';
}

/** Local use without a mail server: each email becomes a text file; the API log shows it. */
export class OutboxMailService extends MailService {
  readonly delivery = 'OUTBOX' as const;
  private readonly logger = new Logger('Mail');

  constructor(
    private readonly dir: string,
    private readonly from: string,
  ) {
    super();
  }

  async send(m: MailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = m.to.replace(/[^a-z0-9@._-]/gi, '_');
    const file = path.join(this.dir, `${stamp}-${safe}.txt`);
    await writeFile(
      file,
      `From: ${this.from}\nTo: ${m.to}\nSubject: ${m.subject}\nDate: ${new Date().toUTCString()}\n\n${m.text}\n`,
      'utf8',
    );
    this.logger.log(`Email to ${m.to} written to ${file}`);
  }
}

export class SmtpMailService extends MailService {
  readonly delivery = 'EMAIL' as const;
  private readonly transport: nodemailer.Transporter;

  constructor(
    options: { host: string; port: number; secure: boolean; user: string; password: string },
    private readonly from: string,
  ) {
    super();
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user ? { auth: { user: options.user, pass: options.password } } : {}),
    });
  }

  async send(m: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text });
  }
}
