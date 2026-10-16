import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
} from '@nestjs/common';
import type {
  CoaPreviewDto,
  CrossRateDto,
  EntityCoaDto,
  GroupingImportPreviewDto,
  GroupingImportResultDto,
  RateGridDto,
  RatePreviewDto,
  RateSaveResultDto,
} from '@finance-close/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { EditConfig, ViewConfig } from '../configuration/access';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { RateConfigService } from './rate-config.service';
import { RatesService } from './rates.service';
import type { UploadedBlob } from './upload-step.service';
import { ratesSchema, Upload } from './uploads.controller';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const entityCode = z.string().regex(/^[A-Z0-9]{1,10}$/, 'Invalid entity code');
const currency = z.string().regex(/^[A-Z]{3}$/, 'Invalid currency');
const crossQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/, 'month must be YYYY-MM-01'),
  from: currency,
  to: currency,
});
const accountSchema = z.object({
  accountType: z.string().trim().max(60).nullable(),
  fsliCode: z.string().min(1, 'Choose an FSLI').max(30),
  counterpartyCode: z.string().max(10).nullable(),
  rateBasisOverride: z
    .enum(['CLOSING', 'AVERAGE', 'HISTORICAL', 'OPENING', 'ROLL_FORWARD'])
    .nullable(),
  reason: z.string().trim().max(500).nullable().optional(),
  confirmWarnings: z.boolean().optional(),
});

function xlsx(res: Response, name: string, body: Buffer): StreamableFile {
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return new StreamableFile(body);
}

const requireFile = (f: UploadedBlob | undefined, what: string) => {
  if (!f) throw ApiError.validation(`Choose a ${what} file to upload.`);
  if (f.size === 0) throw ApiError.validation('The file is empty.');
  return f;
};

const groupingPreviewSchema = z.object({ sheet: z.string().max(100).optional() });
const groupingImportSchema = z.object({
  sheet: z.string().min(1).max(100),
  reason: z.string().max(500).optional(),
  freeze: z.enum(['true', 'false']).default('false'),
});
const freezeSchema = z.object({ frozen: z.boolean(), reason: z.string().min(3).max(500) });

/** Configuration → Exchange rates and Chart of accounts (CONFIG_MANAGE edits; REPORTS_VIEW views). */
@Controller('config')
export class ConfigDataController {
  constructor(
    private readonly rates: RatesService,
    private readonly rateConfig: RateConfigService,
    private readonly coa: ChartOfAccountsService,
  ) {}

  @Get('exchange-rates/grid')
  @ViewConfig()
  grid(@CurrentUser() user: AuthUser): Promise<RateGridDto> {
    return this.rateConfig.grid(user);
  }

  @Put('exchange-rates')
  @EditConfig()
  save(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(ratesSchema)) body: z.output<typeof ratesSchema>,
    @ClientIp() ip: string | null,
  ): Promise<RateSaveResultDto> {
    return this.rates.save(user, body.rates, ip);
  }

  @Post('exchange-rates/preview')
  @EditConfig()
  @Upload()
  preview(@UploadedFile() file: UploadedBlob | undefined): Promise<RatePreviewDto> {
    return this.rateConfig.preview(requireFile(file, 'rate'));
  }

  /** Saves a previewed file; rows of locked months are skipped (counted in the result). */
  @Post('exchange-rates/upload')
  @EditConfig()
  @Upload()
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBlob | undefined,
    @ClientIp() ip: string | null,
  ): Promise<RateSaveResultDto> {
    const f = requireFile(file, 'rate');
    if (!/\.(xlsx|xls|csv)$/i.test(f.originalname))
      throw ApiError.validation('Rate files must be .xlsx, .xls or .csv.');
    return this.rates.upload(user, f, ip, { skipLocked: true });
  }

  @Get('exchange-rates/template')
  @ViewConfig()
  async template(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return xlsx(res, 'exchange-rates-template.xlsx', await this.rateConfig.template());
  }

  @Get('exchange-rates/export')
  @ViewConfig()
  async export(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return xlsx(res, 'exchange-rates.xlsx', await this.rateConfig.export());
  }

  @Get('exchange-rates/cross')
  @ViewConfig()
  cross(@Query(new ZodPipe(crossQuery)) q: z.output<typeof crossQuery>): Promise<CrossRateDto> {
    return this.rateConfig.cross(q.month, q.from, q.to);
  }

  @Get('entities/:code/coa')
  @ViewConfig()
  entityCoa(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(entityCode)) code: string,
  ): Promise<EntityCoaDto> {
    return this.coa.coa(user, code);
  }

  @Patch('entities/:code/accounts/:account')
  @EditConfig()
  updateAccount(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Param('account', new ZodPipe(z.string().min(1).max(40))) account: string,
    @Body(new ZodPipe(accountSchema)) body: z.output<typeof accountSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EntityCoaDto> {
    return this.coa.update(user, code, account, body, ip);
  }

  @Post('entities/:code/coa/preview')
  @EditConfig()
  @Upload()
  coaPreview(
    @Param('code', new ZodPipe(entityCode)) code: string,
    @UploadedFile() file: UploadedBlob | undefined,
  ): Promise<CoaPreviewDto> {
    return this.coa.preview(code, requireFile(file, 'chart-of-accounts'));
  }

  @Post('entities/:code/coa/upload')
  @EditConfig()
  @Upload()
  coaUpload(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @UploadedFile() file: UploadedBlob | undefined,
    @ClientIp() ip: string | null,
  ): Promise<EntityCoaDto> {
    return this.coa.upload(user, code, requireFile(file, 'chart-of-accounts'), ip);
  }

  /** The client's "Account Code → Grouping" sheet: what importing it would change. */
  @Post('entities/:code/coa/grouping/preview')
  @EditConfig()
  @Upload()
  groupingPreview(
    @Param('code', new ZodPipe(entityCode)) code: string,
    @UploadedFile() file: UploadedBlob | undefined,
    @Body(new ZodPipe(groupingPreviewSchema)) body: z.output<typeof groupingPreviewSchema>,
  ): Promise<GroupingImportPreviewDto> {
    return this.coa.groupingPreview(code, requireFile(file, 'grouping'), body.sheet ?? null);
  }

  @Post('entities/:code/coa/grouping/import')
  @EditConfig()
  @Upload()
  groupingImport(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @UploadedFile() file: UploadedBlob | undefined,
    @Body(new ZodPipe(groupingImportSchema)) body: z.output<typeof groupingImportSchema>,
    @ClientIp() ip: string | null,
  ): Promise<GroupingImportResultDto> {
    return this.coa.groupingImport(
      user,
      code,
      requireFile(file, 'grouping'),
      { sheet: body.sheet, reason: body.reason ?? null, freeze: body.freeze === 'true' },
      ip,
    );
  }

  /** Freeze / unfreeze the entity's mapping (tasks then map new accounts only). */
  @Put('entities/:code/coa/freeze')
  @EditConfig()
  setFreeze(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(freezeSchema)) body: z.output<typeof freezeSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EntityCoaDto> {
    return this.coa.setFreeze(user, code, body.frozen, body.reason, ip);
  }

  @Get('entities/:code/coa/export')
  @ViewConfig()
  async coaExport(
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return xlsx(res, `${code}-chart-of-accounts.xlsx`, await this.coa.export(code));
  }
}
