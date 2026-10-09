import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiErrorCode } from '@finance-close/shared';
import { ApiError } from '../common/api-error';
import { type Env, ZOHO_ACCOUNTS_SERVER } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Allowed API hosts (returned with the token; one per data centre). */
const ZOHO_API_DOMAIN = /^https:\/\/(www\.)?zohoapis\.(com|in|eu|com\.au|jp|ca|sa|uk|com\.cn)$/;
const TIMEOUT_MS = 30_000;

export interface ZohoTokens {
  accessToken: string;
  refreshToken: string | null;
  apiDomain: string;
  expiresIn: number;
  scope: string;
}

export const erpUnavailable = (message: string) =>
  new ApiError(HttpStatus.BAD_GATEWAY, ApiErrorCode.ErpUnavailable, message);

/**
 * Talks to Zoho: the OAuth 2.0 authorization-code flow (offline access, so a refresh token is
 * returned), access-token refresh, and GET requests to the Zoho Books v3 API.
 *
 * The refresh token is kept encrypted in erp_connection (AES-256-GCM, key derived from
 * JWT_SECRET with HKDF); access tokens live only in memory for their hour.
 */
@Injectable()
export class ZohoClient {
  private readonly logger = new Logger('Zoho');
  private access: { token: string; expires: number } | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  get configured(): boolean {
    return (
      !!this.config.get('ZOHO_CLIENT_ID', { infer: true }) &&
      !!this.config.get('ZOHO_CLIENT_SECRET', { infer: true })
    );
  }

  get redirectUri(): string {
    return this.config.get('ZOHO_REDIRECT_URI', { infer: true });
  }

  /** The Zoho sign-in / consent page. */
  authorizeUrl(state: string): string {
    const q = new URLSearchParams({
      scope: this.config.get('ZOHO_SCOPE', { infer: true }),
      client_id: this.config.get('ZOHO_CLIENT_ID', { infer: true }),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      redirect_uri: this.redirectUri,
      state,
    });
    return `${this.config.get('ZOHO_ACCOUNTS_URL', { infer: true })}/oauth/v2/auth?${q}`;
  }

  /** The accounts server Zoho named in the callback, if it is a real Zoho one. */
  accountsServer(fromCallback: string | undefined): string {
    const s = (fromCallback ?? '').replace(/\/+$/, '');
    return ZOHO_ACCOUNTS_SERVER.test(s) ? s : this.config.get('ZOHO_ACCOUNTS_URL', { infer: true });
  }

  /** HTTP for every Zoho call (tests replace it). */
  async http(
    url: string,
    init: { method: 'GET' | 'POST'; headers?: Record<string, string>; form?: URLSearchParams },
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(url, {
      method: init.method,
      headers: init.form
        ? { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' }
        : init.headers,
      body: init.form?.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text.slice(0, 300) };
    }
    return { status: res.status, body };
  }

  private async tokenRequest(accountsServer: string, params: Record<string, string>) {
    const q = new URLSearchParams({
      ...params,
      client_id: this.config.get('ZOHO_CLIENT_ID', { infer: true }),
      client_secret: this.config.get('ZOHO_CLIENT_SECRET', { infer: true }),
    });
    let r: { status: number; body: unknown };
    try {
      // Secrets go in the form body, never in the URL.
      r = await this.http(`${accountsServer}/oauth/v2/token`, { method: 'POST', form: q });
    } catch (e) {
      this.logger.warn(`Token request failed: ${String(e)}`);
      throw erpUnavailable('Zoho could not be reached. Try again later.');
    }
    const b = (r.body ?? {}) as Record<string, unknown>;
    if (r.status >= 400 || typeof b.error === 'string' || typeof b.access_token !== 'string') {
      const reason = typeof b.error === 'string' ? b.error : `HTTP ${r.status}`;
      throw erpUnavailable(
        reason === 'invalid_code'
          ? 'Zoho refused the sign-in code (it expired or was used). Connect again.'
          : reason === 'invalid_client'
            ? 'Zoho does not recognise the API client: check ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET and the data centre.'
            : `Zoho refused the token request (${reason}).`,
      );
    }
    const apiDomain = String(b.api_domain ?? '').replace(/\/+$/, '');
    if (!ZOHO_API_DOMAIN.test(apiDomain))
      throw erpUnavailable(`Zoho returned an unexpected API domain (${apiDomain || 'none'}).`);
    return {
      accessToken: b.access_token,
      refreshToken: typeof b.refresh_token === 'string' ? b.refresh_token : null,
      apiDomain,
      expiresIn: typeof b.expires_in === 'number' ? b.expires_in : 3600,
      scope: typeof b.scope === 'string' ? b.scope : this.config.get('ZOHO_SCOPE', { infer: true }),
    } satisfies ZohoTokens;
  }

  /** Callback: the authorization code → tokens. */
  async exchangeCode(code: string, accountsServer: string): Promise<ZohoTokens> {
    const t = await this.tokenRequest(accountsServer, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });
    this.access = { token: t.accessToken, expires: Date.now() + (t.expiresIn - 120) * 1000 };
    return t;
  }

  async revoke(accountsServer: string, refreshToken: string): Promise<void> {
    try {
      await this.http(`${accountsServer}/oauth/v2/token/revoke`, {
        method: 'POST',
        form: new URLSearchParams({ token: refreshToken }),
      });
    } catch (e) {
      this.logger.warn(`Token revoke failed: ${String(e)}`);
    }
    this.access = null;
  }

  forgetAccessToken(): void {
    this.access = null;
  }

  private async connection() {
    const c = await this.prisma.erpConnection.findUnique({ where: { provider: 'ZOHO' } });
    if (!c)
      throw ApiError.conflict(
        'Zoho Books is not connected. Connect it in Configuration → Integrations.',
      );
    return c;
  }

  private async accessToken(force = false): Promise<{ token: string; apiDomain: string }> {
    const c = await this.connection();
    if (!force && this.access && this.access.expires > Date.now())
      return { token: this.access.token, apiDomain: c.apiDomain };
    const t = await this.tokenRequest(c.accountsServer, {
      grant_type: 'refresh_token',
      refresh_token: this.decrypt(c.refreshTokenEnc),
    });
    this.access = { token: t.accessToken, expires: Date.now() + (t.expiresIn - 120) * 1000 };
    return { token: t.accessToken, apiDomain: c.apiDomain };
  }

  /** GET a Zoho Books v3 resource; one retry with a fresh token after a 401. */
  async books(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { token, apiDomain } = await this.accessToken(attempt > 0);
      let r: { status: number; body: unknown };
      try {
        r = await this.http(`${apiDomain}/books/v3/${path}?${new URLSearchParams(params)}`, {
          method: 'GET',
          headers: { Authorization: `Zoho-oauthtoken ${token}` },
        });
      } catch (e) {
        this.logger.warn(`GET ${path} failed: ${String(e)}`);
        throw erpUnavailable('Zoho Books could not be reached. Try again later.');
      }
      if (r.status === 401 && attempt === 0) continue;
      const b = (r.body ?? {}) as Record<string, unknown>;
      if (r.status >= 400 || (typeof b.code === 'number' && b.code !== 0)) {
        const msg = typeof b.message === 'string' ? b.message : `HTTP ${r.status}`;
        throw erpUnavailable(
          r.status === 401
            ? 'Zoho no longer accepts the connection. Connect Zoho Books again in Configuration → Integrations.'
            : r.status === 429
              ? 'Zoho Books rate limit reached. Wait a minute and try again.'
              : `Zoho Books refused the request: ${msg}`,
        );
      }
      return b;
    }
    throw erpUnavailable('Zoho Books refused the request.');
  }

  // ---------------------------------------------------------------------------------------
  // Refresh-token encryption
  // ---------------------------------------------------------------------------------------

  private key(): Buffer {
    return Buffer.from(
      hkdfSync(
        'sha256',
        this.config.get('JWT_SECRET', { infer: true }),
        'finance-close',
        'erp-refresh-token',
        32,
      ),
    );
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((x) => (typeof x === 'string' ? x : x.toString('base64')))
      .join('.');
  }

  decrypt(stored: string): string {
    const [v, iv, tag, data] = stored.split('.');
    try {
      if (v !== 'v1' || !iv || !tag || !data) throw new Error('format');
      const d = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
    } catch {
      throw ApiError.conflict(
        'The stored Zoho connection cannot be read (JWT_SECRET changed?). Connect Zoho Books again.',
      );
    }
  }
}
