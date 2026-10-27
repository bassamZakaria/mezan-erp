import { createPricingGuardRoutes } from "@mezan/api";
import {
  PricingGuardLineOutcome,
  PricingGuardService,
  createDefaultSettings,
  pooledUnitCostAsOf,
  type DocumentPricingGuardPort,
  type Money,
  type StockMovement,
} from "@mezan/domain";
import { createSqliteApprovalRequestStore, createSqliteItemCatalogStores, createSqlitePricingGuardStores, createSqliteWorkflowConfigStore, createApprovalRequestStore, createItemCatalogStores, createPricingGuardStores, createWorkflowConfigStore, type SqlDb } from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

const PRICE_FLOOR_ACTION = "SALES_PRICE_FLOOR_OVERRIDE" as const;
const CATEGORY_DEPTH_LIMIT = 32;

const registry = new WeakMap<SqlDb, DocumentPricingGuardPort>();

// ORDERING: the core API mounts before the enhancement areas, so the port reads the guard at call time.
export function pricingGuardPortFor(db: SqlDb): DocumentPricingGuardPort {
  return {
    evaluate: async (input) => registry.get(db)?.evaluate(input) ?? { outcome: PricingGuardLineOutcome.Pass, lines: [] },
    approvalChainConfigured: async () => (await registry.get(db)?.approvalChainConfigured()) ?? false,
    recordOverrides: async (rows) => {
      await registry.get(db)?.recordOverrides(rows);
    },
  };
}

function groupByWarehouse(movements: readonly StockMovement[]): Map<string, StockMovement[]> {
  const out = new Map<string, StockMovement[]>();
  for (const movement of movements) {
    const list = out.get(movement.warehouseId) ?? [];
    list.push(movement);
    out.set(movement.warehouseId, list);
  }
  return out;
}

export const area: BackendArea = {
  mount(ctx: BackendModuleContext) {
    const stores = ctx.store((s) => createSqlitePricingGuardStores(s), (d) => createPricingGuardStores(d));
    const catalog = ctx.store((s) => createSqliteItemCatalogStores(s), (d) => createItemCatalogStores(d));
    const workflowConfigs = ctx.store((s) => createSqliteWorkflowConfigStore(s), (d) => createWorkflowConfigStore(d));
    const approvalRequests = ctx.store((s) => createSqliteApprovalRequestStore(s), (d) => createApprovalRequestStore(d));
    const { items, customers, warehouses, stockLedger, settings } = ctx.stores;

    async function categoryAncestry(itemId: string): Promise<readonly string[]> {
      const item = await items.findById(itemId);
      const chain: string[] = [];
      let next = item?.categoryId ?? null;
      while (next && !chain.includes(next) && chain.length < CATEGORY_DEPTH_LIMIT) {
        chain.push(next);
        next = (await catalog.categories.findById(next))?.parentId ?? null;
      }
      return chain;
    }

    async function unitCostAsOf(query: { itemId: string; warehouseId: string | null; branchId: string; date: string }): Promise<Money | null> {
      if (query.warehouseId) {
        const movements = await stockLedger.ledger.listByPosition(query.itemId, query.warehouseId);
        return pooledUnitCostAsOf([{ itemId: query.itemId, warehouseId: query.warehouseId, movements }], query.date);
      }
      const branchWarehouses = new Set((await warehouses.findByBranch(query.branchId)).map((warehouse) => warehouse.id));
      const byWarehouse = groupByWarehouse(await stockLedger.ledger.listByItem(query.itemId));
      const positions = [...byWarehouse.entries()]
        .filter(([warehouseId]) => branchWarehouses.size === 0 || branchWarehouses.has(warehouseId))
        .map(([warehouseId, movements]) => ({ itemId: query.itemId, warehouseId, movements }));
      return pooledUnitCostAsOf(positions, query.date);
    }

    const guard = new PricingGuardService({
      rules: stores.rules,
      overrides: stores.overrides,
      costs: {
        unitCostAsOf,
        itemCostPrice: async (itemId) => (await items.findById(itemId))?.costPrice ?? null,
      },
      categoryAncestry,
      customerCategory: async (customerId) => (await customers.findById(customerId))?.category ?? null,
      rateOn: (currency, date) => ctx.treasuryFx.rateOn(currency, date),
      baseCurrency: async () => ((await settings.get()) ?? createDefaultSettings()).currency,
      approvalChainConfigured: async () => ((await workflowConfigs.resolve(PRICE_FLOOR_ACTION))?.steps.length ?? 0) > 0,
    });
    registry.set(ctx.db, guard);

    ctx.app.route(
      "/pricing-guard",
      createPricingGuardRoutes(
        {
          rules: stores.rules,
          overrides: stores.overrides,
          guard,
          itemExists: async (itemId) => (await items.findById(itemId)) !== null,
          categoryExists: async (categoryId) => (await catalog.categories.findById(categoryId)) !== null,
          customerTaxExempt: async (customerId) => (await customers.findById(customerId))?.taxExempt ?? false,
          approvalOf: async (requestId) => {
            const request = await approvalRequests.findById(requestId);
            if (!request) return null;
            return {
              submittedBy: request.submittedBy,
              approvedBy: request.decisions.filter((decision) => decision.kind === "approve" || decision.kind === "bypass").map((decision) => decision.actorId),
            };
          },
          userName: async (userId) => (await ctx.uow.users.findById(userId))?.nameAr ?? null,
          audit: ctx.audit,
        },
        ctx.resolveAuthContext,
      ),
    );
    ctx.addCloser(stores);
  },
};
