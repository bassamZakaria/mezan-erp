import type { PermissionFragment, PermissionModuleFragment, PermissionRow } from "../permissions/fragment.js";
import { fragment as master } from "./permissions/master.js";
import { fragment as sessions } from "./permissions/sessions.js";
import { fragment as sales } from "./permissions/sales.js";
import { fragment as print } from "./permissions/print.js";
import { fragment as sell } from "./permissions/sell.js";
import { fragment as refunds } from "./permissions/refunds.js";
import { fragment as approvals } from "./permissions/approvals.js";
import { fragment as offline } from "./permissions/offline.js";
import { fragment as reports } from "./permissions/reports.js";
import { fragment as restaurant } from "./permissions/restaurant.js";
import { fragment as kitchen } from "./permissions/kitchen.js";
import { fragment as deliveries } from "./permissions/deliveries.js";

const FRAGMENTS: readonly PermissionFragment[] = [master, sessions, sales, print, sell, refunds, approvals, offline, reports, restaurant, kitchen, deliveries];

export const POS_PERMISSION_MODULES: readonly PermissionModuleFragment[] = [
  { id: "pos", labelAr: "نقاط البيع" },
  ...FRAGMENTS.flatMap((f) => f.modules ?? []),
];
export const POS_PERMISSION_ROWS: readonly PermissionRow[] = FRAGMENTS.flatMap((f) => f.rows);
export const POS_PERMISSION_ACTIONS: readonly string[] = FRAGMENTS.flatMap((f) => f.actions ?? []);
