import { randomUUID } from "node:crypto";
import { createReorderRoutes } from "@mezan/api";
import { EVENT_BRANCH_IDS_KEY, Qty, type EventCode, type StockReservationSource } from "@mezan/domain";
import {
  createSqliteInventoryOpsStore,
  createSqliteReorderStore,
  createSqlitePurchaseOrderStore,
  type LowStockAlert,
} from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

export const LOW_STOCK_EVENT = "LOW_STOCK_DETECTED" satisfies EventCode;
const LOW_STOCK_LINK = "/inventory/reorder";
const FLUSH_INTERVAL_MS = 1_000;

function reservationSource(ctx: BackendModuleContext): StockReservationSource {
  const inventoryOps = createSqliteInventoryOpsStore(ctx.sqlite);
  return {
    // INVARIANT: mirrors the reservations `createBackend` hands the inventory routes — draft sales invoices and draft transfers (source warehouse only). Change one, change both.
    async list() {
      const [invoices, transfers] = await Promise.all([ctx.stores.salesInvoices.list({ status: "draft" }), inventoryOps.stockTransfers.list({ status: "draft" })]);
      const lines: { itemId: string; warehouseId: string; qty: Qty }[] = [];
      for (const invoice of invoices) {
        for (const line of invoice.lines) if (line.isStock) lines.push({ itemId: line.itemId, warehouseId: invoice.warehouseId, qty: line.baseQty });
      }
      for (const transfer of transfers) {
        for (const line of transfer.lines) lines.push({ itemId: line.itemId, warehouseId: line.fromWarehouseId, qty: line.qty });
      }
      return lines;
    },
  };
}

function alertPayload(alert: LowStockAlert): Record<string, unknown> {
  const itemName = alert.itemNameAr ?? alert.itemCode ?? alert.itemId;
  const warehouseName = alert.warehouseName ?? alert.warehouseId;
  return {
    [EVENT_BRANCH_IDS_KEY]: alert.branchId ? [alert.branchId] : [],
    alertId: alert.id,
    itemId: alert.itemId,
    itemCode: alert.itemCode,
    itemName,
    itemNameEn: alert.itemNameEn,
    warehouseId: alert.warehouseId,
    warehouseName,
    onHand: alert.onHand.toString(),
    reorderPoint: alert.threshold.toString(),
    detectedAt: alert.detectedAt,
    title: "انخفاض مخزون عن الحد الأدنى",
    body: `رصيد «${itemName}» في «${warehouseName}» بلغ ${alert.onHand.toString()} وهو عند حد إعادة الطلب ${alert.threshold.toString()} أو أقل.`,
    link: LOW_STOCK_LINK,
  };
}

export const area: BackendArea = {
  mount(ctx) {
    const store = createSqliteReorderStore(ctx.sqlite);
    const orders = createSqlitePurchaseOrderStore(ctx.sqlite);

    ctx.app.route(
      "/reorder",
      createReorderRoutes(
        {
          items: ctx.stores.items,
          warehouses: ctx.stores.warehouses,
          suppliers: ctx.stores.suppliers,
          policies: store.policies,
          snapshots: ctx.stores.stockLedger.snapshots,
          salesInvoices: ctx.stores.salesInvoices,
          orders,
          numbering: ctx.stores.ledger.numbering,
          reservations: reservationSource(ctx),
          audit: ctx.audit,
        },
        ctx.resolveAuthContext,
      ),
    );

    ctx.inventoryEvents.subscribe((event) => {
      if (event.type !== "StockMoved") return;
      try {
        store.lowStock.recordMove({
          itemId: event.movement.itemId,
          warehouseId: event.movement.warehouseId,
          onHandAfter: event.onHandAfter,
          at: new Date().toISOString(),
          alertId: randomUUID(),
        });
      } catch (error) {
        console.error("[reorder] could not evaluate the reorder point for a stock movement", error);
      }
    });

    let flushing = false;
    const publishPending = async (): Promise<void> => {
      for (const alert of store.lowStock.pending()) {
        try {
          ctx.eventBus.publish(LOW_STOCK_EVENT, alertPayload(alert), alert.detectedAt);
        } catch (error) {
          console.error("[reorder] a low-stock subscriber failed", error);
        }
        store.lowStock.markPublished(alert.id, new Date().toISOString());
      }
    };
    const flush = async (): Promise<void> => {
      if (flushing) return;
      flushing = true;
      try {
        await (ctx.audit.turn ? ctx.audit.turn(publishPending) : publishPending());
      } catch (error) {
        console.error("[reorder] could not publish low-stock alerts", error);
      } finally {
        flushing = false;
      }
    };
    const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    timer.unref();
    ctx.addCloser({ close: () => clearInterval(timer) });
  },
};
