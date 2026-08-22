import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  createBom,
  createBomVersion,
  deactivateBom,
  bomCostEstimate,
  bomLineEffectiveQty,
  grossUpForWaste,
} from "./bom.js";
import { BomNotFoundError, InvalidManufacturingDocumentError } from "./errors.js";
import { InMemoryBoms, makeNumbering } from "./test-helpers.js";

function deps() {
  return { boms: new InMemoryBoms(), numbering: makeNumbering(), now: () => "2026-08-22T00:00:00.000Z" };
}

const line = (itemId: string, qty: string, wastePercent = 0) => ({
  itemId,
  qty: Qty.fromMajor(qty),
  wastePercent,
});

describe("BOM waste gross-up", () => {
  it("grosses a required quantity up for expected loss", () => {
    expect(grossUpForWaste(Qty.fromMajor("10"), 0).toString()).toBe("10.000000");
    expect(grossUpForWaste(Qty.fromMajor("10"), 10).toString()).toBe("11.000000");
    expect(bomLineEffectiveQty({ qty: Qty.fromMajor("1"), wastePercent: 5 }).toString()).toBe(
      "1.050000",
    );
  });
});

describe("BOM versioning", () => {
  it("assigns version 1 to a new product's first BOM", async () => {
    const d = deps();
    const bom = await createBom(
      { id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "2")] },
      d,
    );
    expect(bom.version).toBe(1);
    expect(bom.number).toBe("BOM-0001");
    expect(bom.status).toBe("active");
  });

  it("supersedes the prior active version when a new BOM is created for the same product", async () => {
    const d = deps();
    const v1 = await createBom(
      { id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "2")] },
      d,
    );
    const v2 = await createBom(
      { id: "b2", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "3")] },
      d,
    );
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("active");
    // prior version is superseded (نشط → غير نشط), never mutated in place.
    expect((await d.boms.findById(v1.id))?.status).toBe("inactive");
    // a different product keeps its own version line.
    const other = await createBom(
      { id: "b3", productItemId: "P2", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "1")] },
      d,
    );
    expect(other.version).toBe(1);
  });

  it("clones lines into a superseding new version via createBomVersion", async () => {
    const d = deps();
    await createBom(
      {
        id: "b1",
        productItemId: "P1",
        standardQty: Qty.fromMajor("1"),
        unit: "PCS",
        laborCost: Money.fromMajor("3"),
        lines: [line("m1", "2", 10), line("m2", "1")],
      },
      d,
    );
    const v2 = await createBomVersion({ id: "b2", sourceBomId: "b1", versionNotes: "خامة أرخص" }, d);
    expect(v2.version).toBe(2);
    expect(v2.lines).toHaveLength(2);
    expect(v2.laborCost.toString()).toBe("3.000000");
    expect(v2.lines[0]?.wastePercent).toBe(10);
    expect((await d.boms.findById("b1"))?.status).toBe("inactive");
  });

  it("throws for a missing source BOM", async () => {
    await expect(createBomVersion({ id: "bX", sourceBomId: "nope" }, deps())).rejects.toBeInstanceOf(
      BomNotFoundError,
    );
  });

  it("rejects an empty BOM", async () => {
    await expect(
      createBom({ id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [] }, deps()),
    ).rejects.toBeInstanceOf(InvalidManufacturingDocumentError);
  });

  it("deactivates a BOM (idempotent)", async () => {
    const d = deps();
    await createBom(
      { id: "b1", productItemId: "P1", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [line("m1", "2")] },
      d,
    );
    const off = await deactivateBom("b1", d);
    expect(off.status).toBe("inactive");
    expect((await deactivateBom("b1", d)).status).toBe("inactive");
  });
});

describe("BOM cost estimate", () => {
  it("sums material (post-waste) + labour + overhead and derives per-unit cost", async () => {
    const d = deps();
    const bom = await createBom(
      {
        id: "b1",
        productItemId: "P1",
        standardQty: Qty.fromMajor("1"),
        unit: "PCS",
        laborCost: Money.fromMajor("3"),
        overheadCost: Money.fromMajor("2"),
        lines: [line("m1", "2"), line("m2", "1", 10)],
      },
      d,
    );
    const cost: Record<string, Money> = { m1: Money.fromMajor("10"), m2: Money.fromMajor("5") };
    const est = bomCostEstimate(bom, (id) => cost[id] ?? Money.zero());
    // m1: 2 × 10 = 20 ; m2: 1.1 × 5 = 5.5 ; material = 25.5
    expect(est.materialCost.toString()).toBe("25.500000");
    expect(est.totalCost.toString()).toBe("30.500000");
    expect(est.unitCost.toString()).toBe("30.500000");
  });
});
