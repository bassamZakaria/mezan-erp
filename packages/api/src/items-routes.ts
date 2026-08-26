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
  type ItemRepository,
  type AlternateUnit,
  type WacSnapshotRepository, matchesSearch } from "@mezan/domain";
import { createItemSchema, updateItemSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

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
    brand: item.brand,
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
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("inventory.item.view"), async (c) => {
    const items = await repo.list();
    const q = c.req.query("q");
    const matched = items.filter((item) => matchesSearch(q, item.nameAr, item.nameEn, item.code, ...(item.barcodes ?? [])));
    return c.json(matched.map(serialize));
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
      return c.json(serialize(item));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
