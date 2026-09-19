import type { BackendArea, BackendModuleContext } from "../module-context.js";
import { area as master } from "./master.js";
import { area as sessions } from "./sessions.js";
import { area as sales } from "./sales.js";
import { area as print } from "./print.js";
import { area as sell } from "./sell.js";
import { area as refunds } from "./refunds.js";
import { area as approvals } from "./approvals.js";
import { area as offline } from "./offline.js";
import { area as reports } from "./reports.js";
import { area as restaurant } from "./restaurant.js";
import { area as kitchen } from "./kitchen.js";
import { area as deliveries } from "./deliveries.js";

export const POS_AREAS: readonly (readonly [string, BackendArea])[] = [
  ["pos-master", master],
  ["pos-sessions", sessions],
  ["pos-sales", sales],
  ["pos-print", print],
  ["pos-sell", sell],
  ["pos-refunds", refunds],
  ["pos-approvals", approvals],
  ["pos-offline", offline],
  ["pos-reports", reports],
  ["pos-restaurant", restaurant],
  ["pos-kitchen", kitchen],
  ["pos-deliveries", deliveries],
];

export async function mountPos(ctx: BackendModuleContext): Promise<void> {
  for (const [, area] of POS_AREAS) await area.mount?.(ctx);
}
