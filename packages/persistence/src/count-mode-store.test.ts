import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  CountScanOutcome,
  CountScanSource,
  CountScanVoidReason,
  CountZoneKind,
  CountZoneStatus,
  DuplicateRecordIdError,
  Qty,
  type CountScan,
  type CountZone,
  type Item,
} from "@mezan/domain";
import { createSqliteCountItemDirectory, createSqliteCountModeStore } from "./count-mode-store.js";
import { createSqliteItemCatalogStores } from "./item-catalog-store.js";
import { createSqliteItemStore } from "./item-store.js";

const ZONE: CountZone = {
  id: "Z1",
  countId: "C1",
  name: "Drinks",
  kind: CountZoneKind.AdHoc,
  categoryId: null,
  itemIds: ["I1", "I2"],
  counterUserIds: ["alice"],
  status: CountZoneStatus.Open,
  submittedAt: null,
  submittedBy: null,
  approvedAt: null,
  approvedBy: null,
};

function scan(id: string, over: Partial<CountScan> = {}): CountScan {
  return {
    id,
    countId: "C1",
    zoneId: "Z1",
    itemId: "I1",
    barcode: "6221",
    outcome: CountScanOutcome.Counted,
    source: CountScanSource.Scan,
    qty: Qty.fromMajor("1"),
    enteredQty: null,
    unitCode: null,
    userId: "alice",
    scannedAt: "2026-10-17T10:00:00.000Z",
    clientKey: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    note: null,
    ...over,
  };
}

function item(id: string, code: string, over: Partial<Item> = {}): Item {
  return {
    id,
    code,
    nameAr: "صنف",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [{ code: "CTN", name: "كرتونة", factor: 12 }],
    barcodes: [],
    categoryId: null,
    brandId: null,
    seasonId: null,
    description: null,
    defaultSupplierId: null,
    specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: null,
    taxRatePercent: 14,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    imageAttachmentId: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active",
    ...over,
  };
}

describe("SqliteCountModeStore", () => {
  it("round-trips zones, finds a counter's zones, and keeps the scan trail in order", async () => {
    const sqlite = new Database(":memory:");
    const store = createSqliteCountModeStore(sqlite);
    await store.saveZones([ZONE, { ...ZONE, id: "Z2", counterUserIds: ["bob"] }]);
    expect((await store.zonesOfCounter("alice")).map((z) => z.id)).toEqual(["Z1"]);
    await store.updateZone({ ...ZONE, status: CountZoneStatus.Submitted, submittedAt: "t", submittedBy: "alice" });
    expect(await store.findZone("C1", "Z1")).toMatchObject({ status: CountZoneStatus.Submitted, submittedBy: "alice" });

    await store.appendScan(scan("S1"));
    await store.appendScan(scan("S2", { qty: Qty.fromMajor("2.5"), clientKey: "k" }));
    expect((await store.listScans("C1", { itemId: "I1" })).map((s) => s.id)).toEqual(["S1", "S2"]);
    expect((await store.findScanByClientKey("C1", "k"))?.qty.toString()).toBe("2.500000");
    await expect(store.appendScan(scan("S1"))).rejects.toBeInstanceOf(DuplicateRecordIdError);
  });

  it("only lets a scan be voided, once, and never deleted or rewritten", async () => {
    const sqlite = new Database(":memory:");
    const store = createSqliteCountModeStore(sqlite);
    await store.appendScan(scan("S1"));
    await store.voidScans("C1", ["S1"], "carol", CountScanVoidReason.Recount, "t");
    expect(await store.findScan("C1", "S1")).toMatchObject({ voidedBy: "carol", voidReason: CountScanVoidReason.Recount });
    expect(() => sqlite.prepare(`DELETE FROM physical_count_scan`).run()).toThrow(/append-only/);
    expect(() => sqlite.prepare(`UPDATE physical_count_scan SET qty = '9'`).run()).toThrow(/append-only/);
    expect(() => sqlite.prepare(`UPDATE physical_count_scan SET voided_by = 'x'`).run()).toThrow(/append-only/);
  });
});

describe("SqliteCountItemDirectory", () => {
  it("resolves a barcode, falls back to the item code, and expands a category tree", async () => {
    const sqlite = new Database(":memory:");
    const items = createSqliteItemStore(sqlite);
    const catalog = createSqliteItemCatalogStores(sqlite);
    await catalog.categories.create({ id: "DRINKS", nameAr: "مشروبات", nameEn: null, parentId: null, status: "active" });
    await catalog.categories.create({ id: "JUICE", nameAr: "عصائر", nameEn: null, parentId: "DRINKS", status: "active" });
    await items.create(item("I1", "ITM-1", { barcodes: ["6221"], categoryId: "DRINKS" }));
    await items.create(item("I2", "ITM-2", { categoryId: "JUICE" }));
    await items.create(item("I3", "ITM-3", { categoryId: "JUICE", status: "inactive" }));
    await items.create(item("I4", "ITM-4", { categoryId: "DRINKS", trackInventory: false }));
    const directory = createSqliteCountItemDirectory(sqlite);
    expect((await directory.findByBarcode("6221"))?.id).toBe("I1");
    expect((await directory.findByBarcode("ITM-2"))?.id).toBe("I2");
    expect(await directory.findByBarcode("nope")).toBeNull();
    expect(await directory.itemsInCategory("DRINKS")).toEqual(["I1", "I2"]);
  });
});
