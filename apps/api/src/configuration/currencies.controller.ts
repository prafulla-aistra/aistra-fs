import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { CurrencyDto } from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { EditConfig, ViewConfig } from './access';
import { CurrenciesService } from './currencies.service';

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Currency code must be 3 letters (ISO 4217, e.g. EUR)'),
  name: z.string().trim().min(1, 'Enter a name').max(100),
  symbol: z.string().trim().min(1, 'Enter a symbol').max(10),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(100).optional(),
    symbol: z.string().trim().min(1, 'Enter a symbol').max(10).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

@Controller('config/currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get()
  @ViewConfig()
  list(): Promise<CurrencyDto[]> {
    return this.currencies.list();
  }

  @Post()
  @EditConfig()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(createSchema)) body: z.output<typeof createSchema>,
    @ClientIp() ip: string | null,
  ): Promise<CurrencyDto> {
    return this.currencies.create(actor, body, ip);
  }

  @Patch(':code')
  @EditConfig()
  update(
    @CurrentUser() actor: AuthUser,
    @Param('code') code: string,
    @Body(new ZodPipe(updateSchema)) body: z.output<typeof updateSchema>,
    @ClientIp() ip: string | null,
  ): Promise<CurrencyDto> {
    return this.currencies.update(actor, code, body, ip);
  }

  @Delete(':code')
  @HttpCode(204)
  @EditConfig()
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('code') code: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    return this.currencies.remove(actor, code, ip);
  }
}
