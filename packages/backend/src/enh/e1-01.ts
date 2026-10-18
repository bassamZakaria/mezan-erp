import { createCockpitRoutes, customerAgingSetIn, type CockpitRoutesDeps } from "@mezan/api";
import {
  createSqliteAccountRoutingStore,
  createSqliteChequeRepository,
  createSqliteLedgerWatermark,
  createStandaloneSqliteSalesReturnStore,
} from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

export function cockpitDepsOf(ctx: BackendModuleContext, bookVersion: () => string): CockpitRoutesDeps {
  const { stores } = ctx;
  return {
    ledger: stores.ledger,
    accounts: stores.accounts,
    accountRouting: createSqliteAccountRoutingStore(ctx.sqlite),
    items: stores.items,
    salesInvoices: stores.salesInvoices,
    salesReturns: createStandaloneSqliteSalesReturnStore(ctx.sqlite),
    receivables: async (view, asOfDate) => {
      const { invoices, terms } = await customerAgingSetIn(ctx.reports, view, asOfDate, asOfDate);
      return { invoices, ...terms };
    },
    treasuryAccounts: stores.treasuryAccounts,
    cheques: createSqliteChequeRepository(ctx.sqlite),
    wacSnapshots: stores.stockLedger.snapshots,
    warehouses: stores.warehouses,
    bookVersion,
  };
}

export const area: BackendArea = {
  mount(ctx) {
    let busVersion = 0;
    ctx.eventBus.subscribeAll(() => {
      busVersion += 1;
    });
    const watermark = createSqliteLedgerWatermark(ctx.sqlite);
    ctx.app.route("/dashboard", createCockpitRoutes(cockpitDepsOf(ctx, () => `${busVersion}.${watermark.read()}`), ctx.resolveAuthContext));
  },
};
