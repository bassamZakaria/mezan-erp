import { createCockpitRoutes, customerAgingSetIn, type CockpitRoutesDeps } from "@mezan/api";
import {
  createSqliteAccountRoutingStore,
  createSqliteChequeRepository,
  createSqliteLedgerWatermark,
  createStandaloneSqliteSalesReturnStore,
  createAccountRoutingStore,
  createChequeRepository,
  createLedgerWatermark,
  createSalesReturnStore,
} from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

export function cockpitDepsOf(ctx: BackendModuleContext, bookVersion: () => string | Promise<string>): CockpitRoutesDeps {
  const { stores } = ctx;
  return {
    ledger: stores.ledger,
    accounts: stores.accounts,
    accountRouting: ctx.store((s) => createSqliteAccountRoutingStore(s), (d) => createAccountRoutingStore(d)),
    items: stores.items,
    salesInvoices: stores.salesInvoices,
    salesReturns: ctx.store((s) => createStandaloneSqliteSalesReturnStore(s), (d) => createSalesReturnStore(d)),
    receivables: async (view, asOfDate) => {
      const { invoices, terms } = await customerAgingSetIn(ctx.reports, view, asOfDate, asOfDate);
      return { invoices, ...terms };
    },
    treasuryAccounts: stores.treasuryAccounts,
    cheques: ctx.store((s) => createSqliteChequeRepository(s), (d) => createChequeRepository(d)),
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
    const watermark = ctx.store((s) => createSqliteLedgerWatermark(s), (d) => createLedgerWatermark(d));
    ctx.app.route("/dashboard", createCockpitRoutes(cockpitDepsOf(ctx, async () => `${busVersion}.${await watermark.read()}`), ctx.resolveAuthContext));
  },
};
