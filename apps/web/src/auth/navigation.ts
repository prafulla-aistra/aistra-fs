import {
  ClipboardList,
  FilePlus2,
  LayoutDashboard,
  type LucideIcon,
  Settings,
  Users,
} from 'lucide-react';
import { Permission, type PermissionCode } from '@finance-close/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Visible to users holding at least one of these; empty = every signed-in user. */
  anyOf: PermissionCode[];
}

/** Left navigation. Route guards in App.tsx use the same permission lists. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, anyOf: [] },
  {
    label: 'New task',
    to: '/tasks/new',
    icon: FilePlus2,
    anyOf: [Permission.SfsPrepare, Permission.CfsPrepare],
  },
  {
    label: 'Configuration',
    to: '/configuration',
    icon: Settings,
    anyOf: [Permission.ConfigManage],
  },
  { label: 'User management', to: '/users', icon: Users, anyOf: [Permission.UserAdmin] },
  { label: 'Audit trail', to: '/audit', icon: ClipboardList, anyOf: [Permission.UserAdmin] },
];

export function navItem(to: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.to === to);
  if (!item) throw new Error(`Unknown nav item ${to}`);
  return item;
}

/** Sentence-case names for permissions, used on the dashboard and in forms. */
export const PERMISSION_LABELS: Record<PermissionCode, string> = {
  USER_ADMIN: 'User administration',
  CONFIG_MANAGE: 'Manage configuration',
  SFS_PREPARE: 'Prepare standalone statements',
  SFS_REVIEW: 'Review and finalise standalone statements',
  CFS_PREPARE: 'Prepare consolidation',
  CFS_REVIEW: 'Review and finalise consolidation',
  EDIT_ACCESS_APPROVE: 'Approve edit-access requests',
  REPORTS_VIEW: 'View reports and dashboards',
};
