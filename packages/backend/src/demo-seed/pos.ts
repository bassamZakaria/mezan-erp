import type { SeedFragment } from "./fragments.js";
import { seed as master } from "./pos-master.js";
import { seed as sessions } from "./pos-sessions.js";
import { seed as sales } from "./pos-sales.js";
import { seed as print } from "./pos-print.js";
import { seed as sell } from "./pos-sell.js";
import { seed as refunds } from "./pos-refunds.js";
import { seed as approvals } from "./pos-approvals.js";
import { seed as offline } from "./pos-offline.js";
import { seed as reports } from "./pos-reports.js";
import { seed as restaurant } from "./pos-restaurant.js";
import { seed as kitchen } from "./pos-kitchen.js";
import { seed as deliveries } from "./pos-deliveries.js";

export const POS_SEED_FRAGMENTS: readonly SeedFragment[] = [master, sessions, sales, print, sell, refunds, approvals, offline, reports, restaurant, kitchen, deliveries];
