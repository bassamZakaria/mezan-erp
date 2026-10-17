import {
  VanReconciliationStepKind,
  VanReconciliationStepState,
  VanTripCashMovementKind,
  VanTripCrewRole,
  VanTripStatus,
} from "@mezan/domain";
import { describe, it, expect } from "vitest";
import { Money, Qty, type VanTrip } from "@mezan/domain";
import { createSqliteVanTripRepository } from "./van-trip-store.js";

function ongoingTrip(overrides: Partial<VanTrip> = {}): VanTrip {
  return {
    id: "vt1",
    tripNo: "VT-000001",
    date: "2026-08-21",
    branchId: "MAIN",
    vanId: null,
    vanWarehouseId: "VAN-WH",
    vanTreasuryAccountId: "VAN-TREAS",
    sourceWarehouseId: "MAIN-WH",
    sourceTreasuryAccountId: "MAIN-TREAS",
    openingCashFloat: Money.fromMajor("500"),
    crew: [
      { employeeId: "emp1", role: VanTripCrewRole.Driver },
      { employeeId: "emp2", role: VanTripCrewRole.Rep },
    ],
    loadedStock: [
      { itemId: "item1", qty: Qty.fromMajor("20") },
      { itemId: "item2", qty: Qty.fromMajor("10") },
    ],
    cashMovements: [],
    status: VanTripStatus.Ongoing,
    openedAt: "2026-08-21T08:00:00.000Z",
    settledAt: null,
    settlement: null,
    notes: "ملاحظات الرحلة",
    ...overrides,
  };
}

describe("SqliteVanTripRepository", () => {
  it("creates and retrieves a trip by id", async () => {
    const repo = createSqliteVanTripRepository();
    try {
      const trip = ongoingTrip();
      await repo.create(trip);
      const reloaded = await repo.findById("vt1");
      expect(reloaded).not.toBeNull();
      expect(reloaded?.id).toBe("vt1");
      expect(reloaded?.tripNo).toBe("VT-000001");
      expect(reloaded?.openingCashFloat.toString()).toBe(trip.openingCashFloat.toString());
      expect(reloaded?.crew).toEqual(trip.crew);
      expect(reloaded?.loadedStock.map((l) => ({ itemId: l.itemId, qty: l.qty.toString() }))).toEqual([
        { itemId: "item1", qty: "20.000000" },
        { itemId: "item2", qty: "10.000000" },
      ]);
      expect(reloaded?.settlement).toBeNull();
      expect(reloaded?.settledAt).toBeNull();
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted trip", async () => {
    const repo = createSqliteVanTripRepository();
    try {
      await repo.create(ongoingTrip());
      await repo.create(ongoingTrip({ id: "vt2", tripNo: "VT-000002" }));
      const all = await repo.list();
      expect(all).toHaveLength(2);
      expect(all.map((t) => t.id).sort()).toEqual(["vt1", "vt2"]);
    } finally {
      repo.close();
    }
  });

  it("update() persists cash movements accrued on an ongoing trip", async () => {
    const repo = createSqliteVanTripRepository();
    try {
      const trip = ongoingTrip();
      await repo.create(trip);
      const withMovements: VanTrip = {
        ...trip,
        cashMovements: [
          { id: "cm1", kind: VanTripCashMovementKind.Sale, amount: Money.fromMajor("120.50"), occurredAt: "2026-08-21T09:00:00.000Z", notes: null },
          { id: "cm2", kind: VanTripCashMovementKind.Collection, amount: Money.fromMajor("75"), occurredAt: "2026-08-21T10:00:00.000Z", notes: "تحصيل من عميل" },
        ],
      };
      await repo.update(withMovements);
      const reloaded = await repo.findById("vt1");
      expect(reloaded?.cashMovements).toHaveLength(2);
      expect(reloaded?.cashMovements[0]?.id).toBe("cm1");
      expect(reloaded?.cashMovements[0]?.kind).toBe("sale");
      expect(reloaded?.cashMovements[0]?.occurredAt).toBe("2026-08-21T09:00:00.000Z");
      expect(reloaded?.cashMovements[0]?.notes).toBeNull();
      expect(reloaded?.cashMovements.map((m) => m.amount.toString())).toEqual(["120.500000", "75.000000"]);
      expect(reloaded?.cashMovements[1]?.notes).toBe("تحصيل من عميل");
    } finally {
      repo.close();
    }
  });

  it("full round trip of a SETTLED trip: settlement with 2+ stockCounts and 2+ cashMovements is lossless", async () => {
    const repo = createSqliteVanTripRepository();
    try {
      const trip = ongoingTrip({
        cashMovements: [
          { id: "cm1", kind: VanTripCashMovementKind.Sale, amount: Money.fromMajor("300"), occurredAt: "2026-08-21T09:00:00.000Z", notes: null },
          { id: "cm2", kind: VanTripCashMovementKind.Collection, amount: Money.fromMajor("50.25"), occurredAt: "2026-08-21T11:00:00.000Z", notes: "تحصيل" },
        ],
      });
      await repo.create(trip);

      const settled: VanTrip = {
        ...trip,
        status: VanTripStatus.Settled,
        settledAt: "2026-08-21T18:00:00.000Z",
        settlement: {
          expectedCash: Money.fromMajor("850.25"),
          countedCash: Money.fromMajor("845.00"),
          cashVariance: Money.fromMajor("-5.25"),
          stockCounts: [
            {
              itemId: "item1",
              expectedQty: Qty.fromMajor("20"),
              countedQty: Qty.fromMajor("18.5"),
              varianceQty: Qty.fromMajor("-1.5"),
              loadedQty: Qty.fromMajor("25"),
              soldQty: Qty.fromMajor("6"),
              returnedQty: Qty.fromMajor("1"),
              otherQty: Qty.zero(),
              unitCost: Money.fromMajor("12.5"),
              varianceValue: Money.fromMajor("-18.75"),
            },
            {
              itemId: "item2",
              expectedQty: Qty.fromMajor("10"),
              countedQty: Qty.fromMajor("10"),
              varianceQty: Qty.fromMajor("0"),
              loadedQty: Qty.fromMajor("10"),
              soldQty: Qty.zero(),
              returnedQty: Qty.zero(),
              otherQty: Qty.zero(),
              unitCost: Money.fromMajor("4"),
              varianceValue: Money.zero(),
            },
          ],
          settledAt: "2026-08-21T18:00:00.000Z",
          settledBy: "user-rep",
          settlementDate: "2026-08-21",
          cashBreakdown: {
            openingFloat: Money.fromMajor("500"),
            fieldSales: Money.fromMajor("300"),
            fieldCollections: Money.fromMajor("50.25"),
            voucherCollections: Money.zero(),
            other: Money.zero(),
          },
          invoicedSales: Money.fromMajor("1200"),
          returnsValue: Money.fromMajor("40"),
          reconciliation: {
            approvedBy: "user-supervisor",
            startedAt: "2026-08-21T19:00:00.000Z",
            completedAt: "2026-08-21T19:00:01.000Z",
            steps: [
              {
                kind: VanReconciliationStepKind.ShortageAdjustment,
                documentId: "VAN-REC:shortage_adjustment:vt1",
                state: VanReconciliationStepState.Posted,
                value: Money.fromMajor("18.75"),
              },
            ],
          },
        },
      };
      await repo.update(settled);

      const reloaded = await repo.findById("vt1");
      expect(reloaded?.status).toBe(VanTripStatus.Settled);
      expect(reloaded?.settledAt).toBe("2026-08-21T18:00:00.000Z");
      expect(reloaded?.settlement).not.toBeNull();
      expect(reloaded?.settlement?.expectedCash.toString()).toBe("850.250000");
      expect(reloaded?.settlement?.countedCash.toString()).toBe("845.000000");
      expect(reloaded?.settlement?.cashVariance.toString()).toBe("-5.250000");
      expect(reloaded?.settlement?.stockCounts).toHaveLength(2);
      expect(
        reloaded?.settlement?.stockCounts.map((c) => ({
          itemId: c.itemId,
          expectedQty: c.expectedQty.toString(),
          countedQty: c.countedQty.toString(),
          varianceQty: c.varianceQty.toString(),
        })),
      ).toEqual([
        { itemId: "item1", expectedQty: "20.000000", countedQty: "18.500000", varianceQty: "-1.500000" },
        { itemId: "item2", expectedQty: "10.000000", countedQty: "10.000000", varianceQty: "0.000000" },
      ]);
      expect(reloaded?.settlement?.stockCounts[0]?.varianceValue.toString()).toBe("-18.750000");
      expect(reloaded?.settlement?.settledBy).toBe("user-rep");
      expect(reloaded?.settlement?.invoicedSales.toString()).toBe("1200.000000");
      expect(reloaded?.settlement?.reconciliation?.steps).toEqual([
        {
          kind: VanReconciliationStepKind.ShortageAdjustment,
          documentId: "VAN-REC:shortage_adjustment:vt1",
          state: VanReconciliationStepState.Posted,
          value: Money.fromMajor("18.75"),
        },
      ]);
      expect(reloaded?.cashMovements).toHaveLength(2);
      expect(reloaded?.cashMovements.map((m) => m.amount.toString())).toEqual(["300.000000", "50.250000"]);
    } finally {
      repo.close();
    }
  });
});
