import { describe, it, expect } from "vitest";
import { Qty } from "../money/index.js";
import { availableQty, buildStockReservations, type ReservationLine } from "./reservations.js";

function line(overrides: Partial<ReservationLine> = {}): ReservationLine {
  return { itemId: "item-1", warehouseId: "wh-1", qty: Qty.fromMajor("5"), ...overrides };
}

describe("buildStockReservations", () => {
  it("sums reserved qty per position and per item", () => {
    const reservations = buildStockReservations([
      line({ itemId: "item-1", warehouseId: "wh-1", qty: Qty.fromMajor("5") }),
      line({ itemId: "item-1", warehouseId: "wh-1", qty: Qty.fromMajor("3") }),
    ]);
    expect(reservations.forPosition("item-1", "wh-1").toString()).toBe("8.000000");
    expect(reservations.forItem("item-1").toString()).toBe("8.000000");
  });

  it("aggregates forItem across multiple warehouses, but forPosition stays per-warehouse", () => {
    const reservations = buildStockReservations([
      line({ itemId: "item-1", warehouseId: "wh-1", qty: Qty.fromMajor("5") }),
      line({ itemId: "item-1", warehouseId: "wh-2", qty: Qty.fromMajor("7") }),
    ]);
    expect(reservations.forPosition("item-1", "wh-1").toString()).toBe("5.000000");
    expect(reservations.forPosition("item-1", "wh-2").toString()).toBe("7.000000");
    expect(reservations.forItem("item-1").toString()).toBe("12.000000");
  });

  it("an unreserved position/item reports zero, not an error", () => {
    const reservations = buildStockReservations([line({ itemId: "item-1", warehouseId: "wh-1" })]);
    expect(reservations.forPosition("item-2", "wh-1").isZero()).toBe(true);
    expect(reservations.forItem("item-2").isZero()).toBe(true);
  });

  it("an empty line set reserves nothing", () => {
    const reservations = buildStockReservations([]);
    expect(reservations.forPosition("item-1", "wh-1").isZero()).toBe(true);
    expect(reservations.forItem("item-1").isZero()).toBe(true);
  });

  it("ignores a zero-quantity line", () => {
    const reservations = buildStockReservations([line({ qty: Qty.zero() })]);
    expect(reservations.forPosition("item-1", "wh-1").isZero()).toBe(true);
  });

  it("ignores a negative-quantity line rather than netting it against real reservations", () => {
    const reservations = buildStockReservations([
      line({ qty: Qty.fromMajor("5") }),
      line({ qty: Qty.fromMajor("-2") }),
    ]);
    expect(reservations.forPosition("item-1", "wh-1").toString()).toBe("5.000000");
  });
});

describe("availableQty — on-hand minus reserved, floored at zero", () => {
  it("subtracts reserved from on-hand", () => {
    expect(availableQty(Qty.fromMajor("10"), Qty.fromMajor("3")).toString()).toBe("7.000000");
  });

  it("floors at zero rather than going negative when two drafts over-reserve the same stock", () => {
    expect(availableQty(Qty.fromMajor("5"), Qty.fromMajor("8")).toString()).toBe("0.000000");
    expect(availableQty(Qty.fromMajor("5"), Qty.fromMajor("8")).isNegative()).toBe(false);
  });

  it("is exactly zero when reservations equal on-hand (the boundary)", () => {
    const available = availableQty(Qty.fromMajor("5"), Qty.fromMajor("5"));
    expect(available.isZero()).toBe(true);
  });

  it("with zero reservations, availability equals on-hand", () => {
    expect(availableQty(Qty.fromMajor("10"), Qty.zero()).toString()).toBe("10.000000");
  });

  it("with zero on-hand, availability is zero regardless of reservations", () => {
    expect(availableQty(Qty.zero(), Qty.fromMajor("3")).toString()).toBe("0.000000");
    expect(availableQty(Qty.zero(), Qty.zero()).toString()).toBe("0.000000");
  });
});

describe("availableQty recomputes from reservation lines rather than trusting a caller-supplied reserved figure", () => {
  it("reflects exactly what buildStockReservations derives from the open documents, nothing extra", () => {
    const reservations = buildStockReservations([
      line({ itemId: "item-1", warehouseId: "wh-1", qty: Qty.fromMajor("4") }),
    ]);
    const reserved = reservations.forPosition("item-1", "wh-1");
    expect(availableQty(Qty.fromMajor("10"), reserved).toString()).toBe("6.000000");
  });
});
