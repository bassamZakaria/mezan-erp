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
  type WacSnapshotRepository,
  ITEM_TYPES,
  itemTypeTracksStock,
  matchesSearch } from "@mezan/domain";
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
  interface ItemListFilter {
    /** The chip key the list is narrowed by: all/active/inactive/`type:<code>`/low_stock/out_of_stock. */
    readonly status?: string;
    readonly categoryId?: string;
    readonly brandId?: string;
    readonly seasonId?: string;
    readonly unitCode?: string;
    readonly search?: string;
  }

  interface ItemRow {
    readonly item: Item;
    readonly onHand: Qty | null;
    readonly stockState: "out" | "low" | "ok" | null;
  }

  function parseItemListQuery(c: Context): ItemListFilter {
    return {
      status: c.req.query("status") || undefined,
      categoryId: c.req.query("categoryId") || undefined,
      brandId: c.req.query("brandId") || undefined,
      seasonId: c.req.query("seasonId") || undefined,
      unitCode: c.req.query("unitCode") || undefined,
      // `q` is the parameter the list has always taken; `search` is the name
      // every other list resource uses. Both reach the same filter.
      search: c.req.query("search") || c.req.query("q") || undefined,
    };
  }

  /**
   * The one filter the rows, the chip counts and the KPI strip all go through
   * (R1.1). Nothing else computes item rows — the three routes below must not
   * be able to disagree about what the catalogue contains.
   */
  async function listFilteredItems(filter: ItemListFilter): Promise<readonly ItemRow[]> {
    const items = await repo.list();
    // Narrow first, then price the survivors: computing a stock state for rows
    // the search is about to drop is work nobody reads.
    let matched = items.filter((item) =>
      matchesSearch(filter.search, item.nameAr, item.nameEn, item.code, ...(item.barcodes ?? [])),
    );
    if (filter.categoryId) matched = matched.filter((i) => i.categoryId === filter.categoryId);
    if (filter.brandId) matched = matched.filter((i) => i.brandId === filter.brandId);
    if (filter.seasonId) matched = matched.filter((i) => i.seasonId === filter.seasonId);
    if (filter.unitCode) matched = matched.filter((i) => i.baseUnitCode === filter.unitCode);

    const onHandByItem = new Map<string, Qty>();
    if (snapshots) {
      for (const position of await snapshots.list()) {
        onHandByItem.set(position.itemId, (onHandByItem.get(position.itemId) ?? Qty.zero()).add(position.onHand));
      }
    }
    let rows: ItemRow[] = matched.map((item) => {
      // An item that does not hold stock has no quantity — reporting zero
      // would put a service in the "out of stock" chip.
      if (!snapshots || !item.trackInventory) return { item, onHand: null, stockState: null };
      const onHand = onHandByItem.get(item.id) ?? Qty.zero();
      return { item, onHand, stockState: stockStateOf(onHand, item.reorderPoint) };
    });

    const chip = filter.status;
    if (chip && chip !== "all") {
      if (chip === "active" || chip === "inactive") rows = rows.filter((r) => r.item.status === chip);
      else if (chip === "low_stock") rows = rows.filter((r) => r.stockState === "low");
      else if (chip === "out_of_stock") rows = rows.filter((r) => r.stockState === "out");
      else {
        const type = chip.startsWith("type:") ? chip.slice("type:".length) : chip;
        if ((ITEM_TYPES as readonly string[]).includes(type)) rows = rows.filter((r) => r.item.type === type);
      }
    }
    return rows;
  }

  function serializeRow(row: ItemRow) {
    return { ...serialize(row.item), onHand: row.onHand?.toString() ?? null, stockState: row.stockState };
  }

  app.get("/", gate("inventory.item.view"), async (c) => {
    const rows = await listFilteredItems(parseItemListQuery(c));
    return c.json(rows.map(serializeRow));
  });

  /**
   * The chip counts. Deliberately drops its own `status` axis: a chip states
   * how many rows it WOULD show, so counting the already chip-filtered set
   * renders every chip but the active one as zero. Every other filter — the
   * category, brand, season, unit and search the user set — still applies.
   *
   * The chip row carries two axes: active/inactive and the item type. Type
   * buckets are keyed `type:<code>` so a type can never collide with a status
   * or a stock-state key.
   */
  app.get("/counts", gate("inventory.item.view"), async (c) => {
    const { status: _ignored, ...withoutStatus } = parseItemListQuery(c);
    const rows = await listFilteredItems(withoutStatus);
    const counts: Record<string, number> = {
      all: rows.length,
      active: 0,
      inactive: 0,
      low_stock: 0,
      out_of_stock: 0,
    };
    // Every type gets a key, including the ones with no items — a chip that
    // only appears once a type is used cannot be used to find that it has none.
    for (const type of ITEM_TYPES) counts[`type:${type}`] = 0;
    for (const row of rows) {
      counts[row.item.status] = (counts[row.item.status] ?? 0) + 1;
      counts[`type:${row.item.type}`] = (counts[`type:${row.item.type}`] ?? 0) + 1;
      if (row.stockState === "low") counts.low_stock! += 1;
      if (row.stockState === "out") counts.out_of_stock! += 1;
    }
    return c.json(counts);
  });

  /**
   * The KPI strip. Unlike `/counts` this DOES honour the chip, so the strip
   * describes the rows on screen. Stock-holding is counted by capability, not
   * by the literal type "stock" — raw materials, finished goods and
   * consumables hold stock too (R5.1).
   */
  app.get("/stats", gate("inventory.item.view"), async (c) => {
    const rows = await listFilteredItems(parseItemListQuery(c));
    const active = rows.filter((r) => r.item.status === "active").length;
    const stockTracked = rows.filter((r) => itemTypeTracksStock(r.item.type)).length;
    return c.json({
      count: rows.length,
      active,
      stockTracked,
      nonStock: rows.length - stockTracked,
    });
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
