import { Injectable } from '@nestjs/common';
import { Decimal } from '@finance-close/engine';
import {
  AuditAction,
  Permission,
  RATE_SOURCE_LABEL,
  type AccountTypeDefaultDto,
  type AppSettingsDto,
  type AppSettingsInput,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { readSettings, SETTING } from '../common/settings';
import { PrismaService } from '../prisma/prisma.service';

/** Settings, FSLI names and account-type defaults (Configuration C2). Every change audited. */
@Injectable()
export class ReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async settings(user: AuthUser): Promise<AppSettingsDto> {
    const s = await readSettings(this.prisma);
    const source = s[SETTING.RateSource]!.trim();
    return {
      rateSource: source,
      rateSourceLabel: source || RATE_SOURCE_LABEL,
      icDiffThreshold: new Decimal(s[SETTING.IcDiffThreshold]!).toFixed(2),
      variancePct: new Decimal(s[SETTING.VariancePct]!).times(100).toDecimalPlaces(2).toFixed(),
      canEdit: user.permissions.has(Permission.ConfigManage),
    };
  }

  async saveSettings(
    user: AuthUser,
    input: AppSettingsInput,
    ip: string | null,
  ): Promise<AppSettingsDto> {
    const before = await readSettings(this.prisma);
    const after: Record<string, string> = {
      [SETTING.RateSource]: input.rateSource.trim(),
      [SETTING.IcDiffThreshold]: new Decimal(input.icDiffThreshold).toFixed(2),
      [SETTING.VariancePct]: new Decimal(input.variancePct)
        .dividedBy(100)
        .toFixed(4)
        .replace(/0{1,2}$/, ''),
    };
    const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
    if (changed.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const key of changed)
          await tx.appSetting.upsert({
            where: { key },
            create: { key, value: after[key]! },
            update: { value: after[key]! },
          });
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.SettingsUpdate,
            entityType: 'APP_SETTING',
            entityId: changed.join(',').slice(0, 100),
            oldValue: Object.fromEntries(changed.map((k) => [k, before[k]])),
            newValue: Object.fromEntries(changed.map((k) => [k, after[k]])),
            ip,
          },
          tx,
        );
      });
    }
    return this.settings(user);
  }

  async renameFsli(user: AuthUser, code: string, name: string, ip: string | null): Promise<void> {
    const f = await this.prisma.fsli.findUnique({ where: { code } });
    if (!f) throw ApiError.notFound(`FSLI ${code} not found.`);
    const clean = name.trim();
    if (clean === f.name) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.fsli.update({ where: { code }, data: { name: clean } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.FsliRename,
          entityType: 'FSLI',
          entityId: code,
          oldValue: { name: f.name },
          newValue: { name: clean },
          ip,
        },
        tx,
      );
    });
  }

  async setDefault(
    user: AuthUser,
    input: { erp: string; accountType: string; fsliCode: string },
    ip: string | null,
  ): Promise<AccountTypeDefaultDto> {
    const erp = input.erp as 'ZOHO' | 'XERO';
    const accountType = input.accountType.trim();
    const fsli = await this.prisma.fsli.findUnique({ where: { code: input.fsliCode } });
    if (!fsli || !fsli.isActive) throw ApiError.validation(`Unknown FSLI ${input.fsliCode}.`);
    if (fsli.computed || fsli.consolidationOnly)
      throw ApiError.validation(
        `${fsli.name} is ${fsli.computed ? 'calculated by the system' : 'produced only by consolidation'}; accounts cannot default to it.`,
      );
    const existing = await this.prisma.accountTypeDefault.findMany({ where: { erp } });
    const before =
      existing.find((d) => d.accountType.toLowerCase() === accountType.toLowerCase()) ?? null;
    if (before?.fsliCode !== fsli.code) {
      await this.prisma.$transaction(async (tx) => {
        if (before)
          await tx.accountTypeDefault.update({
            where: { erp_accountType: { erp, accountType: before.accountType } },
            data: { fsliCode: fsli.code },
          });
        else
          await tx.accountTypeDefault.create({ data: { erp, accountType, fsliCode: fsli.code } });
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.AccountTypeDefaultSet,
            entityType: 'ACCOUNT_TYPE_DEFAULT',
            entityId: `${erp}:${before?.accountType ?? accountType}`.slice(0, 100),
            oldValue: before ? { fsli: before.fsliCode } : null,
            newValue: { accountType: before?.accountType ?? accountType, fsli: fsli.code },
            ip,
          },
          tx,
        );
      });
    }
    return {
      erp,
      accountType: before?.accountType ?? accountType,
      fsliCode: fsli.code,
      fsliName: fsli.name,
    };
  }

  async deleteDefault(
    user: AuthUser,
    erp: string,
    accountType: string,
    ip: string | null,
  ): Promise<void> {
    const key = { erp: erp as 'ZOHO' | 'XERO', accountType };
    const before = await this.prisma.accountTypeDefault.findUnique({
      where: { erp_accountType: key },
    });
    if (!before) throw ApiError.notFound(`No default for ${accountType}.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.accountTypeDefault.delete({ where: { erp_accountType: key } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.AccountTypeDefaultDelete,
          entityType: 'ACCOUNT_TYPE_DEFAULT',
          entityId: `${erp}:${accountType}`.slice(0, 100),
          oldValue: { accountType, fsli: before.fsliCode },
          newValue: null,
          ip,
        },
        tx,
      );
    });
  }
}
