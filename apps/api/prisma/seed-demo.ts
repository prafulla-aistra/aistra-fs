/**
 * Demo users — seeded ONLY when DEMO_MODE=true (local development and demos).
 *
 * Known passwords, documented only here and in the README. They skip the forced first-login
 * password change. Existing users are never modified, so a demo user whose password or
 * permissions were changed in the app keeps those changes.
 */
import type { PrismaClient } from '@prisma/client';
import { AuditAction } from '@finance-close/shared';
import { hashPassword } from '../src/auth/passwords';

export const DEMO_USERS = [
  {
    name: 'Priya',
    email: 'priya@financeclose.local',
    password: 'Priya-Demo-2026',
    templateCode: 'PREPARER',
  },
  {
    name: 'Rahul',
    email: 'rahul@financeclose.local',
    password: 'Rahul-Demo-2026',
    templateCode: 'REVIEWER',
  },
  {
    name: 'Viewer',
    email: 'viewer@financeclose.local',
    password: 'Viewer-Demo-2026',
    templateCode: 'VIEWER',
  },
] as const;

export async function seedDemoUsers(prisma: PrismaClient, rounds: number): Promise<void> {
  for (const d of DEMO_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: d.email } });
    if (existing) {
      if (!existing.isDemo)
        console.warn(`Demo user skipped: ${d.email} already exists as a normal user.`);
      continue;
    }
    const template = await prisma.permissionTemplate.findUniqueOrThrow({
      where: { code: d.templateCode },
      include: { permissions: true },
    });
    const user = await prisma.user.create({
      data: {
        name: d.name,
        email: d.email,
        passwordHash: await hashPassword(d.password, rounds),
        passwordChangedAt: new Date(),
        isDemo: true,
        mustChangePassword: false,
        templateCode: d.templateCode,
        permissions: {
          create: template.permissions.map((p) => ({ permissionCode: p.permissionCode })),
        },
      },
    });
    await prisma.auditLog.create({
      data: {
        action: AuditAction.UserCreate,
        entityType: 'USER',
        entityId: user.id,
        newValue: {
          name: d.name,
          email: d.email,
          templateCode: d.templateCode,
          permissions: template.permissions.map((p) => p.permissionCode).sort(),
          source: 'seed (demo mode)',
        },
      },
    });
    console.log(`Demo user created: ${d.email}`);
  }
}
