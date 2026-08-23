import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  previewCustomerImport,
  previewSupplierImport,
  previewItemImport,
  previewOpeningBalanceImport,
  type CustomerRepository,
  type SupplierRepository,
  type ItemRepository,
  type WarehouseRepository,
  type DocumentService,
  type StockAdjustmentDocLine,
  type CustomerImportRowInput,
  type SupplierImportRowInput,
  type ItemImportRowInput,
  type OpeningBalanceImportRowInput,
  type ImportRowError,
} from "@mezan/domain";
import {
  customerImportBatchSchema,
  supplierImportBatchSchema,
  itemImportBatchSchema,
  openingBalanceImportBatchSchema,
  type CustomerImportRowDTO,
  type SupplierImportRowDTO,
  type ItemImportRowDTO,
  type OpeningBalanceImportRowDTO,
} from "@mezan/contracts";
/**
 * Commit must be all-or-nothing, so the route needs a transaction boundary it
 * does not own. Declared here as a port rather than imported from
 * @mezan/persistence: no other production api module depends on a driver.
 */
export interface DataMigrationTransactor {
  run<T>(fn: () => Promise<T>): Promise<T>;
}
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * Data-migration import routes (docs/catalog/09 "نقل البيانات"), mounted at
 * `/data-migration`: preview + commit for customers, suppliers, items and
 * item opening balances. The historical purchase-document import kind is NOT
 * here — it already has its own routes at `/purchases/historical-import`
 * (historical-import-routes.ts).
 *
 * Every `commit` route is all-or-nothing: `/customers`, `/suppliers` and
 * `/items` validate the WHOLE batch first and write NOTHING if any row is
 * invalid, then write every valid row inside `deps.transact.run(...)` — one
 * SQLite transaction shared with the rest of the backend (see
 * `createDataMigrationTransactor`'s doc comment) — so a mid-batch failure
 * rolls every row back rather than leaving a partial import. Opening balances
 * reuse the existing stock-adjustment `DocumentService` (one `INITIAL_STOCK`
 * document per commit call, `createDraft` + `confirm`), which is atomic on
 * its own terms.
 */
export interface DataMigrationRoutesDeps {
  readonly customers: CustomerRepository;
  readonly suppliers: SupplierRepository;
  readonly items: ItemRepository;
  readonly warehouses: WarehouseRepository;
  readonly stockAdjustments: DocumentService<StockAdjustmentDocLine>;
  readonly transact: DataMigrationTransactor;
}

function toMoney(v: string | null | undefined): Money | null | undefined {
  if (v === undefined) return undefined;
  return v === null ? null : Money.fromMajor(v);
}

function toCustomerRows(rows: readonly CustomerImportRowDTO[]): CustomerImportRowInput[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    code: r.code,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    phone: r.phone,
    email: r.email,
    contactPerson: r.contactPerson,
    taxNumber: r.taxNumber,
    category: r.category,
    notes: r.notes,
    paymentTermsDays: r.paymentTermsDays,
    currency: r.currency,
    openingBalance: r.openingBalance !== undefined ? Money.fromMajor(r.openingBalance) : undefined,
    creditLimit: r.creditLimit !== undefined ? Money.fromMajor(r.creditLimit) : undefined,
    taxExempt: r.taxExempt,
    etaBuyerType: r.etaBuyerType,
    nationalId: r.nationalId,
  }));
}

function toSupplierRows(rows: readonly SupplierImportRowDTO[]): SupplierImportRowInput[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    code: r.code,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    phone: r.phone,
    email: r.email,
    contactPerson: r.contactPerson,
    taxNumber: r.taxNumber,
    category: r.category,
    notes: r.notes,
    paymentTermsDays: r.paymentTermsDays,
    currency: r.currency,
    openingBalance: r.openingBalance !== undefined ? Money.fromMajor(r.openingBalance) : undefined,
    addressCity: r.addressCity,
    addressDistrict: r.addressDistrict,
    addressStreet: r.addressStreet,
  }));
}

function toItemRows(rows: readonly ItemImportRowDTO[]): ItemImportRowInput[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    code: r.code,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    type: r.type,
    baseUnitCode: r.baseUnitCode,
    barcodes: r.barcodes,
    categoryId: r.categoryId,
    brand: r.brand,
    costingMethod: r.costingMethod,
    salePrice: toMoney(r.salePrice),
    costPrice: toMoney(r.costPrice),
    taxRatePercent: r.taxRatePercent,
    trackInventory: r.trackInventory,
    reorderPoint: r.reorderPoint,
    reorderQty: r.reorderQty,
  }));
}

function toOpeningBalanceRows(rows: readonly OpeningBalanceImportRowDTO[]): OpeningBalanceImportRowInput[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    itemCode: r.itemCode,
    qty: Qty.fromMajor(r.qty),
    unitCost: Money.fromMajor(r.unitCost),
  }));
}

function byRowNumber(a: ImportRowError, b: ImportRowError): number {
  return a.rowNumber - b.rowNumber;
}

export function createDataMigrationRoutes(
  deps: DataMigrationRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  // --- customers ---

  app.post("/customers/preview", gate("sales.customer.create"), async (c) => {
    const parsed = customerImportBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const existingCodes = new Set((await deps.customers.findAll()).map((x) => x.code));
    const preview = previewCustomerImport(toCustomerRows(parsed.data.rows), existingCodes, () => randomUUID());
    return c.json({ validCount: preview.valid.length, total: parsed.data.rows.length, errors: preview.errors });
  });

  app.post("/customers/commit", gate("sales.customer.create"), async (c) => {
    const parsed = customerImportBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const existingCodes = new Set((await deps.customers.findAll()).map((x) => x.code));
    const preview = previewCustomerImport(toCustomerRows(parsed.data.rows), existingCodes, () => randomUUID());
    if (preview.errors.length > 0) {
      return c.json({ validCount: preview.valid.length, total: parsed.data.rows.length, errors: preview.errors }, 422);
    }
    const createdIds = await deps.transact.run(async () => {
      const ids: string[] = [];
      for (const v of preview.valid) {
        await deps.customers.save(v.customer);
        ids.push(v.customer.id);
      }
      return ids;
    });
    return c.json({ validCount: createdIds.length, total: parsed.data.rows.length, errors: [], createdIds }, 201);
  });

  // --- suppliers ---

  app.post("/suppliers/preview", gate("purchases.supplier.create"), async (c) => {
    const parsed = supplierImportBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const existingCodes = new Set((await deps.suppliers.findAll()).map((x) => x.code));
    const preview = previewSupplierImport(toSupplierRows(parsed.data.rows), existingCodes, () => randomUUID());
    return c.json({ validCount: preview.valid.length, total: parsed.data.rows.length, errors: preview.errors });
  });

  app.post("/suppliers/commit", gate("purchases.supplier.create"), async (c) => {
    const parsed = supplierImportBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const existingCodes = new Set((await deps.suppliers.findAll()).map((x) => x.code));
    const preview = previewSupplierImport(toSupplierRows(parsed.data.rows), existingCodes, () => randomUUID());
    if (preview.errors.length > 0) {
      return c.json({ validCount: preview.valid.length, total: parsed.data.rows.length, errors: preview.errors }, 422);
    }
    const createdIds = await deps.transact.run(async () => {
      const ids: string[] = [];
      for (const v of preview.valid) {
        await deps.suppliers.save(v.supplier);
        ids.push(v.supplier.id);
      }
      return ids;
    });
    return c.json({ validCount: createdIds.length, total: parsed.data.rows.length, errors: [], createdIds }, 201);
  });

  // --- items ---

  app.post("/items/preview", gate("inventory.item.create"), async (c) => {
    const parsed = itemImportBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const existingCodes = new Set((await deps.items.list()).map((x) => x.code));
    const preview = previewItemImport(toItemRows(parsed.data.rows), existingCodes, () => randomUUID());
    return c.json({ validCount: preview.valid.length, total: parsed.data.rows.length, errors: preview.errors });
  });

  app.post("/items/commit", gate("inventory.item.create"), async (c) => {
    const parsed = itemImportBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const existingCodes = new Set((await deps.items.list()).map((x) => x.code));
    const preview = previewItemImport(toItemRows(parsed.data.rows), existingCodes, () => randomUUID());
    if (preview.errors.length > 0) {
      return c.json({ validCount: preview.valid.length, total: parsed.data.rows.length, errors: preview.errors }, 422);
    }
    const createdIds = await deps.transact.run(async () => {
      const ids: string[] = [];
      for (const v of preview.valid) {
        await deps.items.create(v.item);
        ids.push(v.item.id);
      }
      return ids;
    });
    return c.json({ validCount: createdIds.length, total: parsed.data.rows.length, errors: [], createdIds }, 201);
  });

  // --- item opening balances (one warehouse per batch — chosen once, not per row) ---

  async function resolveOpeningBalanceLines(c: Context, body: unknown) {
    const parsed = openingBalanceImportBatchSchema.safeParse(body);
    if (!parsed.success) {
      return { response: c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400) } as const;
    }
    const warehouse = await deps.warehouses.findById(parsed.data.warehouseId);
    if (!warehouse) {
      return { response: c.json({ error: "WAREHOUSE_NOT_FOUND" }, 404) } as const;
    }
    const preview = previewOpeningBalanceImport(toOpeningBalanceRows(parsed.data.rows));
    const errors: ImportRowError[] = [...preview.errors];
    const lines: { itemId: string; qty: Qty; unitCost: Money }[] = [];
    for (const row of preview.valid) {
      const item = await deps.items.findByCode(row.itemCode);
      if (!item) {
        errors.push({ rowNumber: row.rowNumber, reasons: [`الصنف بالكود "${row.itemCode}" غير موجود`] });
        continue;
      }
      lines.push({ itemId: item.id, qty: row.qty, unitCost: row.unitCost });
    }
    errors.sort(byRowNumber);
    return { data: parsed.data, lines, errors } as const;
  }

  app.post("/opening-balances/preview", gate("inventory.adjustment.create"), async (c) => {
    const body = await c.req.json();
    const resolved = await resolveOpeningBalanceLines(c, body);
    if ("response" in resolved) return resolved.response;
    const total = (body as { rows?: unknown[] }).rows?.length ?? 0;
    return c.json({ validCount: resolved.lines.length, total, errors: resolved.errors });
  });

  app.post("/opening-balances/commit", gate("inventory.adjustment.create"), async (c) => {
    const body = await c.req.json();
    const resolved = await resolveOpeningBalanceLines(c, body);
    if ("response" in resolved) return resolved.response;
    const total = (body as { rows?: unknown[] }).rows?.length ?? 0;
    if (resolved.errors.length > 0 || resolved.lines.length === 0) {
      return c.json({ validCount: resolved.lines.length, total, errors: resolved.errors }, 422);
    }
    try {
      const draft = await deps.stockAdjustments.createDraft({
        id: randomUUID(),
        date: resolved.data.date,
        memo: "استيراد أرصدة افتتاحية",
        lines: resolved.lines.map((l) => ({
          itemId: l.itemId,
          warehouseId: resolved.data.warehouseId,
          reason: "INITIAL_STOCK",
          direction: "IN",
          qty: l.qty,
          unitCost: l.unitCost,
        })),
      });
      const { document } = await deps.stockAdjustments.confirm(draft.id);
      return c.json({ validCount: resolved.lines.length, total, errors: [], createdIds: [document.id] }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "OPENING_BALANCE_IMPORT_FAILED", message }, 422);
    }
  });

  return app;
}
