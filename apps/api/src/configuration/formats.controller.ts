import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import type {
  FormatDetailDto,
  FormatIssueDto,
  FormatPreviewDto,
  FormatPreviewSourceDto,
  FormatSaveResultDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { EditConfig, ViewConfig } from './access';
import { FormatsService } from './formats.service';

const formatCode = z.string().regex(/^[A-Z0-9_]{2,40}$/, 'Invalid format code');
const line = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/, 'Invalid line id'),
  statement: z.enum(['BS', 'PL']),
  type: z.enum(['HEADING', 'LINE', 'TOTAL']),
  label: z.string().max(200),
  indent: z.number().int().min(0).max(4),
  fslis: z.array(z.string().max(30)).max(100),
  formula: z.array(z.object({ key: z.string().max(60), op: z.enum(['+', '-']) })).max(100),
  role: z.enum(['PROFIT', 'TOTAL_ASSETS', 'TOTAL_EQUITY_LIABILITIES']).nullable(),
});
const lines = z.array(line).min(1).max(500);
const saveSchema = z.object({
  name: z.string().trim().min(1, 'Give the format a name').max(100),
  description: z.string().trim().max(500),
  lines,
  note: z.string().trim().max(500).nullable().optional(),
});
const duplicateSchema = z.object({
  code: formatCode,
  name: z.string().trim().min(1, 'Give the copy a name').max(100),
});
const previewSchema = z.object({
  lines,
  taskId: z.string().uuid(),
  entityCode: z.string().regex(/^[A-Z0-9]{1,10}$/),
});
const versionQuery = z.object({ version: z.coerce.number().int().min(1).optional() });

@Controller('config/formats')
export class FormatsController {
  constructor(private readonly formats: FormatsService) {}

  @Get('preview-sources')
  @ViewConfig()
  sources(): Promise<FormatPreviewSourceDto[]> {
    return this.formats.previewSources();
  }

  @Post('check')
  @ViewConfig()
  async check(
    @Body(new ZodPipe(z.object({ lines }))) body: { lines: z.output<typeof lines> },
  ): Promise<{ issues: FormatIssueDto[] }> {
    return { issues: this.formats.check(body.lines, await this.formats.fslis()) };
  }

  @Post('preview')
  @ViewConfig()
  preview(
    @Body(new ZodPipe(previewSchema)) body: z.output<typeof previewSchema>,
  ): Promise<FormatPreviewDto> {
    return this.formats.preview(body.lines, body.taskId, body.entityCode);
  }

  @Get(':code')
  @ViewConfig()
  detail(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(formatCode)) code: string,
    @Query(new ZodPipe(versionQuery)) q: z.output<typeof versionQuery>,
  ): Promise<FormatDetailDto> {
    return this.formats.detail(user, code, q.version);
  }

  @Put(':code')
  @EditConfig()
  save(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(formatCode)) code: string,
    @Body(new ZodPipe(saveSchema)) body: z.output<typeof saveSchema>,
    @ClientIp() ip: string | null,
  ): Promise<FormatSaveResultDto> {
    return this.formats.save(user, code, body, ip);
  }

  @Post(':code/duplicate')
  @EditConfig()
  duplicate(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(formatCode)) code: string,
    @Body(new ZodPipe(duplicateSchema)) body: z.output<typeof duplicateSchema>,
    @ClientIp() ip: string | null,
  ): Promise<FormatDetailDto> {
    return this.formats.duplicate(user, code, body, ip);
  }
}
