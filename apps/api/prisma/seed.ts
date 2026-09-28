/**
 * Database seed — run with `npm run db:seed` (also run by `npm run dev`).
 *
 * Idempotent (safe to run repeatedly): everything is upserted by its business code.
 *
 *   npm run db:seed                  permissions, templates, entities, master admin
 *   npm run master:reset-password    also resets the master password to MASTER_PASSWORD
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  AuditAction,
  Permission,
  passwordProblems,
  type PermissionCode,
} from '@finance-close/shared';
import { hashPassword, normaliseEmail } from '../src/auth/passwords';

const prisma = new PrismaClient();
const resetMasterPassword = process.argv.includes('--reset-master-password');

const PERMISSIONS: { code: PermissionCode; description: string; area: string }[] = [
  {
    code: Permission.UserAdmin,
    area: 'Administration',
    description: 'Create, edit and deactivate users, and assign permissions',
  },
  {
    code: Permission.ConfigManage,
    area: 'Administration',
    description: 'Maintain configuration (entities, formats, chart of accounts, exchange rates)',
  },
  {
    code: Permission.SfsPrepare,
    area: 'Standalone statements (SFS)',
    description: 'Create and prepare standalone financial statements',
  },
  {
    code: Permission.SfsReview,
    area: 'Standalone statements (SFS)',
    description: 'Review, approve and finalise standalone financial statements',
  },
  {
    code: Permission.CfsPrepare,
    area: 'Consolidation (CFS)',
    description: 'Prepare consolidation',
  },
  {
    code: Permission.CfsReview,
    area: 'Consolidation (CFS)',
    description: 'Review, approve and finalise consolidation',
  },
  {
    code: Permission.EditAccessApprove,
    area: 'Controls',
    description: 'Approve requests to unlock finalised reports',
  },
  {
    code: Permission.ReportsView,
    area: 'Reporting',
    description: 'View reports and dashboards (read-only)',
  },
];

/** Starting points only; permissions are adjusted per user afterwards. */
const TEMPLATES: {
  code: string;
  name: string;
  description: string;
  permissions: PermissionCode[];
}[] = [
  {
    code: 'PREPARER',
    name: 'Preparer',
    description: 'Prepares standalone statements and consolidation; can view reports',
    permissions: [Permission.SfsPrepare, Permission.CfsPrepare, Permission.ReportsView],
  },
  {
    code: 'REVIEWER',
    name: 'Reviewer',
    description: 'Reviews, approves and finalises statements and consolidation; can view reports',
    permissions: [Permission.SfsReview, Permission.CfsReview, Permission.ReportsView],
  },
  {
    code: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access to reports and dashboards',
    permissions: [Permission.ReportsView],
  },
];

/** Group structure from CLAUDE.md (codes and names only in this step). */
const ENTITIES: { code: string; name: string }[] = [
  { code: 'US', name: 'Aistra Labs Inc (US)' },
  { code: 'IN', name: 'Aistra GenAI India Pvt Ltd' },
  { code: 'AE', name: 'Aistra Labs AI Software LLC (UAE)' },
  { code: 'UK', name: 'Aistra Labs UK Ltd' },
  { code: 'UC', name: 'Unconstrained INC' },
  { code: 'VS', name: 'Veracity Services Pte (Singapore)' },
  { code: 'VM', name: 'Veracity Managed Services (Sri Lanka)' },
];

async function seedReferenceData(): Promise<void> {
  for (const [i, p] of PERMISSIONS.entries()) {
    const data = { description: p.description, area: p.area, sortOrder: i + 1 };
    await prisma.permission.upsert({
      where: { code: p.code },
      create: { code: p.code, ...data },
      update: data,
    });
  }
  for (const [i, t] of TEMPLATES.entries()) {
    const data = { name: t.name, description: t.description, sortOrder: i + 1 };
    await prisma.$transaction([
      prisma.permissionTemplate.upsert({
        where: { code: t.code },
        create: { code: t.code, ...data },
        update: data,
      }),
      prisma.permissionTemplatePermission.deleteMany({ where: { templateCode: t.code } }),
      prisma.permissionTemplatePermission.createMany({
        data: t.permissions.map((permissionCode) => ({ templateCode: t.code, permissionCode })),
      }),
    ]);
  }
  for (const e of ENTITIES) {
    // Names are only set on creation: later edits in configuration win over the seed.
    await prisma.entity.upsert({ where: { code: e.code }, create: e, update: {} });
  }
}

async function seedMaster(): Promise<void> {
  const email = normaliseEmail(process.env.MASTER_EMAIL ?? '');
  const password = process.env.MASTER_PASSWORD ?? '';
  const name = (process.env.MASTER_NAME ?? '').trim() || 'Master admin';
  const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);
  if (!/^[^@\s]+@[^@\s]+$/.test(email))
    throw new Error('MASTER_EMAIL in apps/api/.env must be an email address');
  const problems = passwordProblems(password);
  if (problems.length > 0) {
    throw new Error(`MASTER_PASSWORD in apps/api/.env ${problems.join(', ')}`);
  }

  const existing = await prisma.user.findFirst({ where: { isMaster: true } });
  if (!existing) {
    const master = await prisma.user.create({
      data: {
        name,
        email,
        isMaster: true,
        passwordHash: await hashPassword(password, rounds),
        passwordChangedAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        action: AuditAction.UserCreate,
        entityType: 'USER',
        entityId: master.id,
        newValue: { name, email, isMaster: true, source: 'seed' },
      },
    });
    console.log(`Master admin created: ${email}`);
    return;
  }

  if (existing.email !== email) {
    await prisma.user.update({ where: { id: existing.id }, data: { email } });
    await prisma.auditLog.create({
      data: {
        action: AuditAction.UserUpdate,
        entityType: 'USER',
        entityId: existing.id,
        oldValue: { email: existing.email },
        newValue: { email, source: 'seed (MASTER_EMAIL changed)' },
      },
    });
    console.log(`Master admin email changed to ${email}`);
  }

  if (resetMasterPassword) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: await hashPassword(password, rounds),
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          sessionVersion: { increment: 1 },
        },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          action: AuditAction.PasswordReset,
          entityType: 'USER',
          entityId: existing.id,
          newValue: { source: 'master:reset-password script', unlocked: true },
        },
      }),
    ]);
    console.log('Master admin password reset to MASTER_PASSWORD and account unlocked.');
  }
}

async function main(): Promise<void> {
  await seedReferenceData();
  await seedMaster();
  console.log(
    `Seed complete: ${PERMISSIONS.length} permissions, ${TEMPLATES.length} templates, ${ENTITIES.length} entities.`,
  );
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
