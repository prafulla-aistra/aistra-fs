import type { Prisma } from '@prisma/client';
import type { FormatFsli, FormatLine } from '@finance-close/engine';
import { ApiError } from '../common/api-error';

type Db = Pick<Prisma.TransactionClient, 'format' | 'formatVersion' | 'fsli'>;

/** Every FSLI (for statements and notes). */
export async function loadFslis(db: Db): Promise<FormatFsli[]> {
  const rows = await db.fsli.findMany({ orderBy: { sortOrder: 'asc' } });
  return rows.map((f) => ({ code: f.code, name: f.name, statement: f.statement, class: f.class }));
}

/** A format's lines: a given version, else the current one (P&L first, then balance sheet). */
export async function loadFormatLines(db: Db, code: string, version?: number | null) {
  const f = await db.format.findUnique({ where: { code } });
  if (!f) throw ApiError.notFound(`Format ${code} not found.`);
  const v = await db.formatVersion.findUnique({
    where: { formatCode_version: { formatCode: code, version: version ?? f.currentVersion } },
    include: { lines: { orderBy: [{ statement: 'desc' }, { sortOrder: 'asc' }] } },
  });
  if (!v) throw ApiError.notFound(`Format ${code} has no version ${version}.`);
  const lines: FormatLine[] = v.lines.map((l) => ({
    key: l.key,
    statement: l.statement,
    type: l.type,
    label: l.label,
    indent: l.indent,
    fslis: l.fslis,
    formula: l.formula as FormatLine['formula'],
    role: (l.role ?? null) as FormatLine['role'],
  }));
  return { format: f, version: v.version, lines };
}
