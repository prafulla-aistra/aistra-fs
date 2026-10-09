import { Decimal } from '@finance-close/engine';
import type {
  TaskDetailDto,
  TbPreviewDto,
  TbVersionDto,
  UploadStepDto,
  WizardOptionsDto,
  WizardPeriodDto,
  ZohoOrganisationDto,
  ZohoStatusDto,
} from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import { SAMPLE_ENTITIES } from '../prisma/sample-data';
import { ZohoClient } from '../src/integrations/zoho-client.service';
import { createTestApp, deleteNonDemoTasks, MASTER, type TestContext, tokenFor } from './helpers';

/**
 * Zoho Books integration with Zoho stubbed (no network): connect through OAuth, link IN to its
 * organisation by name, fetch IN's Jun-2026 TB from the trial balance report into the normal
 * preview → confirm flow. The stub report carries the IN sample accounts (Aug figures) as
 * net debit / net credit strings, so the fetched TB must tie to the cent like the sample file.
 */
let ctx: TestContext;
let master: string;
let priya: string;
let task: TaskDetailDto;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const pw = (e: string) => DEMO_USERS.find((d) => d.email === e)!.password;
const IN = SAMPLE_ENTITIES.find((e) => e.code === 'IN')!;
const inLines = IN.accounts.filter((a) => a.aug !== '');

const calls: { url: string; form?: string }[] = [];
const ORGS = [
  { organization_id: '60001', name: 'Aistra GenAI India Private Limited', currency_code: 'INR' },
  { organization_id: '60002', name: 'Some Other Company', currency_code: 'USD' },
];
const report = {
  code: 0,
  message: 'success',
  page_context: { from_date: '2026-06-01', to_date: '2026-06-30' },
  trial_balance: [
    {
      name: 'All accounts',
      account_transactions: inLines.map((a, i) => {
        const d = new Decimal(a.aug);
        return {
          account_id: String(9000 + i),
          account_name: a.name,
          // The first account's code comes from the chart of accounts, not the report.
          ...(i === 0 ? {} : { account_code: a.code }),
          account_type: a.type,
          net_debit: d.isPositive() ? d.toFixed(2) : '0.00',
          net_credit: d.isNegative() ? d.abs().toFixed(2) : '0.00',
        };
      }),
    },
  ],
};

beforeAll(async () => {
  ctx = await createTestApp();
  await deleteNonDemoTasks(ctx);
  await ctx.prisma.erpOrganisationLink.deleteMany({});
  await ctx.prisma.erpConnection.deleteMany({});
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  priya = await tokenFor(ctx, 'priya@financeclose.local', pw('priya@financeclose.local'));

  jest
    .spyOn(ctx.app.get(ZohoClient), 'http')
    .mockImplementation(async (url: string, init: { form?: URLSearchParams }) => {
      calls.push({ url, form: init.form?.toString() });
      if (url.endsWith('/oauth/v2/token')) {
        const grant = init.form?.get('grant_type');
        return {
          status: 200,
          body: {
            access_token: grant === 'authorization_code' ? 'at-1' : 'at-2',
            ...(grant === 'authorization_code' ? { refresh_token: 'rt-secret-1' } : {}),
            api_domain: 'https://www.zohoapis.in',
            expires_in: 3600,
          },
        };
      }
      if (url.endsWith('/oauth/v2/token/revoke')) return { status: 200, body: {} };
      if (url.includes('/books/v3/organizations'))
        return { status: 200, body: { code: 0, organizations: ORGS } };
      if (url.includes('/books/v3/chartofaccounts'))
        return {
          status: 200,
          body: {
            code: 0,
            chartofaccounts: [
              {
                account_id: '9000',
                account_code: inLines[0]!.code,
                account_name: inLines[0]!.name,
              },
            ],
            page_context: { has_more_page: false },
          },
        };
      if (url.includes('/books/v3/reports/trialbalance')) return { status: 200, body: report };
      return { status: 404, body: { code: 5, message: 'not stubbed' } };
    });

  const options = (await ctx.http().get('/api/task-wizard/options').set(as(priya)))
    .body as WizardOptionsDto;
  const fyId = options.financialYears.find((f) => f.label === 'FY 2026-27')!.id;
  const periods = (
    await ctx
      .http()
      .get('/api/task-wizard/periods')
      .query({ type: 'SFS', fyId, periodType: 'MONTHLY' })
      .set(as(priya))
  ).body as WizardPeriodDto[];
  const created = await ctx
    .http()
    .post('/api/tasks')
    .set(as(priya))
    .send({
      type: 'SFS',
      periodId: periods.find((p) => p.label === 'Jun-2026')!.id,
      formatCode: 'STATUTORY',
      description: 'Zoho test',
      entityCodes: ['IN', 'UK', 'VS'],
    });
  expect(created.status).toBe(201);
  task = created.body as TaskDetailDto;
});
afterAll(async () => {
  if (ctx) {
    await deleteNonDemoTasks(ctx);
    await ctx.prisma.erpOrganisationLink.deleteMany({});
    await ctx.prisma.erpConnection.deleteMany({});
  }
  await ctx?.app.close();
});

const status = async (token: string) => {
  const res = await ctx.http().get('/api/integrations/zoho').set(as(token));
  expect(res.status).toBe(200);
  return res.body as ZohoStatusDto;
};

describe('Zoho Books connection', () => {
  it('lists the Zoho entities, not connected yet', async () => {
    const s = await status(master);
    expect(s).toMatchObject({ configured: true, connected: false, canEdit: true });
    expect(s.redirectUri).toMatch(/\/api\/integrations\/zoho\/callback$/);
    expect(s.links.map((l) => l.entityCode)).toEqual(
      expect.arrayContaining(['US', 'IN', 'AE', 'UK', 'UC']),
    );
    expect(s.links.map((l) => l.entityCode)).not.toContain('VS');
    expect((await status(priya)).canEdit).toBe(false); // REPORTS_VIEW sees it
  });

  it('only CONFIG_MANAGE may connect', async () => {
    expect((await ctx.http().post('/api/integrations/zoho/connect').set(as(priya))).status).toBe(
      403,
    );
  });

  it('connects through OAuth; the refresh token is stored encrypted, never audited', async () => {
    const res = await ctx.http().post('/api/integrations/zoho/connect').set(as(master));
    expect(res.status).toBe(201);
    const url = new URL((res.body as { url: string }).url);
    expect(url.origin).toBe('https://accounts.zoho.com');
    expect(url.searchParams.get('access_type')).toBe('offline');
    const state = url.searchParams.get('state')!;

    const cb = await ctx
      .http()
      .get('/api/integrations/zoho/callback')
      .query({ code: 'code-1', state, 'accounts-server': 'https://accounts.zoho.in' });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toMatch(/\/configuration\/integrations\?zoho=connected$/);
    // The code was exchanged at the account's own data centre, secrets in the body.
    const token = calls.find((c) => c.url === 'https://accounts.zoho.in/oauth/v2/token')!;
    expect(token.form).toContain('grant_type=authorization_code');
    expect(token.form).toContain('client_secret=test-zoho-secret');

    const conn = await ctx.prisma.erpConnection.findUniqueOrThrow({ where: { provider: 'ZOHO' } });
    expect(conn.apiDomain).toBe('https://www.zohoapis.in');
    expect(conn.refreshTokenEnc).not.toContain('rt-secret-1');
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'ERP_CONNECT' },
      orderBy: { timestamp: 'desc' },
    });
    expect(JSON.stringify([audit.oldValue, audit.newValue])).not.toContain('rt-secret-1');

    // The state is single use.
    const again = await ctx
      .http()
      .get('/api/integrations/zoho/callback')
      .query({ code: 'code-1', state });
    expect(again.headers.location).toContain('zohoError=');
    expect((await status(master)).connected).toBe(true);
  });
});

describe('organisation links', () => {
  it('suggests the organisation by legal name', async () => {
    const res = await ctx.http().get('/api/integrations/zoho/organizations').set(as(master));
    expect(res.status).toBe(200);
    const orgs = res.body as ZohoOrganisationDto[];
    expect(orgs.find((o) => o.organizationId === '60001')!.suggestedFor).toBe('IN');
    expect(orgs.find((o) => o.organizationId === '60002')!.suggestedFor).toBeNull();
  });

  it('saves links (audited); one organisation per entity; Zoho entities only', async () => {
    const put = (links: unknown) =>
      ctx.http().put('/api/integrations/zoho/links').set(as(master)).send({ links });
    expect(
      (
        await put([
          { entityCode: 'IN', organizationId: '60001' },
          { entityCode: 'UK', organizationId: '60001' },
        ])
      ).status,
    ).toBe(400);
    expect((await put([{ entityCode: 'VS', organizationId: '60002' }])).status).toBe(400);
    const ok = await put([{ entityCode: 'IN', organizationId: '60001' }]);
    expect(ok.status).toBe(200);
    expect((ok.body as ZohoStatusDto).links.find((l) => l.entityCode === 'IN')).toMatchObject({
      organizationId: '60001',
      organizationName: 'Aistra GenAI India Private Limited',
    });
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'ERP_LINK_CHANGE', entityId: 'IN' } }),
    ).toBeGreaterThan(0);
  });
});

describe('trial balance from Zoho', () => {
  it('the upload step says which entities can fetch', async () => {
    const res = await ctx.http().get(`/api/tasks/${task.id}/upload-step`).set(as(priya));
    const cards = (res.body as UploadStepDto).entities;
    const card = (c: string) => cards.find((x) => x.code === c)!;
    expect(card('IN').erpFetch).toMatchObject({ available: true, reason: null });
    expect(card('UK').erpFetch).toMatchObject({ available: false });
    expect(card('UK').erpFetch!.reason).toMatch(/No Zoho organisation/);
    expect(card('VS').erpFetch).toBeNull(); // Xero
  });

  it('fetches the task period into the usual preview, tied to the cent', async () => {
    const res = await ctx.http().post(`/api/tasks/${task.id}/entities/IN/tb/zoho`).set(as(priya));
    expect(res.status).toBe(201);
    const p = res.body as TbPreviewDto;
    const tb = calls.filter((c) => c.url.includes('reports/trialbalance')).at(-1)!;
    const q = new URL(tb.url).searchParams;
    expect([q.get('organization_id'), q.get('from_date'), q.get('to_date')]).toEqual([
      '60001',
      '2026-06-01',
      '2026-06-30',
    ]);
    expect(p.settingsSource).toBe('ERP');
    expect(p.fileName).toBe('Zoho TB IN 2026-06-01 to 2026-06-30.csv');
    expect(p.detectedPeriod).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(p.check!.errors).toEqual([]);
    expect(p.check!.needsAcknowledgement).toEqual([]); // organisation and period match
    expect(p.check!.balanced).toBe(true);
    expect(p.check!.totals.difference).toBe('0.00');
    expect(p.check!.lineCount).toBe(inLines.length);
    expect(p.check!.info.map((i) => i.code)).toContain('ERP_SOURCE');
    // The first code came from the chart of accounts; every amount is the sample's, exactly.
    expect(p.preview[0]!.code).toBe(inLines[0]!.code);
    for (const l of p.preview)
      expect(new Decimal(l.amount!).equals(inLines.find((a) => a.code === l.code)!.aug)).toBe(true);

    const profileBefore = await ctx.prisma.uploadProfile.findUnique({
      where: { entityCode: 'IN' },
    });
    const ok = await ctx
      .http()
      .post(`/api/tasks/${task.id}/entities/IN/tb/confirm`)
      .set(as(priya))
      .send({ fileId: p.fileId, settings: p.settings, acknowledged: [] });
    expect(ok.status).toBe(201);
    const v = ok.body as TbVersionDto;
    expect(v.file.source).toBe('ZOHO');
    expect(v.status).not.toBe('ERROR');
    // The column profile of uploaded files is left alone.
    const profileAfter = await ctx.prisma.uploadProfile.findUnique({ where: { entityCode: 'IN' } });
    expect(profileAfter?.settings ?? null).toEqual(profileBefore?.settings ?? null);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'ERP_TB_FETCH' } })).toBeGreaterThan(
      0,
    );
  });

  it('refuses entities without Zoho or without a link', async () => {
    const vs = await ctx.http().post(`/api/tasks/${task.id}/entities/VS/tb/zoho`).set(as(priya));
    expect(vs.status).toBe(400);
    const uk = await ctx.http().post(`/api/tasks/${task.id}/entities/UK/tb/zoho`).set(as(priya));
    expect(uk.status).toBe(409);
    expect(uk.body.message).toMatch(/No Zoho organisation is linked to UK/);
  });

  it('a report Zoho returns for other dates is refused', async () => {
    const saved = report.page_context;
    report.page_context = { from_date: '2026-04-01', to_date: '2026-06-30' };
    const res = await ctx.http().post(`/api/tasks/${task.id}/entities/IN/tb/zoho`).set(as(priya));
    report.page_context = saved;
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('ERP_UNAVAILABLE');
  });
});

describe('disconnect', () => {
  it('removes the connection and revokes the token', async () => {
    const res = await ctx.http().delete('/api/integrations/zoho').set(as(master));
    expect(res.status).toBe(200);
    expect((res.body as ZohoStatusDto).connected).toBe(false);
    expect(calls.some((c) => c.url.endsWith('/oauth/v2/token/revoke'))).toBe(true);
    const fetch = await ctx.http().post(`/api/tasks/${task.id}/entities/IN/tb/zoho`).set(as(priya));
    expect(fetch.status).toBe(409);
  });
});
