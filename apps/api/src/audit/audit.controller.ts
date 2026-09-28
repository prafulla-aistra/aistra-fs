import { Controller, Get, Query } from '@nestjs/common';
import { Permission, type AuditLogPage } from '@finance-close/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/access-control';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from './audit.service';

const searchSchema = z
  .object({
    userId: z.string().uuid().optional(),
    action: z.string().max(60).optional(),
    /** ISO timestamps; `to` is exclusive. The web app sends local start-of-day values. */
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .transform((q) => ({
    ...q,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  }));

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** GET /api/audit-logs?userId=&action=&from=&to=&page=&pageSize= */
  @Get()
  @RequirePermission(Permission.UserAdmin)
  search(
    @Query(new ZodPipe(searchSchema)) q: z.output<typeof searchSchema>,
  ): Promise<AuditLogPage> {
    return this.audit.search(q);
  }

  @Get('actions')
  @RequirePermission(Permission.UserAdmin)
  actions(): Promise<string[]> {
    return this.audit.actions();
  }
}
