import { Hono, type Context } from "hono";
import {
  createItem,
  updateItem,
  createDefaultSettings,
  type SettingsRepository,
  Money,
  Qty,
  DuplicateItemCodeError,
  InvalidItemError,
  ItemNotFoundError,
  type Item,
  recordSensitiveEvent,
  type AuditSink,
  type ItemRepository,
  type AlternateUnit,
  type WacSnapshotRepository, matchesSearch } from "@mezan/domain";
import { createItemSchema, updateItemSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/** Wire representation of an item — money as decimal strings, byte-stable. */
function serialize(item: Item) {
  return {
    id: item.id,
    code: item.code,
    nameAr: item.nameAr,
    nameEn: item.nameEn,
    type: item.type,
    baseUnitCode: item.baseUnitCode,
    alternateUnits: item.alternateUnits,
    barcodes: item.barcodes,
    categoryId: item.categoryId,
    brandId: item.brandId,
    description: item.description,
    defaultSupplierId: item.defaultSupplierId,
    seasonId: item.seasonId,
    specifications: item.specifications,
    costingMethod: item.costingMethod,
    salePrice: item.salePrice?.toString() ?? null,
    costPrice: item.costPrice?.toString() ?? null,
    taxRatePercent: item.taxRatePercent,
    trackInventory: item.trackInventory,
    trackBatches: item.trackBatches,
    trackExpiry: item.trackExpiry,
    reorderPoint: item.reorderPoint,
    reorderQty: item.reorderQty,
    revenueAccountId: item.revenueAccountId,
    cogsAccountId: item.cogsAccountId,
    inventoryAccountId: item.inventoryAccountId,
    etaCodeType: item.etaCodeType,
    etaItemCode: item.etaItemCode,
    gpcCode: item.gpcCode,
    status: item.status,
  };
}

/**
 * Where an item sits against its reorder point. `low` needs a reorder point to
 * mean anything: with none set, stock on hand is simply `ok`.
 */
function stockStateOf(onHand: Qty, reorderPoint: number | null): "out" | "low" | "ok" {
  if (onHand.scaled <= 0n) return "out";
  if (reorderPoint !== null && onHand.scaled <= Qty.fromMajor(String(reorderPoint)).scaled) return "low";
  return "ok";
}

function toMoney(value: string | null | undefined): Money | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : Money.fromMajor(value);
}

function toAlternateUnits(value: AlternateUnit[] | undefined): AlternateUnit[] | undefined {
  return value;
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof ItemNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateItemCodeError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidItemError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

/**
 * Items routes (docs/catalog/03-inventory.md "الأصناف"): list, get one with its
 * real on-hand position, create, edit. Every route is permission-gated via the
 * permissions engine (`inventory.item.view` / `.create` / `.edit`).
 *
 * `snapshots` is optional only so editions that mount items without an
 * inventory ledger still work; when it is absent the detail reports no
 * position rather than a fabricated zero.
 */
export function createItemsRouter(
  repo: ItemRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
  snapshots?: WacSnapshotRepository,
  /** Tenant settings, so a new item inherits the tenant's own default VAT rate (§"الضريبة"). */
  settings?: SettingsRepository,
  audit?: AuditSink,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  /**
   * An item's own trail. The sale and cost prices are why this matters: they
   * decide the margin every invoice line books, and a quiet edit to either
   * restates profitability on documents nobody re-opened.
   */
  async function record(c: Context, item: Item, action: "CREATE" | "UPDATE", before?: Item) {
    if (!audit) return;
    const priceMoved =
      before !== undefined &&
      (before.salePrice?.scaled !== item.salePrice?.scaled || before.costPrice?.scaled !== item.costPrice?.scaled);
    await recordSensitiveEvent(audit, {
      module: "inventory",
      entityType: "ITEM",
      entityId: item.id,
      action,
      actor: getAuthContext(c)?.userId ?? "system",
      severity: priceMoved ? "WARNING" : "INFO",
      details: {
        code: item.code,
        nameAr: item.nameAr,
        salePrice: item.salePrice?.toString() ?? null,
        costPrice: item.costPrice?.toString() ?? null,
        ...(before
          ? { previousSalePrice: before.salePrice?.toString() ?? null, previousCostPrice: before.costPrice?.toString() ?? null }
          : {}),
      },
    });
  }

  /**
   * The list carries each item's on-hand quantity and its stock state (R5.2).
   * Without it the list could not answer the question it exists for — what is
   * low, what has run out — and every screen that wanted a quantity had to
   * fetch the whole position table for itself.
   *
   * Computed from one `snapshots.list()` rather than a lookup per item: the
   * per-item version is an N+1 that gets slower with the catalogue.
   */
  app.get("/", gate("inventory.item.view"), async (c) => {
    const items = await repo.list();
    // Narrow first, then price the survivors: computing a stock state for rows
    // the search is about to drop is work nobody reads.
    const q = c.req.query("q");
    const matched = items.filter((item) => matchesSearch(q, item.nameAr, item.nameEn, item.code, ...(item.barcodes ?? [])));
    if (!snapshots) return c.json(matched.map((item) => ({ ...serialize(item), onHand: null, stockState: null })));
    const onHandByItem = new Map<string, Qty>();
    for (const position of await snapshots.list()) {
      onHandByItem.set(position.itemId, (onHandByItem.get(position.itemId) ?? Qty.zero()).add(position.onHand));
    }
    return c.json(
      matched.map((item) => {
        // An item that does not hold stock has no quantity — reporting zero
        // would put a service in the "out of stock" chip.
        if (!item.trackInventory) return { ...serialize(item), onHand: null, stockState: null };
        const onHand = onHandByItem.get(item.id) ?? Qty.zero();
        return { ...serialize(item), onHand: onHand.toString(), stockState: stockStateOf(onHand, item.reorderPoint) };
      }),
    );
  });

  app.get("/:id", gate("inventory.item.view"), async (c) => {
    const item = await repo.findById(c.req.param("id"));
    if (!item) return c.json({ error: "NOT_FOUND" }, 404);
    if (!snapshots) return c.json({ ...serialize(item), stock: null });
    const positions = (await snapshots.list()).filter((s) => s.itemId === item.id);
    return c.json({
      ...serialize(item),
      stock: {
        onHand: positions.reduce((sum, p) => sum.add(p.onHand), Qty.zero()).toString(),
        byWarehouse: positions.map((p) => ({
          warehouseId: p.warehouseId,
          onHand: p.onHand.toString(),
          totalValue: p.totalValue.toString(),
        })),
      },
    });
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = createItemSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const tenant = settings ? ((await settings.get()) ?? createDefaultSettings()) : null;
      const item = await createItem(
        {
          ...parsed.data,
          alternateUnits: toAlternateUnits(parsed.data.alternateUnits),
          salePrice: toMoney(parsed.data.salePrice),
          costPrice: toMoney(parsed.data.costPrice),
          taxRatePercent:
            parsed.data.taxRatePercent ?? (tenant ? (tenant.taxEnabled ? tenant.defaultTaxRate : 0) : undefined),
        },
        repo,
      );
      await record(c, item, "CREATE");
      return c.json(serialize(item), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("inventory.item.edit"), async (c) => {
    const parsed = updateItemSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const before = await repo.findById(c.req.param("id"));
      const item = await updateItem(
        c.req.param("id"),
        {
          ...parsed.data,
          alternateUnits: toAlternateUnits(parsed.data.alternateUnits),
          salePrice: toMoney(parsed.data.salePrice),
          costPrice: toMoney(parsed.data.costPrice),
        },
        repo,
      );
      await record(c, item, "UPDATE", before ?? undefined);
      return c.json(serialize(item));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
