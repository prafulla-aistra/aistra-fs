import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type IsoDate,
  parseZohoTrialBalance,
  suggestOrganisationLinks,
  type ZohoChartAccount,
  type ZohoTbResult,
} from '@finance-close/engine';
import {
  AuditAction,
  type ErpFetchDto,
  Permission,
  type ZohoOrganisationDto,
  type ZohoStatusDto,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { SessionUserLoader } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { erpUnavailable, ZohoClient } from './zoho-client.service';

const STATE_TTL_MS = 10 * 60_000;
const COA_MAX_PAGES = 25;

export interface ZohoTrialBalance extends ZohoTbResult {
  organizationId: string;
  organizationName: string;
  /** The report as Zoho returned it (kept with the TB file for checking). */
  raw: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/**
 * Zoho Books integration: one connection (Configuration → Integrations), each Zoho entity
 * linked to its organisation, and the trial balance of an entity for a date range.
 * Connecting, disconnecting and link changes are audited; tokens never reach the audit log.
 */
@Injectable()
export class ZohoService {
  private readonly logger = new Logger('Zoho');
  /** OAuth state → who started the connection (single use, 10 minutes). */
  private readonly pending = new Map<string, { userId: string; expires: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: ZohoClient,
    private readonly users: SessionUserLoader,
  ) {}

  async status(user: AuthUser): Promise<ZohoStatusDto> {
    const [conn, entities, links] = await Promise.all([
      this.prisma.erpConnection.findUnique({ where: { provider: 'ZOHO' } }),
      this.prisma.entity.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.erpOrganisationLink.findMany({ where: { provider: 'ZOHO' } }),
    ]);
    const by = conn
      ? await this.prisma.user.findUnique({
          where: { id: conn.connectedById },
          select: { name: true },
        })
      : null;
    return {
      configured: this.client.configured,
      connected: !!conn,
      connectedBy: by?.name ?? null,
      connectedAt: conn?.connectedAt.toISOString() ?? null,
      accountsServer: conn?.accountsServer ?? null,
      apiDomain: conn?.apiDomain ?? null,
      redirectUri: this.client.redirectUri,
      canEdit: user.permissions.has(Permission.ConfigManage),
      links: entities
        .filter(
          (e) => (e.erp === 'ZOHO' && e.isActive) || links.some((l) => l.entityCode === e.code),
        )
        .map((e) => {
          const l = links.find((x) => x.entityCode === e.code);
          return {
            entityCode: e.code,
            legalName: e.legalName,
            erp: e.erp,
            organizationId: l?.organizationId ?? null,
            organizationName: l?.organizationName ?? null,
          };
        }),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Connect (OAuth) and disconnect
  // ---------------------------------------------------------------------------------------

  connectUrl(user: AuthUser): { url: string } {
    if (!this.client.configured)
      throw ApiError.conflict(
        'Zoho is not set up on the server: set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in apps/api/.env and restart.',
      );
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k);
    const state = randomBytes(24).toString('hex');
    this.pending.set(state, { userId: user.id, expires: now + STATE_TTL_MS });
    return { url: this.client.authorizeUrl(state) };
  }

  /**
   * The browser comes back from Zoho here (no API session on this request: the state proves
   * who started it). Returns the web path to send the browser to.
   */
  async callback(q: {
    code?: string;
    state?: string;
    error?: string;
    accountsServer?: string;
    ip: string | null;
  }): Promise<string> {
    const back = (params: Record<string, string>) =>
      `/configuration/integrations?${new URLSearchParams(params)}`;
    const started = q.state ? this.pending.get(q.state) : undefined;
    if (q.state) this.pending.delete(q.state);
    if (!started || started.expires < Date.now())
      return back({
        zohoError: 'The Zoho sign-in link expired or was already used. Connect again.',
      });
    if (q.error || !q.code)
      return back({
        zohoError:
          q.error === 'access_denied'
            ? 'Access was declined in Zoho.'
            : `Zoho did not complete the sign-in (${q.error ?? 'no code'}).`,
      });
    const user = await this.users.load(started.userId);
    if (!user || user.status !== 'ACTIVE' || !user.permissions.has(Permission.ConfigManage))
      return back({ zohoError: 'You no longer have configuration access.' });

    const accountsServer = this.client.accountsServer(q.accountsServer);
    let tokens;
    try {
      tokens = await this.client.exchangeCode(q.code, accountsServer);
    } catch (e) {
      return back({ zohoError: e instanceof ApiError ? e.message : 'Zoho sign-in failed.' });
    }
    if (!tokens.refreshToken)
      return back({ zohoError: 'Zoho returned no refresh token (offline access). Connect again.' });

    const before = await this.prisma.erpConnection.findUnique({ where: { provider: 'ZOHO' } });
    const data = {
      accountsServer,
      apiDomain: tokens.apiDomain,
      refreshTokenEnc: this.client.encrypt(tokens.refreshToken),
      scope: tokens.scope,
      connectedById: user.id,
      connectedAt: new Date(),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.erpConnection.upsert({
        where: { provider: 'ZOHO' },
        create: { provider: 'ZOHO', ...data },
        update: data,
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ErpConnect,
          entityType: 'ERP_CONNECTION',
          entityId: 'ZOHO',
          oldValue: before
            ? {
                accountsServer: before.accountsServer,
                apiDomain: before.apiDomain,
                scope: before.scope,
              }
            : null,
          newValue: { accountsServer, apiDomain: tokens.apiDomain, scope: tokens.scope },
          ip: q.ip,
        },
        tx,
      );
    });
    // A previous connection's token is no longer needed.
    if (before) {
      try {
        await this.client.revoke(
          before.accountsServer,
          this.client.decrypt(before.refreshTokenEnc),
        );
      } catch {
        /* unreadable old token: nothing to revoke */
      }
    }
    return back({ zoho: 'connected' });
  }

  async disconnect(user: AuthUser, ip: string | null): Promise<ZohoStatusDto> {
    const before = await this.prisma.erpConnection.findUnique({ where: { provider: 'ZOHO' } });
    if (!before) return this.status(user);
    await this.prisma.$transaction(async (tx) => {
      await tx.erpConnection.delete({ where: { provider: 'ZOHO' } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ErpDisconnect,
          entityType: 'ERP_CONNECTION',
          entityId: 'ZOHO',
          oldValue: { accountsServer: before.accountsServer, apiDomain: before.apiDomain },
          newValue: null,
          ip,
        },
        tx,
      );
    });
    try {
      await this.client.revoke(before.accountsServer, this.client.decrypt(before.refreshTokenEnc));
    } catch {
      this.client.forgetAccessToken();
    }
    return this.status(user);
  }

  // ---------------------------------------------------------------------------------------
  // Organisations and entity links
  // ---------------------------------------------------------------------------------------

  private async fetchOrganisations() {
    const body = await this.client.books('organizations', {});
    const list = Array.isArray(body.organizations) ? body.organizations : [];
    return list
      .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
      .map((o) => ({
        organizationId: str(o.organization_id),
        name: str(o.name),
        currencyCode: str(o.currency_code) || null,
      }))
      .filter((o) => o.organizationId && o.name);
  }

  async organisations(): Promise<ZohoOrganisationDto[]> {
    const [orgs, entities] = await Promise.all([
      this.fetchOrganisations(),
      this.prisma.entity.findMany({ where: { erp: 'ZOHO', isActive: true } }),
    ]);
    const suggested = suggestOrganisationLinks(entities, orgs);
    return orgs.map((o) => ({
      ...o,
      suggestedFor: [...suggested].find(([, id]) => id === o.organizationId)?.[0] ?? null,
    }));
  }

  async saveLinks(
    user: AuthUser,
    links: { entityCode: string; organizationId: string | null }[],
    ip: string | null,
  ): Promise<ZohoStatusDto> {
    const wanted = links.filter((l) => l.organizationId);
    const ids = wanted.map((l) => l.organizationId!);
    if (new Set(ids).size !== ids.length)
      throw ApiError.validation('Each Zoho organisation can be linked to one entity only.');
    const orgs = wanted.length ? await this.fetchOrganisations() : [];
    const entities = await this.prisma.entity.findMany({
      where: { code: { in: links.map((l) => l.entityCode) } },
    });
    for (const l of links) {
      const e = entities.find((x) => x.code === l.entityCode);
      if (!e) throw ApiError.validation(`Unknown entity ${l.entityCode}.`);
      if (l.organizationId && e.erp !== 'ZOHO')
        throw ApiError.validation(`${e.code} does not use Zoho (ERP: ${e.erp}).`);
      if (l.organizationId && !orgs.some((o) => o.organizationId === l.organizationId))
        throw ApiError.validation(
          `Organisation ${l.organizationId} is not in the connected Zoho account.`,
        );
    }
    const existing = await this.prisma.erpOrganisationLink.findMany({
      where: { entityCode: { in: links.map((l) => l.entityCode) } },
    });
    await this.prisma.$transaction(async (tx) => {
      for (const l of links) {
        const old = existing.find((x) => x.entityCode === l.entityCode) ?? null;
        if ((old?.organizationId ?? null) === l.organizationId) continue;
        const org = orgs.find((o) => o.organizationId === l.organizationId);
        if (org)
          await tx.erpOrganisationLink.upsert({
            where: { entityCode: l.entityCode },
            create: {
              entityCode: l.entityCode,
              provider: 'ZOHO',
              organizationId: org.organizationId,
              organizationName: org.name,
              updatedById: user.id,
            },
            update: {
              organizationId: org.organizationId,
              organizationName: org.name,
              updatedById: user.id,
            },
          });
        else await tx.erpOrganisationLink.delete({ where: { entityCode: l.entityCode } });
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.ErpLinkChange,
            entityType: 'ENTITY',
            entityId: l.entityCode,
            oldValue: old
              ? { organizationId: old.organizationId, organizationName: old.organizationName }
              : null,
            newValue: org
              ? { organizationId: org.organizationId, organizationName: org.name }
              : null,
            ip,
          },
          tx,
        );
      }
    });
    return this.status(user);
  }

  // ---------------------------------------------------------------------------------------
  // Trial balance
  // ---------------------------------------------------------------------------------------

  /** Upload step: can this entity's TB be fetched? */
  async fetchState(entities: { code: string; erp: string }[]): Promise<Map<string, ErpFetchDto>> {
    const out = new Map<string, ErpFetchDto>();
    const zoho = entities.filter((e) => e.erp === 'ZOHO');
    if (zoho.length === 0) return out;
    const [conn, links] = await Promise.all([
      this.prisma.erpConnection.findUnique({
        where: { provider: 'ZOHO' },
        select: { provider: true },
      }),
      this.prisma.erpOrganisationLink.findMany({
        where: { entityCode: { in: zoho.map((e) => e.code) } },
      }),
    ]);
    for (const e of zoho) {
      const link = links.find((l) => l.entityCode === e.code);
      out.set(e.code, {
        provider: 'ZOHO',
        available: !!conn && !!link,
        reason: !conn
          ? 'Zoho Books is not connected (Configuration → Integrations).'
          : !link
            ? 'No Zoho organisation is linked to this entity (Configuration → Integrations).'
            : null,
        organizationName: link?.organizationName ?? null,
      });
    }
    return out;
  }

  private async chartOfAccounts(organizationId: string): Promise<ZohoChartAccount[]> {
    const out: ZohoChartAccount[] = [];
    for (let page = 1; page <= COA_MAX_PAGES; page++) {
      const body = await this.client.books('chartofaccounts', {
        organization_id: organizationId,
        page: String(page),
        per_page: '200',
      });
      const list = Array.isArray(body.chartofaccounts) ? body.chartofaccounts : [];
      for (const a of list) {
        if (typeof a !== 'object' || a === null) continue;
        const r = a as Record<string, unknown>;
        if (!str(r.account_id)) continue;
        out.push({
          accountId: str(r.account_id),
          code: str(r.account_code).trim() || null,
          name: str(r.account_name),
          type: str(r.account_type) || null,
        });
      }
      const ctx = body.page_context as { has_more_page?: unknown } | undefined;
      if (ctx?.has_more_page !== true) break;
    }
    return out;
  }

  /** The entity's Zoho trial balance between two dates (inclusive). */
  async trialBalance(entityCode: string, from: IsoDate, to: IsoDate): Promise<ZohoTrialBalance> {
    const link = await this.prisma.erpOrganisationLink.findUnique({ where: { entityCode } });
    if (!link)
      throw ApiError.conflict(
        `No Zoho organisation is linked to ${entityCode}. Link it in Configuration → Integrations.`,
      );
    const [chart, raw] = await Promise.all([
      this.chartOfAccounts(link.organizationId),
      this.client.books('reports/trialbalance', {
        organization_id: link.organizationId,
        from_date: from,
        to_date: to,
      }),
    ]);
    const parsed = parseZohoTrialBalance(raw, chart);
    if (parsed.period && (parsed.period.from !== from || parsed.period.to !== to))
      throw erpUnavailable(
        `Zoho returned the trial balance for ${parsed.period.from} to ${parsed.period.to} instead of ${from} to ${to}.`,
      );
    if (parsed.problems.length)
      this.logger.warn(`${entityCode} TB: ${parsed.problems.join(' | ')}`);
    return {
      ...parsed,
      organizationId: link.organizationId,
      organizationName: link.organizationName,
      raw,
    };
  }
}
