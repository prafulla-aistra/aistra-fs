import { Permission } from '@finance-close/shared';
import { RequirePermission } from '../auth/access-control';

/** Read configuration: maintainers and report viewers. */
export const ViewConfig = () => RequirePermission(Permission.ConfigManage, Permission.ReportsView);

/** Change configuration: CONFIG_MANAGE only. */
export const EditConfig = () => RequirePermission(Permission.ConfigManage);
