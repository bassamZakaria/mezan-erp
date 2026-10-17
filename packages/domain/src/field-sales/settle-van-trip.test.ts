import { describe, it, expect, vi } from "vitest";
import { Money, Qty } from "../money/index.js";
import { createInMemoryVanTripRepository } from "./test-helpers/in-memory-van-trip-repository.js";
import { openVanTrip, type OpenVanTripDeps } from "./open-van-trip.js";
import { recordVanCashMovement } from "./record-van-cash-movement.js";
import { settleVanTrip } from "./settle-van-trip.js";
import { approveVanTripSettlement, type VanReconciliationPostingPort } from "./approve-van-trip.js";
import type { VanTripActivity, VanTripActivityPort } from "./van-trip-expectation.js";
import {
  InvalidVanTripCountError,
  VanBusyError,
  VanTripExpectationChangedError,
  VanTripNotOngoingError,
  VanTripRecountLockedError,
  VanTripSelfApprovalError,
} from "./errors.js";
import {
  VanReconciliationStepKind,
  VanReconciliationStepState,
  VanTripCashMovementKind,
  VanTripCrewRole,
  VanTripStatus,
} from "./van-trip.js";

type Repo = ReturnType<typeof createInMemoryVanTripRepository>;

function openDeps(trips: Repo): OpenVanTripDeps {
  return { trips, stock: { postTransfer: vi.fn().mockResolvedValue(undefined) } };
}

async function openBasicTrip(trips: Repo) {
  return openVanTrip(
    {
      id: "trip1",
      date: "2026-08-01",
      branchId: "branch1",
      vanWarehouseId: "wh-van",
      vanTreasuryAccountId: "treasury-van",
      sourceWarehouseId: "wh-main",
      sourceTreasuryAccountId: "treasury-main",
      crew: [{ employeeId: "emp1", role: VanTripCrewRole.Rep }],
      openingCashFloat: Money.fromMajor("500"),
      loadedStock: [
        { itemId: "item1", qty: Qty.fromMajor("10") },
        { itemId: "item2", qty: Qty.fromMajor("5") },
      ],
    },
    openDeps(trips),
  );
}

/** The van after selling 4 of item1 on two invoices and taking 1 back: on hand 7 and 5, till 500 + 200 + 50. */
function books(overrides: Partial<VanTripActivity> = {}): VanTripActivity {
  return {
    stock: [
      { itemId: "item1", onHand: Qty.fromMajor("7"), unitCost: Money.fromMajor("10"), loadedQty: Qty.fromMajor("10"), soldQty: Qty.fromMajor("4"), returnedQty: Qty.fromMajor("1") },
      { itemId: "item2", onHand: Qty.fromMajor("5"), unitCost: Money.fromMajor("3"), loadedQty: Qty.fromMajor("5"), soldQty: Qty.zero(), returnedQty: Qty.zero() },
    ],
    tillBalance: Money.fromMajor("750"),
    voucherCollections: Money.zero(),
    invoicedSales: Money.fromMajor("456"),
    returnsValue: Money.fromMajor("114"),
    ...overrides,
  };
}

function activityOf(read: () => VanTripActivity): VanTripActivityPort {
  return { read: async () => read() };
}

function recordingPostings(holdKinds: Set<string> = new Set()) {
  const calls: string[] = [];
  const port: VanReconciliationPostingPort = {
    recordCashVariance: async (input) => {
      calls.push(`variance:${input.variance.toString()}`);
    },
    returnCash: async (input) => {
      calls.push(`cash:${input.amount.toString()}`);
    },
    postAdjustment: async (input) => {
      calls.push(`adjust:${input.reason}:${input.direction}:${input.lines.map((l) => `${l.itemId}=${l.qty.toString()}`).join(",")}`);
      return { held: holdKinds.has(input.reason), value: Money.fromMajor("20") };
    },
    postTransfer: async (input) => {
      calls.push(`transfer:${input.fromWarehouseId}>${input.toWarehouseId}:${input.lines.map((l) => `${l.itemId}=${l.qty.toString()}`).join(",")}`);
      return { held: holdKinds.has("TRANSFER"), value: null };
    },
  };
  return { port, calls };
}

async function tripWithTakings(trips: Repo) {
  let trip = await openBasicTrip(trips);
  trip = recordVanCashMovement(trip, { id: "cm1", kind: VanTripCashMovementKind.Sale, amount: Money.fromMajor("200"), occurredAt: "2026-08-01T10:00:00Z" });
  trip = recordVanCashMovement(trip, { id: "cm2", kind: VanTripCashMovementKind.Collection, amount: Money.fromMajor("50"), occurredAt: "2026-08-01T11:00:00Z" });
  await trips.update(trip);
  return trip;
}

const counts = (item1: string, item2: string) => [
  { itemId: "item1", countedQty: Qty.fromMajor(item1) },
  { itemId: "item2", countedQty: Qty.fromMajor(item2) },
];

describe("settleVanTrip", () => {
  it("reads expected stock and cash from the books, net of the trip's sales and returns, and posts nothing", async () => {
    const trips = createInMemoryVanTripRepository();
    await tripWithTakings(trips);

    const settled = await settleVanTrip(
      { tripId: "trip1", countedCash: Money.fromMajor("740"), stockCounts: counts("5", "6"), actor: "rep-user", date: "2026-08-01" },
      { trips, activity: activityOf(() => books()) },
    );

    expect(settled.status).toBe(VanTripStatus.AwaitingApproval);
    const s = settled.settlement;
    expect(s?.expectedCash.toString()).toBe("750.000000");
    expect(s?.cashVariance.toString()).toBe("-10.000000");
    expect(s?.cashBreakdown?.fieldSales.toString()).toBe("200.000000");
    expect(s?.cashBreakdown?.other.toString()).toBe("0.000000");
    expect(s?.settledBy).toBe("rep-user");
    const item1 = s?.stockCounts.find((l) => l.itemId === "item1");
    expect(item1?.expectedQty.toString()).toBe("7.000000");
    expect(item1?.soldQty.toString()).toBe("4.000000");
    expect(item1?.returnedQty.toString()).toBe("1.000000");
    expect(item1?.otherQty.toString()).toBe("0.000000");
    expect(item1?.varianceQty.toString()).toBe("-2.000000");
    expect(item1?.varianceValue.toString()).toBe("-20.000000");
    expect(s?.stockCounts.find((l) => l.itemId === "item2")?.varianceValue.toString()).toBe("3.000000");
  });

  it("an uncounted item on the van counts as zero, and a negative count is refused", async () => {
    const trips = createInMemoryVanTripRepository();
    await tripWithTakings(trips);
    const activity = activityOf(() => books());

    const settled = await settleVanTrip(
      { tripId: "trip1", countedCash: Money.fromMajor("750"), stockCounts: [{ itemId: "item1", countedQty: Qty.fromMajor("7") }], actor: "rep", date: "2026-08-01" },
      { trips, activity },
    );
    expect(settled.settlement?.stockCounts.find((l) => l.itemId === "item2")?.varianceQty.toString()).toBe("-5.000000");

    await expect(
      settleVanTrip(
        { tripId: "trip1", countedCash: Money.fromMajor("750"), stockCounts: [{ itemId: "item1", countedQty: Qty.fromMajor("-1") }], actor: "rep", date: "2026-08-01" },
        { trips, activity },
      ),
    ).rejects.toBeInstanceOf(InvalidVanTripCountError);
  });

  it("can be counted again until approval starts posting", async () => {
    const trips = createInMemoryVanTripRepository();
    await tripWithTakings(trips);
    const activity = activityOf(() => books());
    const deps = { trips, activity };
    await settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("700"), stockCounts: counts("7", "5"), actor: "rep", date: "2026-08-01" }, deps);
    const recount = await settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("750"), stockCounts: counts("7", "5"), actor: "rep", date: "2026-08-01" }, deps);
    expect(recount.settlement?.cashVariance.toString()).toBe("0.000000");

    const { port } = recordingPostings(new Set(["TRANSFER"]));
    await approveVanTripSettlement({ tripId: "trip1", actor: "supervisor", date: "2026-08-01" }, { trips, activity, postings: port });
    await expect(
      settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("750"), stockCounts: counts("7", "5"), actor: "rep", date: "2026-08-01" }, deps),
    ).rejects.toBeInstanceOf(VanTripRecountLockedError);
  });

  it("a settled trip cannot be settled again", async () => {
    const trips = createInMemoryVanTripRepository();
    await tripWithTakings(trips);
    const activity = activityOf(() => books());
    await settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("750"), stockCounts: counts("7", "5"), actor: "rep", date: "2026-08-01" }, { trips, activity });
    await approveVanTripSettlement({ tripId: "trip1", actor: "supervisor", date: "2026-08-01" }, { trips, activity, postings: recordingPostings().port });
    await expect(
      settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("750"), stockCounts: counts("7", "5"), actor: "rep", date: "2026-08-01" }, { trips, activity }),
    ).rejects.toBeInstanceOf(VanTripNotOngoingError);
  });
});

describe("approveVanTripSettlement", () => {
  it("posts in the order that keeps every position non-negative and leaves the trip settled", async () => {
    const trips = createInMemoryVanTripRepository();
    await tripWithTakings(trips);
    const activity = activityOf(() => books());
    await settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("740"), stockCounts: counts("5", "6"), actor: "rep", date: "2026-08-01" }, { trips, activity });

    const { port, calls } = recordingPostings();
    const result = await approveVanTripSettlement({ tripId: "trip1", actor: "supervisor", date: "2026-08-02" }, { trips, activity, postings: port });

    expect(calls).toEqual([
      "variance:-10.000000",
      "cash:740.000000",
      "adjust:PHYSICAL_COUNT:IN:item2=1.000000",
      "transfer:wh-van>wh-main:item1=5.000000,item2=6.000000",
      "adjust:SHORTAGE:OUT:item1=2.000000",
    ]);
    expect(result.held).toBe(false);
    expect(result.trip.status).toBe(VanTripStatus.Settled);
    expect(result.trip.settlement?.reconciliation?.completedAt).not.toBeNull();
    expect(result.trip.settlement?.reconciliation?.steps.map((s) => s.kind)).toEqual([
      VanReconciliationStepKind.CashVariance,
      VanReconciliationStepKind.CashReturn,
      VanReconciliationStepKind.OverageAdjustment,
      VanReconciliationStepKind.StockReturn,
      VanReconciliationStepKind.ShortageAdjustment,
    ]);
  });

  it("refuses the person who entered the count", async () => {
    const trips = createInMemoryVanTripRepository();
    await tripWithTakings(trips);
    const activity = activityOf(() => books());
    await settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("750"), stockCounts: counts("7", "5"), actor: "rep", date: "2026-08-01" }, { trips, activity });
    await expect(
      approveVanTripSettlement({ tripId: "trip1", actor: "rep", date: "2026-08-01" }, { trips, activity, postings: recordingPostings().port }),
    ).rejects.toBeInstanceOf(VanTripSelfApprovalError);
  });

  it("refuses when the van's books moved since the count", async () => {
    const trips = createInMemoryVanTripRepository();
    await tripWithTakings(trips);
    let current = books();
    const activity = activityOf(() => current);
    await settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("750"), stockCounts: counts("7", "5"), actor: "rep", date: "2026-08-01" }, { trips, activity });
    current = books({ tillBalance: Money.fromMajor("800") });
    await expect(
      approveVanTripSettlement({ tripId: "trip1", actor: "supervisor", date: "2026-08-01" }, { trips, activity, postings: recordingPostings().port }),
    ).rejects.toBeInstanceOf(VanTripExpectationChangedError);
  });

  it("a transfer held by the approval gate leaves the trip awaiting, and approving again resumes without re-posting", async () => {
    const trips = createInMemoryVanTripRepository();
    await tripWithTakings(trips);
    const activity = activityOf(() => books());
    await settleVanTrip({ tripId: "trip1", countedCash: Money.fromMajor("740"), stockCounts: counts("5", "5"), actor: "rep", date: "2026-08-01" }, { trips, activity });

    const holding = recordingPostings(new Set(["TRANSFER"]));
    const first = await approveVanTripSettlement({ tripId: "trip1", actor: "supervisor", date: "2026-08-01" }, { trips, activity, postings: holding.port });
    expect(first.held).toBe(true);
    expect(first.trip.status).toBe(VanTripStatus.AwaitingApproval);
    expect(first.trip.settlement?.reconciliation?.steps.find((s) => s.kind === VanReconciliationStepKind.StockReturn)?.state).toBe(VanReconciliationStepState.Held);

    const released = recordingPostings();
    const second = await approveVanTripSettlement({ tripId: "trip1", actor: "supervisor", date: "2026-08-01" }, { trips, activity, postings: released.port });
    expect(released.calls).toEqual(["transfer:wh-van>wh-main:item1=5.000000,item2=5.000000", "adjust:SHORTAGE:OUT:item1=2.000000"]);
    expect(second.trip.status).toBe(VanTripStatus.Settled);
  });
});

describe("openVanTrip on a van with an unapproved trip", () => {
  it("is refused until the earlier trip is approved", async () => {
    const trips = createInMemoryVanTripRepository();
    await tripWithTakings(trips);
    await expect(
      openVanTrip(
        {
          id: "trip2",
          date: "2026-08-02",
          branchId: "branch1",
          vanWarehouseId: "wh-van",
          vanTreasuryAccountId: "treasury-van",
          sourceWarehouseId: "wh-main",
          sourceTreasuryAccountId: "treasury-main",
          crew: [{ employeeId: "emp1", role: VanTripCrewRole.Rep }],
        },
        openDeps(trips),
      ),
    ).rejects.toBeInstanceOf(VanBusyError);
  });
});
