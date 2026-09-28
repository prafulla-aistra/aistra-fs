import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { isIsoDate } from '@finance-close/engine';
import type {
  DueDateRuleDto,
  FinancialYearDto,
  FinancialYearOption,
  HolidayDto,
  PeriodDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser } from '../../auth/access-control';
import type { AuthUser } from '../../auth/session-user';
import { ClientIp } from '../../common/client-ip';
import { ZodPipe } from '../../common/zod.pipe';
import { EditConfig, ViewConfig } from '../access';
import { CalendarService } from './calendar.service';

const isoDate = z.string().refine(isIsoDate, 'Enter a valid date (YYYY-MM-DD)');
const statementType = z.enum(['SFS', 'CFS']);
const periodType = z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']);
const reason = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500);

const createFySchema = z.object({ startYear: z.number().int() });
const statusSchema = z.object({ status: z.enum(['OPEN', 'CLOSED']) });
const overrideSchema = z.object({ dueDate: isoDate, reason });
const clearSchema = z.object({ reason });
const ruleSchema = z.object({
  workingDays: z
    .number()
    .int('Whole working days only')
    .min(0)
    .max(120, 'At most 120 working days'),
});
const holidaySchema = z.object({
  date: isoDate,
  description: z.string().trim().min(1, 'Enter a description').max(200),
});

@Controller('config')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  // Financial years and periods

  @Get('financial-years')
  @ViewConfig()
  financialYears(): Promise<FinancialYearDto[]> {
    return this.calendar.financialYears();
  }

  @Get('financial-years/options')
  @ViewConfig()
  options(): Promise<FinancialYearOption[]> {
    return this.calendar.financialYearOptions();
  }

  @Post('financial-years')
  @EditConfig()
  createFinancialYear(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(createFySchema)) body: z.output<typeof createFySchema>,
    @ClientIp() ip: string | null,
  ): Promise<FinancialYearDto> {
    return this.calendar.createFinancialYear(actor, body.startYear, ip);
  }

  @Patch('periods/:id/status')
  @EditConfig()
  setStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(statusSchema)) body: z.output<typeof statusSchema>,
    @ClientIp() ip: string | null,
  ): Promise<PeriodDto> {
    return this.calendar.setPeriodStatus(actor, id, body.status, ip);
  }

  @Put('periods/:id/due-dates/:statementType')
  @EditConfig()
  override(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('statementType', new ZodPipe(statementType)) type: z.output<typeof statementType>,
    @Body(new ZodPipe(overrideSchema)) body: z.output<typeof overrideSchema>,
    @ClientIp() ip: string | null,
  ): Promise<PeriodDto> {
    return this.calendar.overrideDueDate(actor, id, type, body.dueDate, body.reason, ip);
  }

  @Post('periods/:id/due-dates/:statementType/clear')
  @HttpCode(200)
  @EditConfig()
  clearOverride(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('statementType', new ZodPipe(statementType)) type: z.output<typeof statementType>,
    @Body(new ZodPipe(clearSchema)) body: z.output<typeof clearSchema>,
    @ClientIp() ip: string | null,
  ): Promise<PeriodDto> {
    return this.calendar.clearOverride(actor, id, type, body.reason, ip);
  }

  // Due-date rules

  @Get('due-date-rules')
  @ViewConfig()
  rules(): Promise<DueDateRuleDto[]> {
    return this.calendar.rules();
  }

  @Patch('due-date-rules/:statementType/:periodType')
  @EditConfig()
  updateRule(
    @CurrentUser() actor: AuthUser,
    @Param('statementType', new ZodPipe(statementType)) st: z.output<typeof statementType>,
    @Param('periodType', new ZodPipe(periodType)) pt: z.output<typeof periodType>,
    @Body(new ZodPipe(ruleSchema)) body: z.output<typeof ruleSchema>,
    @ClientIp() ip: string | null,
  ): Promise<DueDateRuleDto> {
    return this.calendar.updateRule(actor, st, pt, body.workingDays, ip);
  }

  // Holidays

  @Get('holidays')
  @ViewConfig()
  holidays(): Promise<HolidayDto[]> {
    return this.calendar.holidays();
  }

  @Post('holidays')
  @EditConfig()
  createHoliday(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(holidaySchema)) body: z.output<typeof holidaySchema>,
    @ClientIp() ip: string | null,
  ): Promise<HolidayDto> {
    return this.calendar.createHoliday(actor, body.date, body.description, ip);
  }

  @Patch('holidays/:id')
  @EditConfig()
  updateHoliday(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(holidaySchema)) body: z.output<typeof holidaySchema>,
    @ClientIp() ip: string | null,
  ): Promise<HolidayDto> {
    return this.calendar.updateHoliday(actor, id, body.date, body.description, ip);
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  @EditConfig()
  deleteHoliday(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    return this.calendar.deleteHoliday(actor, id, ip);
  }
}
