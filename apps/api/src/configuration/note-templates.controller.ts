import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ApiErrorCode,
  AuditAction,
  Permission,
  type NoteBlockDto,
  type NoteTemplateDto,
  type NoteTemplatesDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { EditConfig, ViewConfig } from './access';

const formatCode = z.string().regex(/^[A-Z0-9_]{2,40}$/, 'Invalid format code');
const templateSchema = z.object({
  title: z.string().trim().min(1, 'Give the note a title').max(200),
  kind: z.enum(['LINE', 'NARRATIVE', 'CUSTOM']),
  lineKeys: z.array(z.string().regex(/^(BS|PL):[A-Za-z0-9_-]{1,60}$/)).max(20),
  mandatory: z.boolean(),
  /** Default text: one paragraph per line (blank = no default text). */
  defaultText: z.string().max(20000),
});

const toText = (blocks: NoteBlockDto[]) =>
  blocks
    .filter((b) => b.type === 'TEXT')
    .map((b) =>
      b.type === 'TEXT'
        ? (b.doc.content ?? [])
            .map((p) => (p.content ?? []).map((t) => t.text ?? '').join(''))
            .join('\n')
        : '',
    )
    .join('\n');
const textBlocks = (text: string): NoteBlockDto[] =>
  text.trim()
    ? [
        {
          id: randomUUID(),
          type: 'TEXT',
          label: '',
          doc: {
            type: 'doc',
            content: text
              .split(/\n/)
              .map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })),
          },
        },
      ]
    : [];

/** Configuration → Report formats → Notes: the note templates of each format. */
@Controller('config/formats/:code/note-templates')
export class NoteTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async finalisedUse(code: string): Promise<string | null> {
    const t = await this.prisma.task.findFirst({
      where: {
        formatCode: code,
        OR: [
          { entities: { some: { status: 'FINALISED' } } },
          { levels: { some: { status: 'FINALISED' } } },
        ],
      },
      select: { number: true },
    });
    return t
      ? `Removing note templates is blocked while a finalised report uses this format (${t.number}).`
      : null;
  }

  @Get()
  @ViewConfig()
  async list(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(formatCode)) code: string,
  ): Promise<NoteTemplatesDto> {
    const f = await this.prisma.format.findUnique({ where: { code } });
    if (!f) throw ApiError.notFound(`Format ${code} not found.`);
    const [rows, version] = await Promise.all([
      this.prisma.noteTemplate.findMany({
        where: { formatCode: code },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.formatVersion.findUnique({
        where: { formatCode_version: { formatCode: code, version: f.currentVersion } },
        include: { lines: { orderBy: [{ statement: 'asc' }, { sortOrder: 'asc' }] } },
      }),
    ]);
    return {
      formatCode: code,
      templates: rows.map((t): NoteTemplateDto => ({
        id: t.id,
        formatCode: code,
        sortOrder: t.sortOrder,
        title: t.title,
        kind: t.kind,
        lineKeys: t.lineKeys,
        defaultBlocks: t.defaultBlocks as unknown as NoteBlockDto[],
        mandatory: t.mandatory,
        appliesTo: t.appliesTo as 'SFS' | 'CFS' | 'ALL',
      })),
      removeBlocked: await this.finalisedUse(code),
      lines: (version?.lines ?? [])
        .filter((l) => l.type === 'LINE')
        .map((l) => ({
          key: `${l.statement}:${l.key}`,
          label: `${l.statement === 'BS' ? 'Balance sheet' : 'P&L'} · ${l.label}`,
        })),
      canEdit: user.permissions.has(Permission.ConfigManage),
    };
  }

  @Post()
  @EditConfig()
  async create(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(formatCode)) code: string,
    @Body(new ZodPipe(templateSchema)) body: z.output<typeof templateSchema>,
    @ClientIp() ip: string | null,
  ): Promise<NoteTemplatesDto> {
    const max = await this.prisma.noteTemplate.aggregate({
      where: { formatCode: code },
      _max: { sortOrder: true },
    });
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.noteTemplate.create({
        data: {
          formatCode: code,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
          title: body.title,
          kind: body.kind,
          lineKeys: body.lineKeys,
          mandatory: body.mandatory,
          defaultBlocks: textBlocks(body.defaultText) as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.NoteTemplateChange,
          entityType: 'NOTE_TEMPLATE',
          entityId: t.id,
          oldValue: null,
          newValue: { format: code, ...body },
          ip,
        },
        tx,
      );
    });
    return this.list(user, code);
  }

  @Put(':id')
  @EditConfig()
  async update(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(formatCode)) code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(templateSchema)) body: z.output<typeof templateSchema>,
    @ClientIp() ip: string | null,
  ): Promise<NoteTemplatesDto> {
    const before = await this.prisma.noteTemplate.findFirst({ where: { id, formatCode: code } });
    if (!before) throw ApiError.notFound('Note template not found.');
    const oldText = toText(before.defaultBlocks as unknown as NoteBlockDto[]);
    // Keep structured default blocks (e.g. tables, labelled policies) unless the text changed.
    const blocks =
      oldText === body.defaultText
        ? (before.defaultBlocks as Prisma.InputJsonValue)
        : [
            ...(before.defaultBlocks as unknown as NoteBlockDto[]).filter((b) => b.type !== 'TEXT'),
            ...textBlocks(body.defaultText),
          ];
    await this.prisma.$transaction(async (tx) => {
      await tx.noteTemplate.update({
        where: { id },
        data: {
          title: body.title,
          kind: body.kind,
          lineKeys: body.lineKeys,
          mandatory: body.mandatory,
          defaultBlocks: blocks as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.NoteTemplateChange,
          entityType: 'NOTE_TEMPLATE',
          entityId: id,
          oldValue: {
            title: before.title,
            kind: before.kind,
            lineKeys: before.lineKeys,
            mandatory: before.mandatory,
            defaultText: oldText,
          },
          newValue: { format: code, ...body },
          ip,
        },
        tx,
      );
    });
    return this.list(user, code);
  }

  @Delete(':id')
  @EditConfig()
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(formatCode)) code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    const before = await this.prisma.noteTemplate.findFirst({ where: { id, formatCode: code } });
    if (!before) throw ApiError.notFound('Note template not found.');
    const blocked = await this.finalisedUse(code);
    if (blocked) throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, blocked);
    await this.prisma.$transaction(async (tx) => {
      await tx.noteTemplate.delete({ where: { id } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.NoteTemplateChange,
          entityType: 'NOTE_TEMPLATE',
          entityId: id,
          oldValue: { title: before.title, kind: before.kind },
          newValue: null,
          ip,
        },
        tx,
      );
    });
  }

  @Put()
  @EditConfig()
  async reorder(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(formatCode)) code: string,
    @Body(new ZodPipe(z.object({ ids: z.array(z.string().uuid()).max(500) })))
    body: { ids: string[] },
    @ClientIp() ip: string | null,
  ): Promise<NoteTemplatesDto> {
    const rows = await this.prisma.noteTemplate.findMany({
      where: { formatCode: code },
      orderBy: { sortOrder: 'asc' },
    });
    if (body.ids.length !== rows.length || !rows.every((r) => body.ids.includes(r.id)))
      throw ApiError.validation('The new order must list every note template once.');
    await this.prisma.$transaction(async (tx) => {
      for (const [i, tid] of body.ids.entries())
        await tx.noteTemplate.update({ where: { id: tid }, data: { sortOrder: i + 1 } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.NoteTemplateChange,
          entityType: 'FORMAT',
          entityId: code,
          oldValue: { order: rows.map((r) => r.title) },
          newValue: { order: body.ids.map((x) => rows.find((r) => r.id === x)!.title) },
          ip,
        },
        tx,
      );
    });
    return this.list(user, code);
  }
}
