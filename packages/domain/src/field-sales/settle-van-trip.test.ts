import { describe, it, expect, vi } from "vitest";
import { Money, Qty } from "../money/index.js";
import { createInMemoryVanTripRepository } from "./test-helpers/in-memory-van-trip-repository.js";
import { openVanTrip, type OpenVanTripDeps } from "./open-van-trip.js";
import { recordVanCashMovement } from "./record-van-cash-movement.js";
import { settleVanTrip, type SettleVanTripDeps } from "./settle-van-trip.js";
import { VanTripNotOngoingError } from "./errors.js";

function openDeps(trips: ReturnType<typeof createInMemoryVanTripRepository>): OpenVanTripDeps {
  return { trips, stock: { postTransfer: vi.fn().mockResolvedValue(undefined) } };
}

async function openBasicTrip(trips: ReturnType<typeof createInMemoryVanTripRepository>) {
  return openVanTrip(
    {
      id: "trip1",
      date: "2026-08-01",
      branchId: "branch1",
      vanWarehouseId: "wh-van",
      vanTreasuryAccountId: "treasury-van",
      sourceWarehouseId: "wh-main",
      sourceTreasuryAccountId: "treasury-main",
      crew: [{ employeeId: "emp1", role: "driver" }],
      openingCashFloat: Money.fromMajor("500"),
      loadedStock: [
        { itemId: "item1", qty: Qty.fromMajor("10") },
        { itemId: "item2", qty: Qty.fromMajor("5") },
      ],
    },
    openDeps(trips),
  );
}

describe("settleVanTrip", () => {
  it("full open -> accrual -> settle flow: exact cash match gives zero variance", async () => {
    const trips = createInMemoryVanTripRepository();
    let trip = await openBasicTrip(trips);

    trip = recordVanCashMovement(trip, {
      id: "cm1",
      kind: "sale",
      amount: Money.fromMajor("200"),
      occurredAt: "2026-08-01T10:00:00Z",
    });
    trip = recordVanCashMovement(trip, {
      id: "cm2",
      kind: "collection",
      amount: Money.fromMajor("50"),
      occurredAt: "2026-08-01T11:00:00Z",
    });
    await trips.update(trip);

    const deps: SettleVanTripDeps = { trips };
    const settled = await settleVanTrip(
      {
        tripId: "trip1",
        countedCash: Money.fromMajor("750"),
        stockCounts: [
          { itemId: "item1", countedQty: Qty.fromMajor("10") },
          { itemId: "item2", countedQty: Qty.fromMajor("5") },
        ],
      },
      deps,
    );

    expect(settled.status).toBe("settled");
    expect(settled.settlement).not.toBeNull();
    expect(settled.settlement?.expectedCash.equals(Money.fromMajor("750"))).toBe(true);
    expect(settled.settlement?.cashVariance.equals(Money.zero())).toBe(true);
  });

  it("shortage: countedCash below expected gives a negative cashVariance of exact magnitude", async () => {
    const trips = createInMemoryVanTripRepository();
    let trip = await openBasicTrip(trips);
    trip = recordVanCashMovement(trip, {
      id: "cm1",
      kind: "sale",
      amount: Money.fromMajor("200"),
      occurredAt: "2026-08-01T10:00:00Z",
    });
    await trips.update(trip);

    const settled = await settleVanTrip(
      { tripId: "trip1", countedCash: Money.fromMajor("650"), stockCounts: [] },
      { trips },
    );

    expect(settled.settlement?.expectedCash.equals(Money.fromMajor("700"))).toBe(true);
    expect(settled.settlement?.cashVariance.equals(Money.fromMajor("-50"))).toBe(true);
  });

  it("overage: countedCash above expected gives a positive cashVariance", async () => {
    const trips = createInMemoryVanTripRepository();
    let trip = await openBasicTrip(trips);
    trip = recordVanCashMovement(trip, {
      id: "cm1",
      kind: "sale",
      amount: Money.fromMajor("200"),
      occurredAt: "2026-08-01T10:00:00Z",
    });
    await trips.update(trip);

    const settled = await settleVanTrip(
      { tripId: "trip1", countedCash: Money.fromMajor("731.60"), stockCounts: [] },
      { trips },
    );

    expect(settled.settlement?.expectedCash.equals(Money.fromMajor("700"))).toBe(true);
    expect(settled.settlement?.cashVariance.equals(Money.fromMajor("31.60"))).toBe(true);
  });

  it("computes per-item stock variance, including a full-shortage line for an uncounted item", async () => {
    const trips = createInMemoryVanTripRepository();
    const trip = await openBasicTrip(trips);

    const settled = await settleVanTrip(
      {
        tripId: "trip1",
        countedCash: Money.fromMajor("500"),
        stockCounts: [{ itemId: "item1", countedQty: Qty.fromMajor("8") }],
      },
      { trips },
    );

    const counts = settled.settlement?.stockCounts ?? [];
    const item1 = counts.find((c) => c.itemId === "item1");
    const item2 = counts.find((c) => c.itemId === "item2");

    expect(item1?.expectedQty.equals(Qty.fromMajor("10"))).toBe(true);
    expect(item1?.countedQty.equals(Qty.fromMajor("8"))).toBe(true);
    expect(item1?.varianceQty.equals(Qty.fromMajor("-2"))).toBe(true);

    expect(item2?.expectedQty.equals(Qty.fromMajor("5"))).toBe(true);
    expect(item2?.countedQty.equals(Qty.zero())).toBe(true);
    expect(item2?.varianceQty.equals(Qty.fromMajor("-5"))).toBe(true);

    expect(trip.id).toBe("trip1");
  });

  it("throws VanTripNotOngoingError when settling an already-settled trip", async () => {
    const trips = createInMemoryVanTripRepository();
    await openBasicTrip(trips);
    await settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("500"), stockCounts: [] }, { trips });

    await expect(
      settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("500"), stockCounts: [] }, { trips }),
    ).rejects.toThrow(VanTripNotOngoingError);
  });

  it("throws VanTripNotOngoingError when settling a cancelled trip", async () => {
    const trips = createInMemoryVanTripRepository();
    const trip = await openBasicTrip(trips);
    await trips.update({ ...trip, status: "cancelled" });

    await expect(
      settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("500"), stockCounts: [] }, { trips }),
    ).rejects.toThrow(VanTripNotOngoingError);
  });

  it("throws VanTripNotOngoingError when recording a cash movement on a non-ongoing trip", async () => {
    const trips = createInMemoryVanTripRepository();
    const trip = await openBasicTrip(trips);
    const settled = { ...trip, status: "settled" as const };

    expect(() =>
      recordVanCashMovement(settled, {
        id: "cm1",
        kind: "sale",
        amount: Money.fromMajor("10"),
        occurredAt: "2026-08-01T12:00:00Z",
      }),
    ).toThrow(VanTripNotOngoingError);
  });
});
