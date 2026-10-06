import {
  Body,
  Controller,
  Get,
  Param,
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
  type CoaMergeSummaryDto,
  type FileRefDto,
  type RateSaveResultDto,
  type TbPreviewDto,
  type TbVersionDto,
  type UploadStepDto,
} from '@finance-close/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { RatesService } from './rates.service';
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
const EditRates = () =>
  RequirePermission(Permission.SfsPrepare, Permission.CfsPrepare, Permission.ConfigManage);

/** Files are held in memory (max 10 MB) and handed to StorageService. */
export const Upload = () =>
  UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }));

const entityCode = z.string().regex(/^[A-Z0-9]{1,10}$/, 'Invalid entity code');
const column = z.number().int().min(0).max(200);
const settingsSchema = z
  .object({
    headerRow: z.number().int().min(0).max(100000),
    codeColumn: column,
    nameColumn: column,
    balanceColumn: column.nullable(),
    debitColumn: column.nullable(),
    creditColumn: column.nullable(),
    typeColumn: column.nullable().optional(),
    signConvention: z.enum([
      'DEBIT_POSITIVE',
      'CREDIT_POSITIVE',
      'DRCR_SUFFIX',
      'SEPARATE_COLUMNS',
    ]),
  })
  .refine(
    (s) =>
      s.signConvention === 'SEPARATE_COLUMNS'
        ? s.debitColumn !== null && s.creditColumn !== null
        : s.balanceColumn !== null,
    { message: 'Choose the balance column, or the debit and credit columns' },
  );
const previewSchema = z.object({ fileId: z.string().uuid(), settings: settingsSchema });
const plBasisSchema = z.object({ plBasis: z.enum(['PERIOD', 'YTD']) });
const confirmSchema = previewSchema.extend({
  acknowledged: z.array(z.string().max(40)).max(10).default([]),
});
const kindSchema = z.object({ kind: z.enum(['COA', 'OTHER']) });
const rate = z.string().trim().max(40).nullable();
export const ratesSchema = z.object({
  rates: z
    .array(
      z.object({
        month: z.string().regex(/^\d{4}-\d{2}-01$/, 'month must be YYYY-MM-01'),
        currency: z.string().regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter code'),
        opening: rate,
        closing: rate,
        average: rate,
      }),
    )
    .min(1)
    .max(500),
});

@Controller()
export class UploadsController {
  constructor(
    private readonly step: UploadStepService,
    private readonly rates: RatesService,
  ) {}

  @Get('tasks/:id/upload-step')
  @ViewTasks()
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UploadStepDto> {
    return this.step.get(user, id);
  }

  @Post('tasks/:id/entities/:code/tb')
  @Prepare()
  @Upload()
  uploadTb(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @UploadedFile() file: UploadedBlob | undefined,
  ): Promise<TbPreviewDto> {
    return this.step.uploadTb(user, id, code, file);
  }

  @Post('tasks/:id/entities/:code/tb/preview')
  @Prepare()
  previewTb(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(previewSchema)) body: z.output<typeof previewSchema>,
  ): Promise<TbPreviewDto> {
    return this.step.previewTb(user, id, code, body.fileId, body.settings);
  }

  @Post('tasks/:id/entities/:code/tb/confirm')
  @Prepare()
  confirmTb(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(confirmSchema)) body: z.output<typeof confirmSchema>,
    @ClientIp() ip: string | null,
  ): Promise<TbVersionDto> {
    return this.step.confirmTb(user, id, code, body, ip);
  }

  @Put('tasks/:id/entities/:code/upload-profile')
  @Prepare()
  setPlBasis(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(plBasisSchema)) body: z.output<typeof plBasisSchema>,
    @ClientIp() ip: string | null,
  ): Promise<UploadStepDto> {
    return this.step.setPlBasis(user, id, code, body.plBasis, ip);
  }

  @Get('tasks/:id/entities/:code/tb/versions')
  @ViewTasks()
  tbVersions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
  ): Promise<TbVersionDto[]> {
    return this.step.tbVersions(user, id, code);
  }

  @Post('tasks/:id/entities/:code/coa')
  @Prepare()
  @Upload()
  uploadCoa(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @UploadedFile() file: UploadedBlob | undefined,
    @ClientIp() ip: string | null,
  ): Promise<CoaMergeSummaryDto> {
    return this.step.uploadCoa(user, id, code, file, ip);
  }

  @Post('tasks/:id/entities/:code/documents')
  @Prepare()
  @Upload()
  uploadDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @UploadedFile() file: UploadedBlob | undefined,
    @ClientIp() ip: string | null,
  ): Promise<FileRefDto> {
    return this.step.uploadDocument(user, id, code, file, ip);
  }

  @Get('tasks/:id/entities/:code/files')
  @ViewTasks()
  files(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Query(new ZodPipe(kindSchema)) q: z.output<typeof kindSchema>,
  ): Promise<FileRefDto[]> {
    return this.step.files(user, id, code, q.kind);
  }

  @Get('files/:id/download')
  @ViewTasks()
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, body } = await this.step.download(user, id);
    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(body);
  }

  @Post('tasks/:id/continue')
  @Prepare()
  continue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ): Promise<{ moved: string[] }> {
    return this.step.continue(user, id, ip);
  }

  /** Group exchange rates (not per task). */
  @Post('exchange-rates/upload')
  @EditRates()
  @Upload()
  uploadRates(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBlob | undefined,
    @ClientIp() ip: string | null,
  ): Promise<RateSaveResultDto> {
    if (!file) throw ApiError.validation('Choose a rate file to upload.');
    if (!/\.(xlsx|xls|csv)$/i.test(file.originalname))
      throw ApiError.validation('Rate files must be .xlsx, .xls or .csv.');
    return this.rates.upload(user, file, ip);
  }

  @Put('exchange-rates')
  @EditRates()
  saveRates(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(ratesSchema)) body: z.output<typeof ratesSchema>,
    @ClientIp() ip: string | null,
  ): Promise<RateSaveResultDto> {
    return this.rates.save(user, body.rates, ip);
  }
}
