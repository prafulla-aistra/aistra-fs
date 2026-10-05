import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
  type FinalisedViewDto,
  type QueryMarkerDto,
  type ReviewPackDto,
  type ReviewStepDto,
} from '@finance-close/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { reviewRecordPdf } from './review-record';
import { ReviewService } from './review.service';
import type { UploadedBlob } from './upload-step.service';

const ViewTasks = () =>
  RequirePermission(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
    Permission.ReportsView,
  );
const Prepare = () => RequirePermission(Permission.SfsPrepare);
const Review = () => RequirePermission(Permission.SfsReview);
const entityCode = z.string().regex(/^[A-Z0-9]{1,10}$/, 'Invalid entity code');

export const submitSchema = z.object({
  declaration: z.boolean(),
  acknowledgements: z
    .array(z.object({ key: z.string().max(80), comment: z.string().max(1000) }))
    .max(50)
    .default([]),
});
export const querySchema = z.object({
  targetType: z.enum(['LINE', 'ACCOUNT', 'NOTE', 'CHECK', 'ENTITY']),
  targetKey: z.string().max(200).nullable().default(null),
  text: z.string().trim().min(3, 'Write the query (at least 3 characters)').max(2000),
});
export const answerSchema = z.object({
  text: z.string().trim().min(3, 'Write the answer (at least 3 characters)').max(2000),
});
export const statusSchema = z.object({
  status: z.enum(['CLOSED', 'OPEN']),
  comment: z.string().max(1000).nullable().default(null),
});
export const returnSchema = z.object({
  comment: z.string().trim().min(10, 'Explain what to fix (at least 10 characters)').max(2000),
});
export const approveSchema = z.object({ comment: z.string().max(1000).nullable().default(null) });
export const versionQuery = z.object({ version: z.coerce.number().int().min(1).optional() });

@Controller()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('tasks/:id/review-step')
  @ViewTasks()
  step(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReviewStepDto> {
    return this.review.step(user, id);
  }

  @Get('tasks/:id/entities/:code/review')
  @ViewTasks()
  pack(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
  ): Promise<ReviewPackDto> {
    return this.review.pack(user, id, code);
  }

  @Get('tasks/:id/entities/:code/review/markers')
  @ViewTasks()
  markers(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
  ): Promise<QueryMarkerDto[]> {
    return this.review.markers(user, id, code);
  }

  @Post('tasks/:id/entities/:code/review/submit')
  @Prepare()
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(submitSchema)) body: z.output<typeof submitSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.review.submit(user, id, code, body, ip);
  }

  @Post('tasks/:id/entities/:code/review/queries')
  @Review()
  raise(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(querySchema)) body: z.output<typeof querySchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.review.raiseQuery(user, id, code, body, ip);
  }

  @Post('tasks/:id/entities/:code/review/queries/:queryId/answer')
  @Prepare()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  answer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Param('queryId', ParseUUIDPipe) queryId: string,
    @Body(new ZodPipe(answerSchema)) body: z.output<typeof answerSchema>,
    @UploadedFile() file: UploadedBlob | undefined,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.review.answerQuery(user, id, code, queryId, body.text, file ?? null, ip);
  }

  @Post('tasks/:id/entities/:code/review/queries/:queryId/status')
  @Review()
  status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Param('queryId', ParseUUIDPipe) queryId: string,
    @Body(new ZodPipe(statusSchema)) body: z.output<typeof statusSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.review.setQueryStatus(
      user,
      id,
      code,
      queryId,
      body.status === 'CLOSED',
      body.comment,
      ip,
    );
  }

  @Post('tasks/:id/entities/:code/review/return')
  @Review()
  returnToPreparer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(returnSchema)) body: z.output<typeof returnSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.review.returnToPreparer(user, id, code, body.comment, ip);
  }

  @Post('tasks/:id/entities/:code/review/approve')
  @Review()
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(approveSchema)) body: z.output<typeof approveSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReviewPackDto> {
    return this.review.approve(user, id, code, body.comment, ip);
  }

  @Get('tasks/:id/entities/:code/finalised')
  @ViewTasks()
  finalised(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
  ): Promise<FinalisedViewDto> {
    return this.review.finalised(user, id, code);
  }

  @Get('tasks/:id/entities/:code/finalised/review-record')
  @ViewTasks()
  async record(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Query(new ZodPipe(versionQuery)) q: z.output<typeof versionQuery>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { task, snapshot, data } = await this.review.snapshotData(user, id, code, q.version);
    const body = await reviewRecordPdf({
      pack: data.pack,
      taskNumber: task.number,
      version: snapshot.version,
      hash: snapshot.hash ?? '',
      finalisedAt: (snapshot.finalisedAt ?? snapshot.createdAt).toISOString(),
      exportedBy: `${user.name} (${user.email})`,
    });
    const name = `${task.number}-${code}-review-record-v${snapshot.version}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(body);
  }
}
