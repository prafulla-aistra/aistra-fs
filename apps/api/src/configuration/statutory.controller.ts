import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { isIsoDate } from '@finance-close/engine';
import {
  Permission,
  type SigningDetailsDto,
  type StatutoryDetailsDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { EditConfig, ViewConfig } from './access';
import { StatutoryService } from './statutory.service';

const isoDate = z.string().refine((v) => isIsoDate(v), 'A date (YYYY-MM-DD)');
const code = z.string().regex(/^[A-Z0-9]{1,10}$/);
const key = z.string().regex(/^([A-Z0-9]{1,10}|L\d{1,2})$/);
const detailsSchema = z.object({
  registeredOffice: z.string().trim().max(500).nullable(),
  registrationNo: z.string().trim().max(60).nullable(),
  officers: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Officer: enter a name').max(200),
        designation: z.string().trim().min(1, 'Officer: enter a designation').max(100),
        identifier: z.string().trim().max(60).nullable(),
        effectiveFrom: isoDate,
        effectiveTo: isoDate.nullable(),
      }),
    )
    .max(50),
});
const signingSchema = z.object({
  boardApprovalDate: isoDate,
  place: z.string().trim().min(2, 'Enter the place of signing').max(120),
});

/** Close work is visible to preparers, reviewers and report viewers. */
const ViewTasks = () =>
  RequirePermission(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
    Permission.ReportsView,
  );
/** Signing details are entered by whoever prepares or finalises (checked per item). */
const EnterSigning = () =>
  RequirePermission(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
  );

/** Decision round 1 (Q9): statutory details and signing details. Every change audited. */
@Controller()
export class StatutoryController {
  constructor(private readonly statutory: StatutoryService) {}

  @Get('config/entities/:code/statutory')
  @ViewConfig()
  details(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(code)) c: string,
  ): Promise<StatutoryDetailsDto> {
    return this.statutory.details(user, c);
  }

  @Put('config/entities/:code/statutory')
  @EditConfig()
  saveDetails(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(code)) c: string,
    @Body(new ZodPipe(detailsSchema)) body: z.output<typeof detailsSchema>,
    @ClientIp() ip: string | null,
  ): Promise<StatutoryDetailsDto> {
    return this.statutory.saveDetails(
      user,
      c,
      {
        ...body,
        registeredOffice: body.registeredOffice || null,
        registrationNo: body.registrationNo || null,
      },
      ip,
    );
  }

  @Get('tasks/:id/signing/:key')
  @ViewTasks()
  signing(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key', new ZodPipe(key)) k: string,
  ): Promise<SigningDetailsDto> {
    return this.statutory.signing(user, id, k);
  }

  @Put('tasks/:id/signing/:key')
  @EnterSigning()
  saveSigning(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key', new ZodPipe(key)) k: string,
    @Body(new ZodPipe(signingSchema)) body: z.output<typeof signingSchema>,
    @ClientIp() ip: string | null,
  ): Promise<SigningDetailsDto> {
    return this.statutory.saveSigning(user, id, k, body, ip);
  }
}
