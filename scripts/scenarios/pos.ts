import type { ScenarioFragment } from "./fragments.js";
import { scenario as master } from "./pos-master.js";
import { scenario as sessions } from "./pos-sessions.js";
import { scenario as sales } from "./pos-sales.js";
import { scenario as print } from "./pos-print.js";
import { scenario as sell } from "./pos-sell.js";
import { scenario as refunds } from "./pos-refunds.js";
import { scenario as approvals } from "./pos-approvals.js";
import { scenario as offline } from "./pos-offline.js";
import { scenario as reports } from "./pos-reports.js";
import { scenario as restaurant } from "./pos-restaurant.js";
import { scenario as kitchen } from "./pos-kitchen.js";
import { scenario as deliveries } from "./pos-deliveries.js";

export const POS_SCENARIOS: readonly (readonly [string, ScenarioFragment])[] = [
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

export const POS_SMOKE_PATHS: readonly string[] = POS_SCENARIOS.flatMap(([, s]) => s.smokePaths ?? []);
