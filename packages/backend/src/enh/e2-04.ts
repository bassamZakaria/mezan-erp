import {
  EXPIRY_VIEW_PERMISSION,
  createBatchesReportRoutes,
  createExpiryRoutes,
  createFefoPreviewRoutes,
  loadAllCostLayers,
} from "@mezan/api";
import {
  ExpiryAlertKind,
  ExpiryEventCode,
  dueExpiryAlerts,
  toTenantDay,
  type EventCode,
  type LotRequirementLookup,
  type NotificationRule,
} from "@mezan/domain";
import { createSqliteBatchTrailStore, createSqliteExpiryStore, createSqliteNotificationRuleStore } from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

export const EXPIRY_EVENT_CODES: readonly EventCode[] = [ExpiryEventCode.NearExpiry, ExpiryEventCode.Expired];

const DEFAULT_RULES_FLAG = "default_rules_v1";

const RESCAN_ON: ReadonlySet<string> = new Set([
  "PURCHASE_RECEIPT_CONFIRMED",
  "PURCHASE_INVOICE_CONFIRMED",
  "WORK_ORDER_COMPLETED",
  "SALES_INVOICE_CONFIRMED",
  "SALES_RETURN_CONFIRMED",
]);

const EVENT_OF: Record<ExpiryAlertKind, ExpiryEventCode> = {
  [ExpiryAlertKind.NearExpiry]: ExpiryEventCode.NearExpiry,
  [ExpiryAlertKind.Expired]: ExpiryEventCode.Expired,
};

export function lotRequirementFromItems(items: {
  findById(id: string): Promise<{ trackInventory?: boolean; trackBatches: boolean; trackExpiry: boolean; nameAr: string } | null>;
}): LotRequirementLookup {
  return async (itemId) => {
    const item = await items.findById(itemId);
    if (!item || (!item.trackBatches && !item.trackExpiry)) return null;
    return { batch: item.trackBatches, expiry: item.trackExpiry, labelAr: item.nameAr };
  };
}

function defaultRules(now: string): NotificationRule[] {
  return [
    {
      id: "rule-expiry-near",
      name: "تنبيه قرب انتهاء الصلاحية",
      eventCode: ExpiryEventCode.NearExpiry,
      condition: null,
      recipientType: "permission",
      recipientValue: EXPIRY_VIEW_PERMISSION,
      priority: "high",
      channels: ["in_app"],
      titleAr: "قرب انتهاء صلاحية: {{itemName}}",
      bodyAr: "التشغيلة {{batchNo}} في {{warehouseName}} تنتهي في {{expiryDate}} (بعد {{daysToExpiry}} يوماً) — الكمية {{qty}}.",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "rule-expiry-expired",
      name: "تنبيه انتهاء الصلاحية",
      eventCode: ExpiryEventCode.Expired,
      condition: null,
      recipientType: "permission",
      recipientValue: EXPIRY_VIEW_PERMISSION,
      priority: "urgent",
      channels: ["in_app"],
      titleAr: "انتهت صلاحية: {{itemName}}",
      bodyAr: "التشغيلة {{batchNo}} في {{warehouseName}} انتهت في {{expiryDate}} والكمية {{qty}} محجوزة عن البيع حتى تُشطب.",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function createScanner(ctx: BackendModuleContext, store: ReturnType<typeof createSqliteExpiryStore>) {
  let running: Promise<number> | null = null;
  let lastScanDay: string | null = null;
  const run = async (): Promise<number> => {
    if (!ctx.sqlite.open) return 0;
    const today = toTenantDay(new Date().toISOString());
    lastScanDay = today;
    const settings = await store.getSettings();
    const layers = await loadAllCostLayers({ layers: ctx.stores.stockLedger.layers, stockLedger: ctx.stores.stockLedger.ledger });
    const due = dueExpiryAlerts(layers, today, settings.nearExpiryDays);
    if (due.length === 0) return 0;
    const [items, warehouses] = await Promise.all([ctx.stores.items.list(), ctx.stores.warehouses.findAll()]);
    const itemNames = new Map(items.map((i) => [i.id, i.nameAr]));
    const warehouseNames = new Map(warehouses.map((w) => [w.id, w.name]));
    let emitted = 0;
    const emittedAt = new Date().toISOString();
    for (const alert of due) {
      const { layer } = alert;
      const fresh = await store.recordAlert({
        layerId: layer.id,
        kind: alert.kind,
        itemId: layer.itemId,
        warehouseId: layer.warehouseId,
        batchNo: layer.batchNo ?? null,
        expiryDate: layer.expiryDate as string,
        qty: layer.remainingQty.toString(),
        emittedAt,
      });
      if (!fresh) continue;
      emitted += 1;
      ctx.eventBus.publish(EVENT_OF[alert.kind], {
        itemId: layer.itemId,
        itemName: itemNames.get(layer.itemId) ?? layer.itemId,
        warehouseId: layer.warehouseId,
        warehouseName: warehouseNames.get(layer.warehouseId) ?? layer.warehouseId,
        batchNo: layer.batchNo ?? "—",
        documentNumber: layer.batchNo ?? layer.sourceDocNumber ?? layer.sourceDocId,
        expiryDate: layer.expiryDate,
        daysToExpiry: alert.daysToExpiry,
        qty: layer.remainingQty.toString(),
        nearExpiryDays: settings.nearExpiryDays,
        link: "/stock/inventory-batches",
      });
    }
    return emitted;
  };
  const scan = (): Promise<number> => {
    if (!running) {
      running = run().finally(() => {
        running = null;
      });
    }
    return running;
  };
  const scanSafely = (): void => {
    void scan().catch((error: unknown) => console.error("[expiry] scan failed", error));
  };
  const staleDay = () => lastScanDay !== toTenantDay(new Date().toISOString());
  return { scan, scanSafely, staleDay };
}

export const area: BackendArea = {
  async mount(ctx) {
    const store = createSqliteExpiryStore(ctx.sqlite);
    const trail = createSqliteBatchTrailStore(ctx.sqlite);

    if ((await store.getFlag(DEFAULT_RULES_FLAG)) === null) {
      const rules = createSqliteNotificationRuleStore(ctx.sqlite);
      const now = new Date().toISOString();
      for (const rule of defaultRules(now)) {
        if (!(await rules.findById(rule.id))) await rules.save(rule);
      }
      await store.setFlag(DEFAULT_RULES_FLAG, now);
    }

    const scanner = createScanner(ctx, store);
    ctx.eventBus.subscribeAll((event) => {
      if (EXPIRY_EVENT_CODES.includes(event.code)) return;
      if (!RESCAN_ON.has(event.code) && !scanner.staleDay()) return;
      setImmediate(scanner.scanSafely);
    });

    const deps = {
      items: ctx.stores.items,
      warehouses: ctx.stores.warehouses,
      layers: ctx.stores.stockLedger.layers,
      stockLedger: ctx.stores.stockLedger.ledger,
      snapshots: ctx.stores.stockLedger.snapshots,
      trail,
      store,
      audit: ctx.audit,
      scan: scanner.scan,
      forward: async (path: string, init: RequestInit) => ctx.app.request(path, init),
    };
    ctx.app.route("/inventory/expiry", createExpiryRoutes(deps, ctx.resolveAuthContext));
    ctx.app.route("/inventory/fefo-preview", createFefoPreviewRoutes(deps, ctx.resolveAuthContext));
    ctx.app.route("/reports/inventory/batches", createBatchesReportRoutes(deps, ctx.resolveAuthContext));
    scanner.scanSafely();
  },
};

