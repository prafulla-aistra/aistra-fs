import { Body, Controller, Delete, Get, Post, Put, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Permission, type ZohoOrganisationDto, type ZohoStatusDto } from '@finance-close/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import type { Env } from '../config/env';
import { ZohoService } from './zoho.service';

const linksSchema = z.object({
  links: z
    .array(
      z.object({
        entityCode: z.string().regex(/^[A-Z0-9]{1,10}$/, 'Invalid entity code'),
        organizationId: z
          .string()
          .regex(/^\d{1,40}$/, 'Invalid Zoho organisation id')
          .nullable(),
      }),
    )
    .min(1)
    .max(50),
});
const callbackSchema = z.object({
  code: z.string().max(500).optional(),
  state: z.string().max(100).optional(),
  error: z.string().max(200).optional(),
  'accounts-server': z.string().max(200).optional(),
  location: z.string().max(20).optional(),
});

/** Configuration → Integrations: Zoho Books (CONFIG_MANAGE edits, REPORTS_VIEW views). */
@Controller('integrations/zoho')
export class IntegrationsController {
  constructor(
    private readonly zoho: ZohoService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  @RequirePermission(Permission.ConfigManage, Permission.ReportsView)
  status(@CurrentUser() user: AuthUser): Promise<ZohoStatusDto> {
    return this.zoho.status(user);
  }

  /** The Zoho sign-in URL; the browser goes there and Zoho sends it back to /callback. */
  @Post('connect')
  @RequirePermission(Permission.ConfigManage)
  connect(@CurrentUser() user: AuthUser): { url: string } {
    return this.zoho.connectUrl(user);
  }

  /** Zoho's redirect. Public: the one-time state names the user who started the connection. */
  @Get('callback')
  @Public()
  async callback(
    @Query(new ZodPipe(callbackSchema)) q: z.output<typeof callbackSchema>,
    @ClientIp() ip: string | null,
    @Res() res: Response,
  ): Promise<void> {
    const path = await this.zoho.callback({
      code: q.code,
      state: q.state,
      error: q.error,
      accountsServer: q['accounts-server'],
      ip,
    });
    res.redirect(302, `${this.config.get('APP_URL', { infer: true })}${path}`);
  }

  @Delete()
  @RequirePermission(Permission.ConfigManage)
  disconnect(@CurrentUser() user: AuthUser, @ClientIp() ip: string | null): Promise<ZohoStatusDto> {
    return this.zoho.disconnect(user, ip);
  }

  /** Organisations in the connected Zoho account, with name-based suggestions. */
  @Get('organizations')
  @RequirePermission(Permission.ConfigManage)
  organisations(): Promise<ZohoOrganisationDto[]> {
    return this.zoho.organisations();
  }

  @Put('links')
  @RequirePermission(Permission.ConfigManage)
  saveLinks(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(linksSchema)) body: z.output<typeof linksSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ZohoStatusDto> {
    return this.zoho.saveLinks(user, body.links, ip);
  }
}
