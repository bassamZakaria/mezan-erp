import { describe, it, expect } from "vitest";
import { Money, Qty } from "../../money/index.js";
import type { BoqLine, BoqLineAdjustment, VariationOrder } from "./contract.js";
import {
  computeApprovedVariationsValue,
  computeContractValue,
  computeContractedQuantities,
  computeVariationOrderValue,
  contractedQtyOf,
  extendBoqLine,
} from "./amounts.js";

function line(over: Partial<BoqLine> & Pick<BoqLine, "id" | "code" | "qty" | "unitRate">): BoqLine {
  return {
    contractId: "CTR-1",
    descriptionAr: "بند",
    descriptionEn: null,
    unit: "m3",
    estimatedUnitCost: null,
    section: null,
    sortOrder: 1,
    origin: "base",
    variationOrderId: null,
    costCategory: null,
    theoreticalQtyPerUnit: null,
    theoreticalItemId: null,
    ...over,
  };
}

/** The design's worked example (docs/artifacts/mezan-contracting-designs.html §04). */
const BASE: BoqLine[] = [
  line({ id: "B1", code: "1", qty: Qty.fromMajor("12000"), unitRate: Money.fromMajor("185.00") }),
  line({ id: "B2", code: "2", qty: Qty.fromMajor("1450"), unitRate: Money.fromMajor("1980.00") }),
  line({ id: "B3", code: "3", qty: Qty.fromMajor("3200"), unitRate: Money.fromMajor("3450.00") }),
  line({ id: "B4", code: "4", qty: Qty.fromMajor("9800"), unitRate: Money.fromMajor("260.00") }),
  line({ id: "B5", code: "5", qty: Qty.fromMajor("18500"), unitRate: Money.fromMajor("95.00") }),
  line({ id: "B6", code: "6", qty: Qty.fromMajor("1"), unitRate: Money.fromMajor("1895000.00") }),
];

describe("BOQ arithmetic", () => {
  it("extends a line at the minor unit, HALF_UP, without touching a float", () => {
    expect(extendBoqLine(Qty.fromMajor("12000"), Money.fromMajor("185.00")).toString()).toBe("2220000.000000");
    // 0.005 exactly — HALF_UP goes away from zero, and 0.1 + 0.2 arithmetic would not.
    expect(extendBoqLine(Qty.fromMajor("1"), Money.fromMajor("0.005")).toString()).toBe("0.010000");
    expect(extendBoqLine(Qty.fromMajor("3"), Money.fromMajor("0.1")).toString()).toBe("0.300000");
  });

  it("sums the base bill and nothing else", () => {
    expect(computeContractValue(BASE).toString()).toBe("22331500.000000");
  });

  it("counts a variation-origin line through the order, never twice", () => {
    const added = line({
      id: "V1",
      code: "7",
      qty: Qty.fromMajor("210"),
      unitRate: Money.fromMajor("46500.00"),
      origin: "variation",
      variationOrderId: "VO-1",
    });
    expect(computeContractValue([...BASE, added]).toString()).toBe("22331500.000000");
  });
});

const VO_ADD: VariationOrder = {
  id: "VO-1",
  docNo: "VO-0001",
  contractId: "CTR-1",
  date: "2026-05-28",
  titleAr: "إضافة حديد التسليح",
  reason: "تحوّل التوريد",
  requestedBy: "employer",
  status: "approved",
  approvedAt: "2026-06-10",
  approvedBy: "u2",
  rejectedReason: null,
  createdBy: "u1",
  lines: [
    {
      id: "L1",
      variationOrderId: "VO-1",
      kind: "add",
      boqLineId: null,
      newLine: {
        code: "7",
        descriptionAr: "حديد التسليح",
        descriptionEn: null,
        unit: "ton",
        qty: Qty.fromMajor("210"),
        unitRate: Money.fromMajor("46500.00"),
        estimatedUnitCost: null,
        section: null,
        costCategory: "materials",
      },
      qtyDelta: null,
      unitRateOverride: null,
      sortOrder: 1,
    },
  ],
};

const VO_CHANGE: VariationOrder = {
  ...VO_ADD,
  id: "VO-2",
  docNo: "VO-0002",
  approvedAt: "2026-08-02",
  lines: [
    {
      id: "L1",
      variationOrderId: "VO-2",
      kind: "change",
      boqLineId: "B1",
      newLine: null,
      qtyDelta: Qty.fromMajor("600"),
      unitRateOverride: null,
      sortOrder: 1,
    },
  ],
};

describe("variation-order value", () => {
  it("values an addition at its own rate", () => {
    expect(computeVariationOrderValue(VO_ADD, BASE).toString()).toBe("9765000.000000");
  });

  it("values a change at the BOQ line's rate, and an omission negative", () => {
    expect(computeVariationOrderValue(VO_CHANGE, BASE).toString()).toBe("111000.000000");
    const omission: VariationOrder = {
      ...VO_CHANGE,
      lines: [{ ...VO_CHANGE.lines[0]!, qtyDelta: Qty.fromMajor("-1200"), boqLineId: "B5" }],
    };
    expect(computeVariationOrderValue(omission, BASE).toString()).toBe("-114000.000000");
  });

  it("honours a rate override on a change line", () => {
    const overridden: VariationOrder = {
      ...VO_CHANGE,
      lines: [{ ...VO_CHANGE.lines[0]!, unitRateOverride: Money.fromMajor("200.00") }],
    };
    expect(computeVariationOrderValue(overridden, BASE).toString()).toBe("120000.000000");
  });

  it("ignores a DRAFT order when totalling approved variations", () => {
    const draft: VariationOrder = { ...VO_CHANGE, id: "VO-3", docNo: "VO-0003", status: "draft", approvedAt: null };
    expect(computeApprovedVariationsValue([VO_ADD, VO_CHANGE, draft], BASE).toString()).toBe("9876000.000000");
    expect(computeContractValue(BASE).add(computeApprovedVariationsValue([VO_ADD, VO_CHANGE, draft], BASE)).toString()).toBe(
      "32207500.000000",
    );
  });
});

describe("contracted quantity as of a date (D-08, forward only)", () => {
  const added = line({
    id: "V1",
    code: "7",
    qty: Qty.fromMajor("210"),
    unitRate: Money.fromMajor("46500.00"),
    origin: "variation",
    variationOrderId: "VO-1",
  });
  const adjustment: BoqLineAdjustment = {
    id: "ADJ-1",
    contractId: "CTR-1",
    boqLineId: "B1",
    variationOrderId: "VO-2",
    qtyDelta: Qty.fromMajor("600"),
    unitRateOverride: null,
    approvedAt: "2026-08-02",
  };
  const input = {
    lines: [...BASE, added],
    adjustments: [adjustment],
    variationApprovals: new Map([
      ["VO-1", "2026-06-10"],
      ["VO-2", "2026-08-02"],
    ]),
  };

  it("excludes an adjustment approved AFTER the measurement date", () => {
    expect(contractedQtyOf(input, "B1", "2026-07-01").toString()).toBe("12000.000000");
  });

  it("includes it on and after its approval date", () => {
    expect(contractedQtyOf(input, "B1", "2026-08-02").toString()).toBe("12600.000000");
    expect(contractedQtyOf(input, "B1", null).toString()).toBe("12600.000000");
  });

  it("gives a variation-added line zero quantity before its order was approved", () => {
    expect(contractedQtyOf(input, "V1", "2026-06-09").toString()).toBe("0.000000");
    expect(contractedQtyOf(input, "V1", "2026-06-10").toString()).toBe("210.000000");
  });

  it("reports base, adjustment and contracted separately per line", () => {
    const rows = computeContractedQuantities(input, "2026-12-31");
    const first = rows.find((r) => r.boqLineId === "B1");
    expect(first?.baseQty.toString()).toBe("12000.000000");
    expect(first?.adjustmentQty.toString()).toBe("600.000000");
    expect(first?.contractedQty.toString()).toBe("12600.000000");
  });
});
