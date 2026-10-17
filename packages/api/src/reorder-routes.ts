import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  AuditChangeAction,
  InvalidPurchaseDocumentError,
  InvalidReorderPolicyError,
  Money,
  NextNumberService,
  Qty,
  SALES_INVOICE_ACTIVE_STATUSES,
  buildReorderPolicy,
  buildReorderWorklist,
  buildStockReservations,
  createPurchaseOrder,
  groupOrderLines,
  itemTypeIsPurchasable,
  itemTypeTracksStock,
  lineOutstandingQty,
  purchaseOrderSubtotal,
  type AuditSink,
  type Item,
  type ItemRepository,
  type ItemWarehousePolicy,
  type ItemWarehousePolicyRepository,
  type PurchaseOrder,
  type PurchaseOrderRepository,
  type ReorderOrderLine,
  type ReorderRow,
  type SalesInvoiceRepository,
  type StockReservationSource,
  type SupplierRepository,
  type Warehouse,
  type WarehouseRepository,
  type WacSnapshotRepository,
} from "@mezan/domain";
import {
  ReorderProblemDTO,
  ReorderRuleSourceDTO,
  ReorderSkipReasonDTO,
  ReorderTriggerDTO,
  createReorderOrdersSchema,
  reorderWorklistQuerySchema,
  saveReorderPolicySchema,
  type CreateReorderOrdersResultDTO,
  type ReorderCreatedOrderDTO,
  type ReorderPolicyDTO,
  type ReorderRowDTO,
  type ReorderSkippedLineDTO,
  type ReorderWorklistDTO,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, warehouseScopeOf, withinScope, type AuthContextResolver } from "./permission-gate.js";
import { recordAdminEvent } from "./admin-audit.js";
import { tenantToday } from "./tenant-day.js";

export interface ReorderRoutesDeps {
  readonly items: Pick<ItemRepository, "list" | "findById">;
  readonly warehouses: Pick<WarehouseRepository, "findAll" | "findById">;
  readonly suppliers: Pick<SupplierRepository, "findAll" | "findById">;
  readonly policies: ItemWarehousePolicyRepository;
  readonly snapshots: Pick<WacSnapshotRepository, "list">;
  readonly salesInvoices: Pick<SalesInvoiceRepository, "list">;
  readonly orders: PurchaseOrderRepository;
  readonly numbering: NextNumberService;
  readonly reservations?: StockReservationSource;
  readonly audit?: AuditSink;
  readonly today?: () => string;
  readonly now?: () => string;
}

enum ReorderAuditAction {
  PolicySaved = "reorder.policy.saved",
  PolicyRemoved = "reorder.policy.removed",
  OrderCreated = "reorder.order.created",
}

enum ReorderRefusal {
  InvalidRequest = "INVALID_REQUEST",
  ItemNotOrderable = "REORDER_ITEM_NOT_ORDERABLE",
  WarehouseNotFound = "WAREHOUSE_NOT_FOUND",
  WarehouseOutOfScope = "REORDER_WAREHOUSE_OUT_OF_SCOPE",
  SupplierNotFound = "SUPPLIER_NOT_FOUND",
  PolicyNotFound = "REORDER_POLICY_NOT_FOUND",
}

const ORDER_NOTE_AR = "أُنشئ من اقتراحات إعادة الطلب";
const MS_PER_DAY = 86_400_000;

function body(error: string, message: string, messageEn: string, extra: Record<string, unknown> = {}) {
  return { error, message, messageEn, ...extra };
}

function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * MS_PER_DAY).toISOString().slice(0, 10);
}

function rowKey(itemId: string, warehouseId: string): string {
  return `${itemId}\u0000${warehouseId}`;
}

function addTo(map: Map<string, Qty>, key: string, qty: Qty): void {
  map.set(key, (map.get(key) ?? Qty.zero()).add(qty));
}

interface WorklistContext {
  readonly rows: readonly ReorderRow[];
  readonly itemsById: ReadonlyMap<string, Item>;
  readonly warehousesById: ReadonlyMap<string, Warehouse>;
  readonly priceFor: (supplierId: string | null, itemId: string) => Money | null;
}

function latestPrices(orders: readonly PurchaseOrder[]): ReadonlyMap<string, Money> {
  const newest = new Map<string, { at: string; price: Money }>();
  for (const order of orders) {
    if (order.status === "cancelled" || order.status === "draft") continue;
    for (const line of order.lines) {
      if (line.unitPrice.scaled <= 0n) continue;
      const key = rowKey(order.supplierId, line.itemId);
      const stamp = `${order.date}${order.createdAt}`;
      const known = newest.get(key);
      if (!known || stamp > known.at) newest.set(key, { at: stamp, price: line.unitPrice });
    }
  }
  return new Map([...newest].map(([key, value]) => [key, value.price]));
}

export function createReorderRoutes(deps: ReorderRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const actorOf = (c: Context) => getAuthContext(c)?.userId ?? "system";
  const now = () => (deps.now ? deps.now() : new Date().toISOString());

  async function compute(c: Context, windowDays: number, today: string): Promise<WorklistContext> {
    const from = shiftDay(today, -(windowDays - 1));
    const [items, allWarehouses, policies, snapshots, invoices, orders, reservationLines] = await Promise.all([
      deps.items.list(),
      deps.warehouses.findAll(),
      deps.policies.list(),
      deps.snapshots.list(),
      deps.salesInvoices.list({ fromDate: from, toDate: today }),
      deps.orders.list(),
      deps.reservations ? deps.reservations.list() : Promise.resolve([]),
    ]);
    const warehouses = withinScope(allWarehouses, warehouseScopeOf(c), (w) => w.id);
    const visible = new Set(warehouses.map((w) => w.id));

    const sold = new Map<string, Qty>();
    for (const invoice of invoices) {
      if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status) || invoice.date < from || invoice.date > today) continue;
      for (const line of invoice.lines) if (line.isStock) addTo(sold, rowKey(line.itemId, invoice.warehouseId), line.baseQty);
    }

    const open = new Map<string, Qty>();
    const draft = new Map<string, Qty>();
    for (const order of orders) {
      if (order.status === "cancelled" || order.status === "fully_received") continue;
      const target = order.status === "draft" ? draft : open;
      for (const line of order.lines) addTo(target, rowKey(line.itemId, order.warehouseId), lineOutstandingQty(line));
    }

    const reservations = buildStockReservations(reservationLines);
    const rows = buildReorderWorklist({
      items,
      warehouses,
      policies: policies.filter((p) => visible.has(p.warehouseId)),
      snapshots: snapshots.filter((s) => visible.has(s.warehouseId)),
      reserved: (itemId, warehouseId) => reservations.forPosition(itemId, warehouseId),
      onOrder: (itemId, warehouseId) => ({ open: open.get(rowKey(itemId, warehouseId)) ?? Qty.zero(), draft: draft.get(rowKey(itemId, warehouseId)) ?? Qty.zero() }),
      sold: (itemId, warehouseId) => sold.get(rowKey(itemId, warehouseId)) ?? Qty.zero(),
      windowDays,
    });
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const prices = latestPrices(orders);
    return {
      rows,
      itemsById,
      warehousesById: new Map(allWarehouses.map((w) => [w.id, w])),
      priceFor: (supplierId, itemId) => {
        const known = supplierId ? prices.get(rowKey(supplierId, itemId)) : undefined;
        if (known) return known;
        const cost = itemsById.get(itemId)?.costPrice ?? null;
        return cost && cost.scaled > 0n ? cost : null;
      },
    };
  }

  function rowDTO(row: ReorderRow, ctx: WorklistContext, supplierNames: ReadonlyMap<string, string>): ReorderRowDTO | null {
    const item = ctx.itemsById.get(row.itemId);
    const warehouse = ctx.warehousesById.get(row.warehouseId);
    if (!item || !warehouse) return null;
    return {
      key: `${row.itemId}:${row.warehouseId}`,
      itemId: row.itemId,
      itemCode: item.code,
      itemNameAr: item.nameAr,
      itemNameEn: item.nameEn,
      warehouseId: row.warehouseId,
      warehouseName: warehouse.name,
      source: row.source as unknown as ReorderRuleSourceDTO,
      trigger: row.trigger as unknown as ReorderTriggerDTO,
      minQty: row.minQty.toString(),
      maxQty: row.maxQty ? row.maxQty.toString() : null,
      leadDays: row.leadDays,
      packQty: row.packQty.toString(),
      onHand: row.onHand.toString(),
      reserved: row.reserved.toString(),
      onOrder: row.onOrder.toString(),
      onOrderDraft: row.onOrderDraft.toString(),
      position: row.position.toString(),
      soldInWindow: row.soldInWindow.toString(),
      dailyVelocity: row.dailyVelocity.toString(),
      daysOfCover: row.daysOfCover,
      suggestedQty: row.suggestedQty.toString(),
      supplierId: row.supplierId,
      supplierName: row.supplierId ? (supplierNames.get(row.supplierId) ?? null) : null,
      unitPrice: ctx.priceFor(row.supplierId, row.itemId)?.toString() ?? null,
      problems: row.problems as unknown as ReorderProblemDTO[],
    };
  }

  async function supplierNames(): Promise<ReadonlyMap<string, string>> {
    return new Map((await deps.suppliers.findAll()).map((s) => [s.id, s.nameAr]));
  }

  function invalid(c: Context, issues: unknown, messageAr: string, messageEn: string): Response {
    return c.json(body(ReorderRefusal.InvalidRequest, messageAr, messageEn, { issues }), 400);
  }

  app.get("/worklist", gate("inventory.reorder.view"), async (c) => {
    const parsed = reorderWorklistQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return invalid(c, parsed.error.issues, "معايير قائمة إعادة الطلب غير صالحة.", "The reorder worklist filters are not valid.");
    const today = await tenantToday(c, deps.today);
    const ctx = await compute(c, parsed.data.windowDays, today);
    const names = await supplierNames();
    const term = parsed.data.search?.toLowerCase();
    const rows = ctx.rows
      .filter((row) => !parsed.data.warehouseId || row.warehouseId === parsed.data.warehouseId)
      .map((row) => rowDTO(row, ctx, names))
      .filter((row): row is ReorderRowDTO => row !== null)
      .filter((row) => !term || row.itemNameAr.toLowerCase().includes(term) || (row.itemNameEn ?? "").toLowerCase().includes(term) || row.itemCode.toLowerCase().includes(term));
    const result: ReorderWorklistDTO = {
      asOfDate: today,
      windowDays: parsed.data.windowDays,
      rows,
      needsSupplierCount: rows.filter((row) => row.problems.includes(ReorderProblemDTO.NoSupplier)).length,
    };
    return c.json(result);
  });

  function policyDTO(policy: ItemWarehousePolicy, items: ReadonlyMap<string, Item>, warehouses: ReadonlyMap<string, Warehouse>, names: ReadonlyMap<string, string>): ReorderPolicyDTO | null {
    const item = items.get(policy.itemId);
    const warehouse = warehouses.get(policy.warehouseId);
    if (!item || !warehouse) return null;
    return {
      itemId: policy.itemId,
      itemCode: item.code,
      itemNameAr: item.nameAr,
      itemNameEn: item.nameEn,
      warehouseId: policy.warehouseId,
      warehouseName: warehouse.name,
      minQty: policy.minQty.toString(),
      maxQty: policy.maxQty.toString(),
      leadDays: policy.leadDays,
      packQty: policy.packQty.toString(),
      supplierId: policy.supplierId,
      supplierName: policy.supplierId ? (names.get(policy.supplierId) ?? null) : null,
      updatedAt: policy.updatedAt,
      updatedBy: policy.updatedBy,
    };
  }

  app.get("/policies", gate("inventory.reorder.view"), async (c) => {
    const warehouseId = c.req.query("warehouseId") || undefined;
    const itemId = c.req.query("itemId") || undefined;
    const [policies, items, warehouses, names] = await Promise.all([deps.policies.list(), deps.items.list(), deps.warehouses.findAll(), supplierNames()]);
    const itemsById = new Map(items.map((i) => [i.id, i]));
    const warehousesById = new Map(warehouses.map((w) => [w.id, w]));
    const scoped = withinScope(policies, warehouseScopeOf(c), (p) => p.warehouseId);
    const rows = scoped
      .filter((p) => (!warehouseId || p.warehouseId === warehouseId) && (!itemId || p.itemId === itemId))
      .map((p) => policyDTO(p, itemsById, warehousesById, names))
      .filter((p): p is ReorderPolicyDTO => p !== null);
    return c.json(rows);
  });

  function inScope(c: Context, warehouseId: string): boolean {
    const scope = warehouseScopeOf(c);
    return !scope || scope.includes(warehouseId);
  }

  app.put("/policies", gate("inventory.reorder.manage"), async (c) => {
    const parsed = saveReorderPolicySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues, "بيانات سياسة إعادة الطلب غير صالحة.", "The reorder policy is not valid.");
    const input = parsed.data;
    const item = await deps.items.findById(input.itemId);
    if (!item || !itemTypeTracksStock(item.type) || !itemTypeIsPurchasable(item.type) || !item.trackInventory) {
      return c.json(body(ReorderRefusal.ItemNotOrderable, "هذا الصنف لا يُشترى أو لا يُتتبَّع مخزونه، فلا تُحدَّد له سياسة إعادة طلب.", "This item is not purchased or its stock is not tracked, so it cannot have a reorder policy."), 422);
    }
    const warehouse = await deps.warehouses.findById(input.warehouseId);
    if (!warehouse || !warehouse.active) return c.json(body(ReorderRefusal.WarehouseNotFound, "المستودع غير موجود أو غير نشط.", "The warehouse does not exist or is inactive."), 404);
    if (!inScope(c, warehouse.id)) return c.json(body(ReorderRefusal.WarehouseOutOfScope, "هذا المستودع خارج نطاق صلاحياتك.", "This warehouse is outside your access."), 403);
    if (input.supplierId && !(await deps.suppliers.findById(input.supplierId))) {
      return c.json(body(ReorderRefusal.SupplierNotFound, "المورد غير موجود.", "The supplier does not exist."), 404);
    }
    try {
      const previous = await deps.policies.get(input.itemId, input.warehouseId);
      const policy = buildReorderPolicy({
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        minQty: Qty.fromMajor(input.minQty),
        maxQty: Qty.fromMajor(input.maxQty),
        leadDays: input.leadDays,
        packQty: input.packQty ? Qty.fromMajor(input.packQty) : null,
        supplierId: input.supplierId ?? null,
        updatedAt: now(),
        updatedBy: actorOf(c),
      });
      await deps.policies.save(policy);
      await recordAdminEvent(deps.audit, c, {
        module: "inventory",
        entityType: "item_warehouse_policy",
        entityId: `${policy.itemId}:${policy.warehouseId}`,
        action: ReorderAuditAction.PolicySaved,
        details: {
          action: previous ? AuditChangeAction.Update : AuditChangeAction.Create,
          from: previous ? { min: previous.minQty.toString(), max: previous.maxQty.toString(), leadDays: previous.leadDays, pack: previous.packQty.toString(), supplierId: previous.supplierId } : null,
          to: { min: policy.minQty.toString(), max: policy.maxQty.toString(), leadDays: policy.leadDays, pack: policy.packQty.toString(), supplierId: policy.supplierId },
        },
      });
      const dto = policyDTO(policy, new Map([[item.id, item]]), new Map([[warehouse.id, warehouse]]), await supplierNames());
      return c.json(dto);
    } catch (err) {
      if (err instanceof InvalidReorderPolicyError) return c.json(body(err.code, err.message, err.messageEn, { reasons: err.reasons }), 422);
      throw err;
    }
  });

  app.delete("/policies/:itemId/:warehouseId", gate("inventory.reorder.manage"), async (c) => {
    const itemId = c.req.param("itemId");
    const warehouseId = c.req.param("warehouseId");
    if (!inScope(c, warehouseId)) return c.json(body(ReorderRefusal.WarehouseOutOfScope, "هذا المستودع خارج نطاق صلاحياتك.", "This warehouse is outside your access."), 403);
    const existing = await deps.policies.get(itemId, warehouseId);
    if (!existing) return c.json(body(ReorderRefusal.PolicyNotFound, "لا توجد سياسة إعادة طلب لهذا الصنف في هذا المستودع.", "There is no reorder policy for this item in this warehouse."), 404);
    await deps.policies.remove(itemId, warehouseId);
    await recordAdminEvent(deps.audit, c, {
      module: "inventory",
      entityType: "item_warehouse_policy",
      entityId: `${itemId}:${warehouseId}`,
      action: ReorderAuditAction.PolicyRemoved,
      details: { min: existing.minQty.toString(), max: existing.maxQty.toString(), leadDays: existing.leadDays },
    });
    return c.body(null, 204);
  });

  app.post("/orders", gate("inventory.reorder.create"), gate("purchases.order.create"), async (c) => {
    const parsed = createReorderOrdersSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues, "طلب إنشاء أوامر الشراء غير صالح.", "The purchase order request is not valid.");
    const today = await tenantToday(c, deps.today);
    const ctx = await compute(c, parsed.data.windowDays, today);
    const byKey = new Map(ctx.rows.map((row) => [rowKey(row.itemId, row.warehouseId), row]));
    const skipped: ReorderSkippedLineDTO[] = [];
    const accepted: (ReorderOrderLine & { readonly row: ReorderRow })[] = [];
    const seen = new Set<string>();
    const supplierCache = new Map<string, boolean>();
    for (const line of parsed.data.lines) {
      const ref = { itemId: line.itemId, warehouseId: line.warehouseId, qty: line.qty };
      const key = rowKey(line.itemId, line.warehouseId);
      const qty = Qty.fromMajor(line.qty);
      const row = byKey.get(key);
      if (!inScope(c, line.warehouseId)) {
        skipped.push({ ...ref, reason: ReorderSkipReasonDTO.WarehouseOutOfScope });
        continue;
      }
      if (!row || seen.has(key)) {
        skipped.push({ ...ref, reason: ReorderSkipReasonDTO.NotOnWorklist });
        continue;
      }
      if (qty.scaled <= 0n) {
        skipped.push({ ...ref, reason: ReorderSkipReasonDTO.InvalidQty });
        continue;
      }
      let supplierId = row.supplierId;
      if (line.supplierId) {
        if (!supplierCache.has(line.supplierId)) supplierCache.set(line.supplierId, Boolean(await deps.suppliers.findById(line.supplierId)));
        if (!supplierCache.get(line.supplierId)) {
          skipped.push({ ...ref, reason: ReorderSkipReasonDTO.SupplierUnknown });
          continue;
        }
        supplierId = line.supplierId;
      }
      seen.add(key);
      accepted.push({ itemId: line.itemId, warehouseId: line.warehouseId, supplierId, qty, row });
    }
    const split = groupOrderLines(accepted);
    const rowOf = new Map(accepted.map((line) => [rowKey(line.itemId, line.warehouseId), line.row]));
    const names = await supplierNames();
    const created: ReorderCreatedOrderDTO[] = [];
    try {
      for (const group of split.groups) {
        const warehouse = ctx.warehousesById.get(group.warehouseId);
        if (!warehouse) continue;
        const leadDays = Math.max(0, ...group.lines.map((line) => rowOf.get(rowKey(line.itemId, line.warehouseId))?.leadDays ?? 0));
        const order = await createPurchaseOrder(
          {
            id: randomUUID(),
            supplierId: group.supplierId,
            date: today,
            expectedDeliveryDate: leadDays > 0 ? shiftDay(today, leadDays) : null,
            branchId: warehouse.branchId,
            warehouseId: group.warehouseId,
            notes: ORDER_NOTE_AR,
            createdBy: actorOf(c),
            lines: group.lines.map((line) => ({
              itemId: line.itemId,
              qty: line.qty,
              unitPrice: ctx.priceFor(group.supplierId, line.itemId) ?? Money.zero(),
            })),
          },
          { orders: deps.orders, numbering: deps.numbering, now: deps.now },
        );
        await recordAdminEvent(deps.audit, c, {
          module: "inventory",
          entityType: "purchase_order",
          entityId: order.id,
          action: ReorderAuditAction.OrderCreated,
          details: { number: order.number, supplierId: order.supplierId, warehouseId: order.warehouseId, lines: order.lines.length, source: "reorder" },
        });
        created.push({
          orderId: order.id,
          number: order.number,
          supplierId: order.supplierId,
          supplierName: names.get(order.supplierId) ?? order.supplierId,
          warehouseId: order.warehouseId,
          warehouseName: warehouse.name,
          lineCount: order.lines.length,
          total: purchaseOrderSubtotal(order).toString(),
          expectedDeliveryDate: order.expectedDeliveryDate,
        });
      }
    } catch (err) {
      if (err instanceof InvalidPurchaseDocumentError) return c.json(body(err.code, err.message, err.message), 422);
      throw err;
    }
    const result: CreateReorderOrdersResultDTO = {
      created,
      needsSupplier: split.needsSupplier.map((line) => ({ itemId: line.itemId, warehouseId: line.warehouseId, qty: line.qty.toString() })),
      skipped,
    };
    return c.json(result, created.length > 0 ? 201 : 200);
  });

  return app;
}
