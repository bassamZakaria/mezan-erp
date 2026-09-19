import { createCockpitRoutes } from "@mezan/api";
import {
  createSqliteAccountRoutingStore,
  createSqliteChequeRepository,
  createSqliteLedgerWatermark,
  createStandaloneSqliteSalesReturnStore,
} from "@mezan/persistence";
import type { BackendArea } from "../module-context.js";

export const area: BackendArea = {
  mount(ctx) {
    let busVersion = 0;
    ctx.eventBus.subscribeAll(() => {
      busVersion += 1;
    });
    const watermark = createSqliteLedgerWatermark(ctx.sqlite);
    const { stores } = ctx;
    ctx.app.route(
      "/dashboard",
      createCockpitRoutes(
        {
          ledger: stores.ledger,
          accounts: stores.accounts,
          accountRouting: createSqliteAccountRoutingStore(ctx.sqlite),
          items: stores.items,
          salesInvoices: stores.salesInvoices,
          salesReturns: createStandaloneSqliteSalesReturnStore(ctx.sqlite),
          treasuryAccounts: stores.treasuryAccounts,
          cheques: createSqliteChequeRepository(ctx.sqlite),
          wacSnapshots: stores.stockLedger.snapshots,
          warehouses: stores.warehouses,
          bookVersion: () => `${busVersion}.${watermark.read()}`,
        },
        ctx.resolveAuthContext,
      ),
    );
  },
};
