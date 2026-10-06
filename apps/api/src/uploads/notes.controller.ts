import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  Permission,
  type EntityNotesDto,
  type NoteSaveInput,
  type NotesStepDto,
  type PriorNoteDto,
} from '@finance-close/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { StatutoryService } from '../configuration/statutory.service';
import { fullSetDocx, fullSetPdf } from './notes-export';
import { NotesService } from './notes.service';
import { StatementsService } from './statements.service';

const ViewTasks = () =>
  RequirePermission(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
    Permission.ReportsView,
  );
const Prepare = () => RequirePermission(Permission.SfsPrepare);
const entityCode = z.string().regex(/^[A-Z0-9]{1,10}$/, 'Invalid entity code');
export const viewQuery = z.object({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  unit: z.enum(['ACTUAL', 'THOUSANDS', 'LAKHS', 'CRORES', 'MILLIONS']).optional(),
});
export const exportQuery = viewQuery.extend({ type: z.enum(['docx', 'pdf']) });

const id = z.string().min(1).max(60);
const richNode: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.string().max(40),
    text: z.string().max(20000).optional(),
    marks: z
      .array(z.object({ type: z.string().max(40) }))
      .max(10)
      .optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(richNode).max(2000).optional(),
  }),
);
const block = z.discriminatedUnion('type', [
  z.object({
    id,
    type: z.literal('FIGURES'),
    subCaptions: z
      .array(
        z.object({
          id,
          label: z.string().trim().min(1, 'Name the sub-caption').max(200),
          accounts: z.array(z.string().max(40)).max(500),
        }),
      )
      .max(50),
  }),
  z.object({ id, type: z.literal('TEXT'), label: z.string().max(200), doc: richNode }),
  z.object({
    id,
    type: z.literal('GENERATED'),
    source: z.enum(['SUBSIDIARIES', 'GOODWILL', 'NCI', 'IC_SUMMARY', 'FCTR']),
    label: z.string().max(200),
  }),
  z.object({
    id,
    type: z.literal('TABLE'),
    label: z.string().max(200),
    columns: z
      .array(
        z.object({
          id,
          label: z.string().max(100),
          numeric: z.boolean(),
          period: z.enum(['CURRENT', 'COMPARATIVE']).nullable(),
        }),
      )
      .min(1)
      .max(12),
    rows: z.array(z.object({ id, cells: z.record(z.string(), z.string().max(500)) })).max(200),
    mode: z.enum(['MEMO', 'AGREE']),
    agreeLine: z.string().max(60).nullable(),
  }),
]);
export const saveSchema = z.object({
  title: z.string().trim().min(1, 'Give the note a title').max(300),
  blocks: z.array(block).max(50),
  baseVersion: z.number().int().min(1),
});
export const createSchema = z.object({
  title: z.string().trim().min(1, 'Give the note a title').max(300),
  afterNoteId: z.string().uuid().nullable(),
});

@Controller()
export class NotesController {
  constructor(
    private readonly notes: NotesService,
    private readonly statements: StatementsService,
    private readonly statutory: StatutoryService,
  ) {}

  @Get('tasks/:id/notes-step')
  @ViewTasks()
  step(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) taskId: string,
  ): Promise<NotesStepDto> {
    return this.notes.step(user, taskId);
  }

  @Get('tasks/:id/entities/:code/notes')
  @ViewTasks()
  entity(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Query(new ZodPipe(viewQuery)) q: z.output<typeof viewQuery>,
  ): Promise<EntityNotesDto> {
    return this.notes.entity(user, taskId, code, q);
  }

  @Get('tasks/:id/entities/:code/notes/export')
  @ViewTasks()
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Query(new ZodPipe(exportQuery)) q: z.output<typeof exportQuery>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const notes = await this.notes.entity(user, taskId, code, q);
    const statements = await this.statements.entity(user, taskId, code, {
      currency: q.currency,
      unit: q.unit,
    });
    const input = {
      statements,
      notes,
      taskNumber: '',
      exportedBy: `${user.name} (${user.email})`,
      exportedAt: new Date(),
      signature: await this.statutory.signature(taskId, code),
    };
    const step = await this.notes.step(user, taskId);
    input.taskNumber = step.task.number;
    const body = q.type === 'docx' ? await fullSetDocx(input) : await fullSetPdf(input);
    const name = `${step.task.number}-${code}-financial-statements-${notes.selection.currency}.${q.type}`;
    res.setHeader(
      'Content-Type',
      q.type === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(body);
  }

  @Get('tasks/:id/entities/:code/notes/:noteId/prior')
  @ViewTasks()
  prior(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Query(new ZodPipe(viewQuery)) q: z.output<typeof viewQuery>,
  ): Promise<PriorNoteDto> {
    return this.notes.prior(user, taskId, code, noteId, q);
  }

  @Put('tasks/:id/entities/:code/notes/:noteId')
  @Prepare()
  save(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body(new ZodPipe(saveSchema)) body: z.output<typeof saveSchema>,
    @ClientIp() ip: string | null,
  ) {
    return this.notes.save(user, taskId, code, noteId, body as NoteSaveInput, ip);
  }

  @Post('tasks/:id/entities/:code/notes')
  @Prepare()
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(createSchema)) body: z.output<typeof createSchema>,
    @ClientIp() ip: string | null,
  ) {
    return this.notes.create(user, taskId, code, body, ip);
  }

  @Delete('tasks/:id/entities/:code/notes/:noteId')
  @Prepare()
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    return this.notes.remove(user, taskId, code, noteId, ip);
  }

  @Post('tasks/:id/entities/:code/notes/:noteId/review')
  @Prepare()
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body(new ZodPipe(z.object({ reviewed: z.boolean() }))) body: { reviewed: boolean },
    @ClientIp() ip: string | null,
  ) {
    return this.notes.review(user, taskId, code, noteId, body.reviewed, ip);
  }

  @Put('tasks/:id/entities/:code/notes-order')
  @Prepare()
  @HttpCode(204)
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(z.object({ ids: z.array(z.string().uuid()).max(500) })))
    body: { ids: string[] },
    @ClientIp() ip: string | null,
  ): Promise<void> {
    return this.notes.reorder(user, taskId, code, body.ids, ip);
  }

  @Post('tasks/:id/entities/:code/notes-continue')
  @Prepare()
  continue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @ClientIp() ip: string | null,
  ): Promise<{ currentStep: string }> {
    return this.notes.continue(user, taskId, code, ip);
  }
}
