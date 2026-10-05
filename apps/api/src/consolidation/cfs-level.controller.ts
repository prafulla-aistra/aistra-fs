import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MAX_UPLOAD_BYTES,
  Permission,
  type CfsStatementsDto,
  type EntityNotesDto,
  type FinalisedViewDto,
  type NoteSaveInput,
  type PriorNoteDto,
  type QueryMarkerDto,
  type ReviewPackDto,
  type StatementUnitCode,
} from '@finance-close/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { createSchema, saveSchema, viewQuery } from '../uploads/notes.controller';
import {
  answerSchema,
  approveSchema,
  querySchema,
  returnSchema,
  statusSchema,
  submitSchema,
  versionQuery,
} from '../uploads/review.controller';
import type { UploadedBlob } from '../uploads/upload-step.service';
import { CfsLevelService } from './cfs-level.service';
import { ConsolidationService } from './consolidation.service';

const ViewTasks = () =>
  RequirePermission(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
    Permission.ReportsView,
  );
const Prepare = () => RequirePermission(Permission.CfsPrepare);
const Review = () => RequirePermission(Permission.CfsReview);
const flag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
const statementsQuery = z.object({
  format: z
    .string()
    .regex(/^[A-Z0-9_]{2,40}$/)
    .optional(),
  unit: z.enum(['ACTUAL', 'THOUSANDS', 'LAKHS', 'CRORES', 'MILLIONS']).optional(),
  showNil: flag,
  showEntities: flag,
});
const exportQuery = z.object({
  type: z.enum(['xlsx', 'docx', 'pdf']),
  unit: z.enum(['ACTUAL', 'THOUSANDS', 'LAKHS', 'CRORES', 'MILLIONS']).optional(),
});
const explainSchema = z.object({
  text: z.string().trim().min(10, 'Explain the difference (at least 10 characters)').max(1000),
});

const TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};
function send(res: Response, name: string, body: Buffer) {
  const ext = name.split('.').pop() as keyof typeof TYPES;
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return new StreamableFile(body);
}

/** CFS steps 4–7 of a level (page 10): statements, notes, review, finalised, exports. */
@Controller('tasks/:id/cfs/levels/:level')
export class CfsLevelController {
  constructor(
    private readonly levels: CfsLevelService,
    private readonly cfs: ConsolidationService,
  ) {}

  // ----------------------------------------------------------------- step 3 extra

  @Post('eliminations/:entryId/explanation')
  @Prepare()
  explain(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Param('entryId', new ZodPipe(z.string().regex(/^[A-Z_]+:[A-Z0-9:]+$/))) entryId: string,
    @Body(new ZodPipe(explainSchema)) body: z.output<typeof explainSchema>,
    @ClientIp() ip: string | null,
  ) {
    return this.cfs.explain(user, id, level, entryId, body.text, ip);
  }

  // ----------------------------------------------------------------- step 4 statements

  @Get('statements')
  @ViewTasks()
  statements(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Query(new ZodPipe(statementsQuery)) q: z.output<typeof statementsQuery>,
  ): Promise<CfsStatementsDto> {
    return this.levels.statements(user, id, level, q);
  }

  @Get('statements/export')
  @ViewTasks()
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Query(new ZodPipe(exportQuery)) q: z.output<typeof exportQuery>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f =
      q.type === 'xlsx'
        ? await this.levels.groupPack(user, id, level)
        : await this.levels.fullSet(user, id, level, q.type, q.unit);
    return send(res, f.name, f.body);
  }

  // ----------------------------------------------------------------- step 5 notes

  @Get('notes')
  @ViewTasks()
  notes(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Query(new ZodPipe(viewQuery)) q: z.output<typeof viewQuery>,
  ): Promise<EntityNotesDto> {
    return this.levels.notesView(user, id, level, q.unit as StatementUnitCode | undefined);
  }

  @Get('notes/export')
  @ViewTasks()
  async notesExport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Query(new ZodPipe(exportQuery)) q: z.output<typeof exportQuery>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.levels.fullSet(
      user,
      id,
      level,
      q.type === 'xlsx' ? 'pdf' : q.type,
      q.unit,
    );
    return send(res, f.name, f.body);
  }

  @Get('notes/:noteId/prior')
  @ViewTasks()
  prior(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Query(new ZodPipe(viewQuery)) q: z.output<typeof viewQuery>,
  ): Promise<PriorNoteDto> {
    return this.levels.notesPrior(user, id, level, noteId, q.unit as StatementUnitCode | undefined);
  }

  @Put('notes/:noteId')
  @Prepare()
  save(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body(new ZodPipe(saveSchema)) body: z.output<typeof saveSchema>,
    @ClientIp() ip: string | null,
  ) {
    return this.levels.saveNote(user, id, level, noteId, body as NoteSaveInput, ip);
  }

  @Post('notes')
  @Prepare()
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Body(new ZodPipe(createSchema)) body: z.output<typeof createSchema>,
    @ClientIp() ip: string | null,
  ) {
    return this.levels.notesEdit(user, id, level, (s) =>
      this.levels.notesApi.createIn(user, s, body, ip),
    );
  }

  @Delete('notes/:noteId')
  @Prepare()
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    await this.levels.notesEdit(user, id, level, (s) =>
      this.levels.notesApi.removeIn(user, s, noteId, ip),
    );
  }

  @Post('notes/:noteId/review')
  @Prepare()
  reviewNote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body(new ZodPipe(z.object({ reviewed: z.boolean() }))) body: { reviewed: boolean },
    @ClientIp() ip: string | null,
  ) {
    return this.levels.notesEdit(user, id, level, (s) =>
      this.levels.notesApi.reviewIn(user, s, noteId, body.reviewed, ip),
    );
  }

  @Put('notes-order')
  @Prepare()
  @HttpCode(204)
  async reorder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Body(new ZodPipe(z.object({ ids: z.array(z.string().uuid()).max(500) })))
    body: { ids: string[] },
    @ClientIp() ip: string | null,
  ): Promise<void> {
    await this.levels.notesEdit(user, id, level, (s) =>
      this.levels.notesApi.reorderIn(user, s, body.ids, ip),
    );
  }

  @Post('notes-continue')
  @Prepare()
  notesContinue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @ClientIp() ip: string | null,
  ) {
    return this.levels.continue(user, id, level, 'NOTES', ip);
  }

  // ----------------------------------------------------------------- step 6 review

  @Get('review')
  @ViewTasks()
  pack(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
  ): Promise<ReviewPackDto> {
    return this.levels.pack(user, id, level);
  }

  @Get('review/markers')
  @ViewTasks()
  markers(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
  ): Promise<QueryMarkerDto[]> {
    return this.levels.markers(user, id, level);
  }

  @Post('review/submit')
  @Prepare()
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Body(new ZodPipe(submitSchema)) body: z.output<typeof submitSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.levels.submit(user, id, level, body, ip);
  }

  @Post('review/queries')
  @Review()
  raise(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Body(new ZodPipe(querySchema)) body: z.output<typeof querySchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.levels.raiseQuery(user, id, level, body, ip);
  }

  @Post('review/queries/:queryId/answer')
  @Prepare()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  answer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Param('queryId', ParseUUIDPipe) queryId: string,
    @Body(new ZodPipe(answerSchema)) body: z.output<typeof answerSchema>,
    @UploadedFile() file: UploadedBlob | undefined,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.levels.answerQuery(user, id, level, queryId, body.text, file ?? null, ip);
  }

  @Post('review/queries/:queryId/status')
  @Review()
  status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Param('queryId', ParseUUIDPipe) queryId: string,
    @Body(new ZodPipe(statusSchema)) body: z.output<typeof statusSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.levels.setQueryStatus(
      user,
      id,
      level,
      queryId,
      body.status === 'CLOSED',
      body.comment,
      ip,
    );
  }

  @Post('review/return')
  @Review()
  returnToPreparer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Body(new ZodPipe(returnSchema)) body: z.output<typeof returnSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.levels.returnToPreparer(user, id, level, body.comment, ip);
  }

  @Post('review/approve')
  @Review()
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Body(new ZodPipe(approveSchema)) body: z.output<typeof approveSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.levels.approve(user, id, level, body.comment, ip);
  }

  // ----------------------------------------------------------------- step 7 finalised

  @Get('finalised')
  @ViewTasks()
  finalised(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
  ): Promise<FinalisedViewDto> {
    return this.levels.finalised(user, id, level);
  }

  @Get('finalised/review-record')
  @ViewTasks()
  async record(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Query(new ZodPipe(versionQuery)) q: z.output<typeof versionQuery>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.levels.reviewRecord(user, id, level, q.version);
    return send(res, f.name, f.body);
  }
}
