import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ErpSystem, Gaap, type EntityDto, type GroupStructureDto } from '@finance-close/shared';
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
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{2,10}$/, 'Entity code: 2–10 letters or digits')),
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

  /** Tree view and consolidation levels derived by the engine (read-only). */
  @Get('group-structure')
  @ViewConfig()
  groupStructure(): Promise<GroupStructureDto> {
    return this.entities.groupStructure();
  }
}
