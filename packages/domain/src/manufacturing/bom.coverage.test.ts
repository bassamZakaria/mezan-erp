import { describe, it, expect } from "vitest";
import { Qty } from "../money/index.js";
import {
  createBom,
  createBomVersion,
  deactivateBom,
  grossUpForWaste,
  wasteAllowanceOf,
} from "./bom.js";
import {
  BomNotFoundError,
  DuplicateManufacturingDocumentError,
  InvalidManufacturingDocumentError,
} from "./errors.js";
import { InMemoryBoms, makeNumbering } from "./test-helpers.js";

function deps() {
  return { boms: new InMemoryBoms(), numbering: makeNumbering(), now: () => "2026-08-22T00:00:00.000Z" };
}

const line = (itemId: string, qty: string, wastePercent = 0) => ({
  itemId,
  qty: Qty.fromMajor(qty),
  wastePercent,
});

describe("BOM waste gross-up — both rounding directions", () => {
  it("rounds the grossed-up quantity DOWN when the remainder is under half the divisor", () => {
    expect(grossUpForWaste(Qty.fromMajor("0.000001"), 1).toString()).toBe("0.000001");
  });

  it("rounds the grossed-up quantity UP when the remainder is at or over half the divisor", () => {
    expect(grossUpForWaste(Qty.fromMajor("0.333333"), 33).toString()).toBe("0.443333");
  });
});

describe("waste allowance — the inverse of gross-up, both rounding directions", () => {
  it("returns zero for a line with no waste allowance at all", () => {
    expect(wasteAllowanceOf(Qty.fromMajor("10"), 0).toString()).toBe("0.000000");
  });

  it("returns zero for a negative waste percent rather than an inverted allowance", () => {
    expect(wasteAllowanceOf(Qty.fromMajor("10"), -5).toString()).toBe("0.000000");
  });

  it("rounds the recovered allowance DOWN when the remainder is under half the divisor", () => {
    expect(wasteAllowanceOf(Qty.fromMajor("1"), 33).toString()).toBe("0.248120");
  });

  it("rounds the recovered allowance UP when the remainder is at or over half the divisor", () => {
    expect(wasteAllowanceOf(Qty.fromMajor("1"), 1).toString()).toBe("0.009901");
  });
});

describe("BOM validation — each reason fires on its own", () => {
  it("refuses a blank product id", async () => {
    await expect(
      createBom({ id: "b1", productItemId: "  ", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "1")] }, deps()),
    ).rejects.toThrow(InvalidManufacturingDocumentError);
  });

  it("refuses a zero standard batch quantity", async () => {
    await expect(
      createBom({ id: "b1", productItemId: "P1", standardQty: Qty.zero(), unit: "PCS", lines: [line("m1", "1")] }, deps()),
    ).rejects.toThrow(/standard batch quantity must be positive/);
  });

  it("refuses a negative standard batch quantity", async () => {
    await expect(
      createBom({ id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("-1"), unit: "PCS", lines: [line("m1", "1")] }, deps()),
    ).rejects.toThrow(/standard batch quantity must be positive/);
  });

  it("refuses a line with a blank item id", async () => {
    await expect(
      createBom(
        { id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [{ itemId: " ", qty: Qty.fromMajor("1") }] },
        deps(),
      ),
    ).rejects.toThrow(/an item is required/);
  });

  it("refuses a line with a zero quantity", async () => {
    await expect(
      createBom({ id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "0")] }, deps()),
    ).rejects.toThrow(/qty must be positive/);
  });

  it("refuses a line with a negative quantity", async () => {
    await expect(
      createBom({ id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "-2")] }, deps()),
    ).rejects.toThrow(/qty must be positive/);
  });

  it("refuses a line with a negative waste percent", async () => {
    await expect(
      createBom({ id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "1", -5)] }, deps()),
    ).rejects.toThrow(/waste % must not be negative/);
  });

  it("refuses to create a second BOM against an id already in use", async () => {
    const d = deps();
    await createBom({ id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "1")] }, d);
    await expect(
      createBom({ id: "b1", productItemId: "P2", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "1")] }, d),
    ).rejects.toBeInstanceOf(DuplicateManufacturingDocumentError);
  });
});

describe("createBomVersion — explicit lines override the cloned source", () => {
  it("uses the caller's own line list instead of cloning the source BOM's", async () => {
    const d = deps();
    await createBom(
      { id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "2", 10)] },
      d,
    );
    const v2 = await createBomVersion(
      { id: "b2", sourceBomId: "b1", lines: [line("m9", "7")] },
      d,
    );
    expect(v2.lines).toHaveLength(1);
    expect(v2.lines[0]?.itemId).toBe("m9");
    expect(v2.lines[0]?.qty.toString()).toBe("7.000000");
  });
});

describe("deactivateBom refuses a missing BOM", () => {
  it("throws BomNotFoundError rather than deactivating nothing", async () => {
    await expect(deactivateBom("nope", deps())).rejects.toBeInstanceOf(BomNotFoundError);
  });
});

describe("createdAt falls back to the wall clock when no `now` is supplied", () => {
  it("stamps a real ISO timestamp instead of throwing", async () => {
    const d = { boms: new InMemoryBoms(), numbering: makeNumbering() };
    const bom = await createBom(
      { id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "1")] },
      d,
    );
    expect(() => new Date(bom.createdAt).toISOString()).not.toThrow();
    expect(bom.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
