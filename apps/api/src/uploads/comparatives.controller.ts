import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MAX_UPLOAD_BYTES,
  Permission,
  type ComparativesStepDto,
  type EntityComparativesDto,
  type TbPreviewDto,
  type TbVersionDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { ComparativesService } from './comparatives.service';
import { type UploadedBlob, UploadStepService } from './upload-step.service';

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
const column = z.number().int().min(0).max(200);
const settingsSchema = z.object({
  headerRow: z.number().int().min(0).max(100000),
  codeColumn: column,
  nameColumn: column,
  balanceColumn: column.nullable(),
  debitColumn: column.nullable(),
  creditColumn: column.nullable(),
  typeColumn: column.nullable().optional(),
  signConvention: z.enum(['DEBIT_POSITIVE', 'CREDIT_POSITIVE', 'DRCR_SUFFIX', 'SEPARATE_COLUMNS']),
});
const previewSchema = z.object({ fileId: z.string().uuid(), settings: settingsSchema });
const confirmSchema = previewSchema.extend({
  acknowledged: z.array(z.string().max(40)).max(10).default([]),
});
const basisSchema = z.object({ basis: z.enum(['PREVIOUS_PERIOD', 'SAME_PERIOD_LAST_YEAR']) });
const explainSchema = z.object({
  accountCode: z.string().min(1).max(40),
  text: z.string().max(500, 'Explanation: at most 500 characters'),
});
const Upload = () =>
  UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }));

@Controller()
export class ComparativesController {
  constructor(
    private readonly comparatives: ComparativesService,
    private readonly uploads: UploadStepService,
  ) {}

  @Get('tasks/:id/comparatives-step')
  @ViewTasks()
  step(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ComparativesStepDto> {
    return this.comparatives.step(user, id);
  }

  @Put('tasks/:id/comparatives/basis')
  @Prepare()
  basis(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(basisSchema)) body: z.output<typeof basisSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ComparativesStepDto> {
    return this.comparatives.setBasis(user, id, body.basis, ip);
  }

  @Get('tasks/:id/entities/:code/comparatives')
  @ViewTasks()
  entity(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
  ): Promise<EntityComparativesDto> {
    return this.comparatives.entity(user, id, code);
  }

  @Put('tasks/:id/entities/:code/comparatives/explanations')
  @Prepare()
  explain(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(explainSchema)) body: z.output<typeof explainSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EntityComparativesDto> {
    return this.comparatives.explain(user, id, code, body.accountCode, body.text, ip);
  }

  @Post('tasks/:id/entities/:code/comparatives/continue')
  @Prepare()
  continue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @ClientIp() ip: string | null,
  ): Promise<{ currentStep: string; unexplained: number }> {
    return this.comparatives.continue(user, id, code, ip);
  }

  // Comparative TB upload: the same flow as step 1, for the comparative period, this task only.

  @Post('tasks/:id/entities/:code/comparative-tb')
  @Prepare()
  @Upload()
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @UploadedFile() file: UploadedBlob | undefined,
  ): Promise<TbPreviewDto> {
    const target = await this.comparatives.uploadTarget(user, id, code);
    return this.uploads.uploadTb(user, id, code, file, target);
  }

  @Post('tasks/:id/entities/:code/comparative-tb/preview')
  @Prepare()
  async preview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(previewSchema)) body: z.output<typeof previewSchema>,
  ): Promise<TbPreviewDto> {
    const target = await this.comparatives.uploadTarget(user, id, code);
    return this.uploads.previewTb(user, id, code, body.fileId, body.settings, target);
  }

  @Post('tasks/:id/entities/:code/comparative-tb/confirm')
  @Prepare()
  async confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(confirmSchema)) body: z.output<typeof confirmSchema>,
    @ClientIp() ip: string | null,
  ): Promise<TbVersionDto> {
    const target = await this.comparatives.uploadTarget(user, id, code);
    return this.uploads.confirmTb(user, id, code, body, ip, target);
  }
}
