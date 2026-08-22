import { Hono } from "hono";
import {
  computeCostCenterPnL,
  type AccountRepository,
  type CostCenterRepository,
  type LedgerRepository,
} from "@mezan/domain";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

export interface CostCenterPnLRoutesDeps {
  readonly ledger: Pick<LedgerRepository, "listLines">;
  readonly accounts: Pick<AccountRepository, "list">;
  readonly costCenters: Pick<CostCenterRepository, "list">;
}

/**
 * أرباح مراكز التكلفة — Cost Center P&L (docs/catalog/04), mounted under
 * `/cost-center-pl`. `GET /?fromDate&toDate` groups posted revenue/expense lines
 * by their cost-center dimension. Permission: `accounting.reports.view`.
 */
export function createCostCenterPnLRoutes(
  deps: CostCenterPnLRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("accounting.reports.view"), async (c) => {
    const fromDate = c.req.query("fromDate");
    const toDate = c.req.query("toDate");
    const lines = (await deps.ledger.listLines?.({ fromDate, toDate })) ?? [];
    const [accounts, costCenters] = await Promise.all([deps.accounts.list(), deps.costCenters.list()]);
    const report = computeCostCenterPnL(lines, accounts, costCenters);
    return c.json({
      rows: report.rows.map((r) => ({
        costCenterId: r.costCenterId,
        code: r.code,
        name: r.name,
        revenue: r.revenue.toString(),
        expense: r.expense.toString(),
        profit: r.profit.toString(),
      })),
      totals: {
        revenue: report.totals.revenue.toString(),
        expense: report.totals.expense.toString(),
        profit: report.totals.profit.toString(),
      },
    });
  });

  return app;
}
