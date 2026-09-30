import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  ErpSystem,
  Gaap,
  type EntityDetailDto,
  type EntityDto,
  type EntityPreviewDto,
  type GroupStructureDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { EditConfig, ViewConfig } from './access';
import { EntitiesService } from './entities.service';

const ccy = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'Currency codes are 3 letters'));

const entityInput = z.object({
  legalName: z.string().trim().min(1, 'Enter the legal name').max(200),
  shortName: z.string().trim().min(1, 'Enter a short name').max(60),
  country: z.string().trim().min(1, 'Enter the country').max(60),
  functionalCurrency: ccy,
  reportingCurrency: ccy,
  translatedCurrencies: z.array(ccy).max(20),
  parentCode: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .nullable(),
  heldByParentPct: z.string().trim().max(20).nullable(),
  materiality: z.string().trim().max(24).nullable().optional(),
  incorporatedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date: YYYY-MM-DD')
    .nullable()
    .optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  erp: z.enum([ErpSystem.Zoho, ErpSystem.Xero, ErpSystem.Other]),
  gaap: z.enum([Gaap.IndAs, Gaap.Ifrs, Gaap.UsGaap, Gaap.UkGaap, Gaap.Other]),
  isActive: z.boolean(),
  toBeConfirmed: z.boolean(),
  toBeConfirmedNote: z.string().trim().max(500).nullable(),
  historicalRates: z
    .array(
      z.object({
        currency: ccy,
        rate: z.string().trim().max(30),
        toBeConfirmed: z.boolean(),
        note: z.string().trim().max(300).nullable(),
      }),
    )
    .max(20),
});

const createSchema = entityInput.extend({
  ownershipEffectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/, 'Effective from: the first day of a month')
    .nullable()
    .optional(),
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2,4}$/, 'Entity code: 2–4 capital letters')),
});

const month = z.string().regex(/^\d{4}-\d{2}-01$/, 'A month: YYYY-MM-01');
const pct = z.string().trim().max(20).nullable();
const code = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .nullable();
const previewSchema = z.object({
  code: z.string().trim().max(10).default(''),
  functionalCurrency: ccy,
  reportingCurrency: ccy,
  translatedCurrencies: z.array(ccy).max(20),
  parentCode: code,
  heldByParentPct: pct,
  effectiveFrom: month,
});
const ownershipSchema = z.object({
  parentCode: code,
  heldByParentPct: pct,
  effectiveFrom: month,
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});
const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
const asAtSchema = z.object({ asAt: month.optional() });
const levelCurrencySchema = z.object({
  currency: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}$/))
    .nullable(),
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});

@Controller('config')
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get('entities')
  @ViewConfig()
  list(): Promise<EntityDto[]> {
    return this.entities.list();
  }

  @Get('entities/:code')
  @ViewConfig()
  get(@Param('code') code: string): Promise<EntityDto> {
    return this.entities.get(code);
  }

  @Post('entities')
  @EditConfig()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(createSchema)) body: z.output<typeof createSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EntityDto> {
    return this.entities.create(actor, body, ip);
  }

  @Patch('entities/:code')
  @EditConfig()
  update(
    @CurrentUser() actor: AuthUser,
    @Param('code') code: string,
    @Body(new ZodPipe(entityInput)) body: z.output<typeof entityInput>,
    @ClientIp() ip: string | null,
  ): Promise<EntityDto> {
    return this.entities.update(actor, code, body, ip);
  }

  @Get('entities/:code/detail')
  @ViewConfig()
  detail(@Param('code') code: string): Promise<EntityDetailDto> {
    return this.entities.detail(code);
  }

  /** Live preview for the add-entity wizard (no change is saved). */
  @Post('entity-preview')
  @ViewConfig()
  preview(
    @Body(new ZodPipe(previewSchema)) body: z.output<typeof previewSchema>,
  ): Promise<EntityPreviewDto> {
    return this.entities.preview(body);
  }

  @Post('entities/:code/ownership')
  @EditConfig()
  changeOwnership(
    @CurrentUser() actor: AuthUser,
    @Param('code') code: string,
    @Body(new ZodPipe(ownershipSchema)) body: z.output<typeof ownershipSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EntityDetailDto> {
    return this.entities.changeOwnership(actor, code, body, ip);
  }

  @Post('entities/:code/deactivate')
  @EditConfig()
  deactivate(
    @CurrentUser() actor: AuthUser,
    @Param('code') code: string,
    @Body(new ZodPipe(reasonSchema)) body: z.output<typeof reasonSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EntityDetailDto> {
    return this.entities.setActive(actor, code, false, body.reason, ip);
  }

  @Post('entities/:code/reactivate')
  @EditConfig()
  reactivate(
    @CurrentUser() actor: AuthUser,
    @Param('code') code: string,
    @Body(new ZodPipe(reasonSchema)) body: z.output<typeof reasonSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EntityDetailDto> {
    return this.entities.setActive(actor, code, true, body.reason, ip);
  }

  /** Tree view and consolidation levels as at a month (?asAt=YYYY-MM-01; default this month). */
  @Get('group-structure')
  @ViewConfig()
  groupStructure(
    @Query(new ZodPipe(asAtSchema)) q: z.output<typeof asAtSchema>,
  ): Promise<GroupStructureDto> {
    return this.entities.groupStructure(q.asAt);
  }

  @Put('levels/:parentCode/currency')
  @EditConfig()
  levelCurrency(
    @CurrentUser() actor: AuthUser,
    @Param('parentCode') parentCode: string,
    @Body(new ZodPipe(levelCurrencySchema)) body: z.output<typeof levelCurrencySchema>,
    @ClientIp() ip: string | null,
  ): Promise<GroupStructureDto> {
    return this.entities.setLevelCurrency(actor, parentCode, body.currency, body.reason, ip);
  }
}
