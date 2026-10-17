import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { DocumentService } from "../documents/service.js";
import { createDocumentWorkflowGate } from "../documents/journal-document.js";
import { InMemoryDocumentRepository } from "../documents/test-helpers/in-memory-document-repository.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "./test-helpers/in-memory-stores.js";
import { stockAdjustmentDocumentType, type StockAdjustmentDocLine } from "./stock-adjustment-document.js";
import { createInventoryOpsStockHook } from "./document-hooks.js";
import { PhysicalCountService, type PhysicalCount, type PhysicalCountRepository } from "./physical-count.js";
import {
  CountModeRefusal,
  CountModeRefusalError,
  CountModeService,
  CountScanMode,
  CountScanOutcome,
  CountScanVoidReason,
  CountZoneKind,
  CountZoneStatus,
  revealsLiveVariance,
  zoneVarianceOf,
  type CountItemDirectory,
  type CountModeRepository,
  type CountScan,
  type CountZone,
  type CountableItem,
} from "./count-mode.js";

class MemoryCounts implements PhysicalCountRepository {
  private readonly rows = new Map<string, PhysicalCount>();
  async save(count: PhysicalCount) {
    this.rows.set(count.id, count);
  }
  async update(count: PhysicalCount) {
    this.rows.set(count.id, count);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
}

class MemoryCountMode implements CountModeRepository {
  zones = new Map<string, CountZone>();
  scans: CountScan[] = [];
  async saveZones(zones: readonly CountZone[]) {
    for (const z of zones) this.zones.set(z.id, z);
  }
  async updateZone(zone: CountZone) {
    this.zones.set(zone.id, zone);
  }
  async listZones(countId: string) {
    return [...this.zones.values()].filter((z) => z.countId === countId);
  }
  async findZone(countId: string, zoneId: string) {
    const z = this.zones.get(zoneId);
    return z && z.countId === countId ? z : null;
  }
  async zonesOfCounter(userId: string) {
    return [...this.zones.values()].filter((z) => z.counterUserIds.includes(userId));
  }
  async appendScan(scan: CountScan) {
    this.scans.push(scan);
  }
  async findScan(countId: string, scanId: string) {
    return this.scans.find((s) => s.countId === countId && s.id === scanId) ?? null;
  }
  async findScanByClientKey(countId: string, key: string) {
    return this.scans.find((s) => s.countId === countId && s.clientKey === key) ?? null;
  }
  async voidScans(_countId: string, ids: readonly string[], by: string, reason: CountScanVoidReason, at: string) {
    this.scans = this.scans.map((s) => (ids.includes(s.id) ? { ...s, voidedAt: at, voidedBy: by, voidReason: reason } : s));
  }
  async listScans(countId: string, filter: { zoneId?: string; itemId?: string; userId?: string } = {}) {
    return this.scans.filter(
      (s) =>
        s.countId === countId &&
        (!filter.zoneId || s.zoneId === filter.zoneId) &&
        (!filter.itemId || s.itemId === filter.itemId) &&
        (!filter.userId || s.userId === filter.userId),
    );
  }
}

const ITEMS: Record<string, CountableItem> = {
  I1: { id: "I1", code: "I1", barcodes: ["6221"], baseUnitCode: "pcs", alternateUnits: [{ code: "ctn", factor: 12 }, { code: "half", factor: 0.5 }] },
  I2: { id: "I2", code: "I2", barcodes: ["6222"], baseUnitCode: "pcs", alternateUnits: [] },
  I3: { id: "I3", code: "I3", barcodes: ["6223"], baseUnitCode: "pcs", alternateUnits: [] },
};
const directory: CountItemDirectory = {
  async findByBarcode(code) {
    return Object.values(ITEMS).find((i) => i.barcodes.includes(code)) ?? null;
  },
  async findById(id) {
    return ITEMS[id] ?? null;
  },
  async itemsInCategory(categoryId) {
    return categoryId === "DRINKS" ? ["I1", "I2"] : [];
  },
};

async function harness() {
  const stockLedger = new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers: new InMemoryCostLayers(),
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: false },
  });
  let adj = 0;
  const adjustments = new DocumentService<StockAdjustmentDocLine>(stockAdjustmentDocumentType, {
    repo: new InMemoryDocumentRepository<StockAdjustmentDocLine>(),
    numbering: { next: async () => ({ value: ++adj, formatted: `ADJ-${adj}` }) },
    workflow: createDocumentWorkflowGate(() => null),
    stock: createInventoryOpsStockHook(stockLedger),
  });
  for (const [itemId, qty] of [["I1", "10"], ["I2", "6"], ["I3", "4"]] as const) {
    await adjustments.createDraft({
      id: `SEED-${itemId}`,
      date: "2026-01-01",
      memo: "seed",
      lines: [{ itemId, warehouseId: "W1", reason: "INITIAL_STOCK", direction: "IN", qty: Qty.fromMajor(qty), unitCost: Money.fromMajor("5") }],
    });
    await adjustments.confirm(`SEED-${itemId}`);
  }
  const repo = new MemoryCountMode();
  let service!: CountModeService;
  const counts = new PhysicalCountService({
    repo: new MemoryCounts(),
    stockLedger,
    adjustments,
    completionGate: { assertCompletable: (count) => service.assertCompletable(count) },
  });
  service = new CountModeService({ counts, repo, items: directory, now: () => "2026-10-17T10:00:00.000Z" });
  return { service, counts, repo };
}

async function startSession(h: Awaited<ReturnType<typeof harness>>, blind = false) {
  await h.service.start({
    id: "C1",
    warehouseId: "W1",
    date: "2026-10-17",
    blind,
    zoneIds: ["Z-DRINKS", "Z-ADHOC"],
    zones: [
      { name: "Drinks", kind: CountZoneKind.Category, categoryId: "DRINKS", counterUserIds: ["alice"] },
      { name: "Aisle 9", kind: CountZoneKind.AdHoc, itemIds: ["I3"], counterUserIds: ["bob"] },
    ],
  });
}

let scanSeq = 0;
const scan = (over: Partial<Parameters<CountModeService["scan"]>[0]> = {}) => ({
  countId: "C1",
  zoneId: "Z-DRINKS",
  userId: "alice",
  scanId: `S-${++scanSeq}`,
  clientKey: null,
  barcode: "6221",
  itemId: null,
  mode: CountScanMode.Add,
  qty: null,
  unitCode: null,
  ...over,
});

describe("CountModeService", () => {
  it("resolves category zones to their items and refuses an item in two zones", async () => {
    const h = await harness();
    await startSession(h);
    expect((await h.service.listZones("C1")).map((z) => [z.id, z.itemIds])).toEqual([["Z-DRINKS", ["I1", "I2"]], ["Z-ADHOC", ["I3"]]]);
    await expect(
      h.service.start({
        id: "C2",
        warehouseId: "W1",
        date: "2026-10-17",
        zoneIds: [],
        zones: [
          { name: "a", kind: CountZoneKind.AdHoc, itemIds: ["I1"], counterUserIds: ["x"] },
          { name: "b", kind: CountZoneKind.Category, categoryId: "DRINKS", counterUserIds: ["y"] },
        ],
      }),
    ).rejects.toMatchObject({ reason: CountModeRefusal.ItemInTwoZones });
  });

  it("adds scans, sets a total, and keeps every superseded scan in the trail", async () => {
    const h = await harness();
    await startSession(h);
    await h.service.scan(scan());
    await h.service.scan(scan());
    const third = await h.service.scan(scan({ qty: "3", unitCode: "ctn" }));
    expect(third.line?.countedQty?.toString()).toBe("38.000000");
    const set = await h.service.scan(scan({ mode: CountScanMode.Set, qty: "9" }));
    expect(set.line?.countedQty?.toString()).toBe("9.000000");
    const trail = await h.service.listScans("C1", { itemId: "I1" });
    expect(trail).toHaveLength(4);
    expect(trail.filter((s) => s.voidReason === CountScanVoidReason.Replaced)).toHaveLength(3);
  });

  it("refuses a unit whose factor is not a whole number", async () => {
    const h = await harness();
    await startSession(h);
    await expect(h.service.scan(scan({ qty: "1", unitCode: "half" }))).rejects.toMatchObject({ reason: CountModeRefusal.UnknownUnit });
  });

  it("logs unknown and out-of-zone scans without counting them", async () => {
    const h = await harness();
    await startSession(h);
    const unknown = await h.service.scan(scan({ barcode: "000" }));
    const stray = await h.service.scan(scan({ barcode: "6223" }));
    expect([unknown.outcome, stray.outcome]).toEqual([CountScanOutcome.UnknownBarcode, CountScanOutcome.NotInZone]);
    const count = await h.service.findCount("C1");
    expect(count?.lines.every((l) => l.countedQty === null)).toBe(true);
    expect(await h.service.listScans("C1")).toHaveLength(2);
  });

  it("counters count only their own zone and a retried scan is not counted twice", async () => {
    const h = await harness();
    await startSession(h);
    await expect(h.service.scan(scan({ userId: "bob" }))).rejects.toMatchObject({ reason: CountModeRefusal.CounterNotAssigned });
    await h.service.scan(scan({ clientKey: "k1" }));
    const replay = await h.service.scan(scan({ clientKey: "k1" }));
    expect(replay.replayed).toBe(true);
    expect(replay.line?.countedQty?.toString()).toBe("1.000000");
  });

  it("refuses submit until every item is counted, then accepts an explicit zero fill", async () => {
    const h = await harness();
    await startSession(h);
    await h.service.scan(scan());
    await expect(h.service.submitZone("C1", "Z-DRINKS", "alice")).rejects.toMatchObject({ reason: CountModeRefusal.ZoneHasUncountedItems });
    const filled = await h.service.zeroFill("C1", "Z-DRINKS", "alice", ["ZF1"]);
    expect(filled).toHaveLength(1);
    const zone = await h.service.submitZone("C1", "Z-DRINKS", "alice");
    expect(zone.status).toBe(CountZoneStatus.Submitted);
  });

  it("a recount flag clears the line, reopens the zone and demands a fresh count", async () => {
    const h = await harness();
    await startSession(h);
    await h.service.scan(scan({ qty: "7", mode: CountScanMode.Set }));
    await h.service.scan(scan({ barcode: "6222", qty: "6", mode: CountScanMode.Set }));
    await h.service.submitZone("C1", "Z-DRINKS", "alice");
    const { zone, count } = await h.service.flagRecount("C1", "Z-DRINKS", ["I1"], "carol", "short by 3");
    expect(zone.status).toBe(CountZoneStatus.Open);
    expect(count.lines.find((l) => l.itemId === "I1")).toMatchObject({ countedQty: null, recount: true });
    await expect(h.service.submitZone("C1", "Z-DRINKS", "alice")).rejects.toMatchObject({ reason: CountModeRefusal.ZoneHasUncountedItems });
    const again = await h.service.scan(scan({ qty: "10", mode: CountScanMode.Set }));
    expect(again.line).toMatchObject({ recount: false });
    expect(again.line?.countedQty?.toString()).toBe("10.000000");
  });

  it("the person who counted a zone can neither flag a recount nor approve it", async () => {
    const h = await harness();
    await startSession(h);
    await h.service.scan(scan({ qty: "10", mode: CountScanMode.Set }));
    await h.service.scan(scan({ barcode: "6222", qty: "6", mode: CountScanMode.Set }));
    await h.service.submitZone("C1", "Z-DRINKS", "alice");
    await expect(h.service.approveZone("C1", "Z-DRINKS", "alice")).rejects.toMatchObject({ reason: CountModeRefusal.SelfReview });
    await expect(h.service.flagRecount("C1", "Z-DRINKS", ["I1"], "alice", "x")).rejects.toBeInstanceOf(CountModeRefusalError);
    const approved = await h.service.approveZone("C1", "Z-DRINKS", "carol");
    expect(approved).toMatchObject({ status: CountZoneStatus.Approved, approvedBy: "carol" });
  });

  it("blocks completion until every zone is approved and refuses typed sheet totals on a zoned count", async () => {
    const h = await harness();
    await startSession(h);
    await expect(h.counts.recordCounts("C1", [{ itemId: "I1", countedQty: Qty.fromMajor("1") }])).rejects.toMatchObject({ code: "INVALID_PHYSICAL_COUNT" });
    await h.service.scan(scan({ qty: "10", mode: CountScanMode.Set }));
    await h.service.scan(scan({ barcode: "6222", qty: "6", mode: CountScanMode.Set }));
    await h.service.scan(scan({ zoneId: "Z-ADHOC", userId: "bob", barcode: "6223", qty: "3", mode: CountScanMode.Set }));
    await h.service.submitZone("C1", "Z-DRINKS", "alice");
    await h.service.submitZone("C1", "Z-ADHOC", "bob");
    await h.service.approveZone("C1", "Z-DRINKS", "carol");
    await expect(h.service.complete("C1")).rejects.toMatchObject({ reason: CountModeRefusal.ZonesNotApproved });
    await h.service.approveZone("C1", "Z-ADHOC", "carol");
    const done = await h.service.complete("C1");
    expect(done.status).toBe("COMPLETED");
  });

  it("a blind count shows live variance only to a reviewer who is not counting", async () => {
    const h = await harness();
    await startSession(h, true);
    await h.service.scan(scan({ qty: "7", mode: CountScanMode.Set }));
    const count = (await h.service.findCount("C1")) as PhysicalCount;
    const zones = await h.service.listZones("C1");
    expect(revealsLiveVariance(count, zones, { userId: "alice", canReview: false })).toBe(false);
    expect(revealsLiveVariance(count, zones, { userId: "alice", canReview: true })).toBe(false);
    expect(revealsLiveVariance(count, zones, { userId: "carol", canReview: true })).toBe(true);
    expect(zoneVarianceOf(zones[0] as CountZone, count).shortQty.toString()).toBe("3.000000");
  });
});
