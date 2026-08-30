import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import type { VanTrip, VanTripStatus } from "./van-trip.js";
import { VanTripNotOngoingError } from "./errors.js";
import { recordVanCashMovement } from "./record-van-cash-movement.js";

function trip(overrides: Partial<VanTrip> = {}): VanTrip {
  return {
    id: "trip-1",
    tripNo: "VT-0001",
    date: "2026-03-01",
    branchId: "br-1",
    vanId: "van-1",
    vanWarehouseId: "wh-van",
    vanTreasuryAccountId: "tr-van",
    sourceWarehouseId: "wh-main",
    sourceTreasuryAccountId: "tr-main",
    openingCashFloat: Money.fromMajor("500"),
    crew: [{ employeeId: "emp-1", role: "rep" }],
    loadedStock: [],
    cashMovements: [],
    status: "ongoing",
    openedAt: "2026-03-01T07:00:00.000Z",
    settledAt: null,
    settlement: null,
    notes: null,
    ...overrides,
  };
}

const sale = {
  id: "mv-1",
  kind: "sale" as const,
  amount: Money.fromMajor("1250.50"),
  occurredAt: "2026-03-01T09:30:00.000Z",
};

describe("recordVanCashMovement", () => {
  it("appends the movement with its exact amount", () => {
    const next = recordVanCashMovement(trip(), sale);
    expect(next.cashMovements).toHaveLength(1);
    expect(next.cashMovements[0]).toMatchObject({ id: "mv-1", kind: "sale", occurredAt: sale.occurredAt });
    expect(next.cashMovements[0]?.amount.toString()).toBe("1250.500000");
  });

  it("records a collection as well as a sale, because they settle the same cash", () => {
    const withSale = recordVanCashMovement(trip(), sale);
    const withCollection = recordVanCashMovement(withSale, {
      id: "mv-2",
      kind: "collection",
      amount: Money.fromMajor("300"),
      occurredAt: "2026-03-01T11:00:00.000Z",
    });
    expect(withCollection.cashMovements.map((m) => m.kind)).toEqual(["sale", "collection"]);
  });

  it("keeps the movements in the order they happened, which is how the settlement reads them", () => {
    let current = trip();
    for (const [index, amount] of ["100", "200", "300"].entries()) {
      current = recordVanCashMovement(current, {
        id: `mv-${index}`,
        kind: "sale",
        amount: Money.fromMajor(amount),
        occurredAt: `2026-03-01T0${index + 8}:00:00.000Z`,
      });
    }
    expect(current.cashMovements.map((m) => m.amount.toString())).toEqual([
      "100.000000",
      "200.000000",
      "300.000000",
    ]);
  });

  it("adds up to what the van should be holding, float included", () => {
    let current = trip();
    for (const [index, amount] of ["1250.50", "300.25"].entries()) {
      current = recordVanCashMovement(current, {
        id: `mv-${index}`,
        kind: "sale",
        amount: Money.fromMajor(amount),
        occurredAt: "2026-03-01T09:00:00.000Z",
      });
    }
    const collected = Money.sum(current.cashMovements.map((m) => m.amount));
    expect(collected.toString()).toBe("1550.750000");
    expect(collected.add(current.openingCashFloat).toString()).toBe("2050.750000");
  });

  it("keeps a note when one is given, and stores null rather than undefined when none is", () => {
    expect(recordVanCashMovement(trip(), { ...sale, notes: "دفعة نقدية" }).cashMovements[0]?.notes).toBe(
      "دفعة نقدية",
    );
    expect(recordVanCashMovement(trip(), sale).cashMovements[0]?.notes).toBeNull();
  });

  it("never mutates the trip it was handed", () => {
    const original = trip();
    const before = JSON.stringify(original.cashMovements);
    recordVanCashMovement(original, sale);
    expect(JSON.stringify(original.cashMovements)).toBe(before);
    expect(original.cashMovements).toHaveLength(0);
  });

  it("changes nothing about the trip but its movements", () => {
    const original = trip();
    const next = recordVanCashMovement(original, sale);
    expect({ ...next, cashMovements: original.cashMovements }).toEqual(original);
  });

  it("refuses to record against a trip that is not ongoing", () => {
    for (const status of ["settled", "cancelled"] as VanTripStatus[]) {
      expect(() => recordVanCashMovement(trip({ status }), sale)).toThrow(VanTripNotOngoingError);
    }
  });

  it("names the trip and its status in the refusal, so the screen can say why", () => {
    try {
      recordVanCashMovement(trip({ status: "settled" }), sale);
      throw new Error("expected the movement to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(VanTripNotOngoingError);
      expect((error as VanTripNotOngoingError).message).toContain("trip-1");
    }
  });

  it("records a zero-amount movement rather than silently dropping it", () => {
    const next = recordVanCashMovement(trip(), { ...sale, amount: Money.zero() });
    expect(next.cashMovements).toHaveLength(1);
    expect(next.cashMovements[0]?.amount.scaled).toBe(0n);
  });
});
