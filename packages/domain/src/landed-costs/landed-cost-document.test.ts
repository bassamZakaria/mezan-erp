import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { createLandedCostDocumentType, type LandedCostLine, type LandedCostGlAccounts } from "./landed-cost-document.js";
import { InvalidDocumentError } from "../documents/errors.js";
import type { FrameworkDocument } from "../documents/document.js";

const ACCOUNTS: LandedCostGlAccounts = {
  inventoryAccountId: "1300-inventory",
  accruedLandedCostPayableId: "2160-accrued-landed-cost",
};

function costLine(overrides: Partial<LandedCostLine> = {}): LandedCostLine {
  return {
    itemId: "ITEM-A",
    warehouseId: "WH1",
    sourceInvoiceId: "PI1",
    sourceInvoiceNumber: "PI-000002",
    qty: Qty.fromMajor("10"),
    unitCost: Money.fromMajor("50"),
    weight: Qty.fromMajor("0"),
    allocatedAmount: Money.fromMajor("100"),
    newUnitCost: Money.fromMajor("60"),
    costItems: [{ costType: "SHIPPING", description: "شحن بحري", amount: Money.fromMajor("100") }],
    distributionMethod: "BY_VALUE",
    ...overrides,
  };
}

function doc(overrides: Partial<FrameworkDocument<LandedCostLine>> = {}): FrameworkDocument<LandedCostLine> {
  return {
    id: "LC1",
    docType: "LANDED_COST",
    docNo: "LC-000001",
    date: "2026-08-25",
    memo: "",
    status: "draft",
    lines: [costLine()],
    createdAt: "2026-08-25T00:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

describe("createLandedCostDocumentType — declaration", () => {
  it("declares the expected code, numbering, workflow gate and no stock plan", () => {
    const type = createLandedCostDocumentType(ACCOUNTS);
    expect(type.code).toBe("LANDED_COST");
    expect(type.numberingSequence).toBe("LANDED_COST");
    expect(type.gateActionType).toBe("PURCHASE_LANDED_COST_CONFIRM");
    expect(type.confirmedStatus).toBe("confirmed");
    expect(type.buildStockPlan).toBeUndefined();
  });
});

describe("validate", () => {
  const type = createLandedCostDocumentType(ACCOUNTS);

  it("passes for a well-formed document", () => {
    expect(() => type.validate?.(doc())).not.toThrow();
  });

  it("rejects a document with no lines", () => {
    expect(() => type.validate?.(doc({ lines: [] }))).toThrow(InvalidDocumentError);
  });

  it("rejects a line whose allocated amount is zero", () => {
    expect(() => type.validate?.(doc({ lines: [costLine({ allocatedAmount: Money.zero() })] }))).toThrow(
      InvalidDocumentError,
    );
  });

  it("rejects a line whose allocated amount is negative", () => {
    expect(() => type.validate?.(doc({ lines: [costLine({ allocatedAmount: Money.fromMajor("-1") })] }))).toThrow(
      InvalidDocumentError,
    );
  });

  it("rejects a line costCategory when the document carries no projectId", () => {
    expect(() => type.validate?.(doc({ lines: [costLine({ costCategory: "materials" })] }))).toThrow(
      InvalidDocumentError,
    );
  });
});

describe("buildGlPosting — inventory rises against the accrual, both sides balance", () => {
  const type = createLandedCostDocumentType(ACCOUNTS);

  it("Dr Inventory / Cr Accrued landed cost, equal to the sum of allocated amounts", () => {
    const lines = [
      costLine({ itemId: "A", allocatedAmount: Money.fromMajor("60") }),
      costLine({ itemId: "B", allocatedAmount: Money.fromMajor("40") }),
    ];
    const posting = type.buildGlPosting?.(doc({ lines }));
    expect(posting).not.toBeNull();
    expect(posting?.lines).toEqual([
      { accountId: "1300-inventory", debit: expect.anything(), credit: Money.zero(), projectId: null, branchId: null },
      { accountId: "2160-accrued-landed-cost", debit: Money.zero(), credit: expect.anything(), projectId: null, branchId: null },
    ]);
    const debit = posting?.lines[0]?.debit as Money;
    const credit = posting?.lines[1]?.credit as Money;
    expect(debit.toString()).toBe("100.000000");
    expect(debit.equals(credit)).toBe(true);
  });

  it("returns null when the total allocated is zero (nothing to post)", () => {
    // Cannot reach this via a validated document (validate rejects zero-amount lines),
    // but buildGlPosting itself must still refuse to emit a degenerate zero/zero entry.
    const posting = type.buildGlPosting?.(doc({ lines: [] }));
    expect(posting).toBeNull();
  });

  it("carries the header projectId on every line and defaults costCategory to materials on the inventory debit", () => {
    const posting = type.buildGlPosting?.(doc({ lines: [costLine({ projectId: "proj-1" })] }));
    expect(posting?.lines.every((l) => l.projectId === "proj-1")).toBe(true);
    const inv = posting?.lines.find((l) => l.accountId === "1300-inventory");
    const accrual = posting?.lines.find((l) => l.accountId === "2160-accrued-landed-cost");
    expect(inv?.costCategory).toBe("materials");
    expect(accrual?.costCategory).toBeUndefined();
  });

  it("uses the document's own memo when supplied, else a generated Arabic one naming the doc number", () => {
    const withMemo = type.buildGlPosting?.(doc({ memo: "تكلفة شحن دفعة أغسطس" }));
    expect(withMemo?.memo).toBe("تكلفة شحن دفعة أغسطس");
    const withoutMemo = type.buildGlPosting?.(doc({ memo: "" }));
    expect(withoutMemo?.memo).toBe("تكلفة إضافية LC-000001");
  });
});

describe("describeEffects", () => {
  const type = createLandedCostDocumentType(ACCOUNTS);

  it("describes the BY_VALUE distribution in Arabic with the correct item count and total", () => {
    const lines = [
      costLine({ itemId: "A", allocatedAmount: Money.fromMajor("60"), distributionMethod: "BY_VALUE" }),
      costLine({ itemId: "B", allocatedAmount: Money.fromMajor("40"), distributionMethod: "BY_VALUE" }),
    ];
    const effects = type.describeEffects?.(doc({ lines }));
    expect(effects?.blocked).toBe(false);
    const stockEffect = effects?.effects.find((e) => e.kind === "stock");
    expect(stockEffect?.description).toContain("2 صنف");
    expect(stockEffect?.detail).toContain("حسب القيمة");
    expect(stockEffect?.detail).toContain("100.000000");
  });

  it("describes the BY_QUANTITY distribution with its own Arabic label", () => {
    const effects = type.describeEffects?.(doc({ lines: [costLine({ distributionMethod: "BY_QUANTITY" })] }));
    const stockEffect = effects?.effects.find((e) => e.kind === "stock");
    expect(stockEffect?.detail).toContain("حسب الكمية");
  });

  it("blocks confirming and states the reason when there are no lines", () => {
    const effects = type.describeEffects?.(doc({ lines: [] }));
    expect(effects?.blocked).toBe(true);
    expect(effects?.blockedReason).toBe("لا يوجد بنود لتوزيع التكلفة عليها.");
  });
});

describe("createLandedCostDocumentType — the branch the posting lands in (D111)", () => {
  const type = createLandedCostDocumentType(ACCOUNTS);
  const branchesOf = (lines: LandedCostLine[]) => type.buildGlPosting?.(doc({ lines }))?.lines.map((l) => l.branchId ?? null);

  it("posts in the branch every target line's warehouse belongs to, even across several warehouses of it", () => {
    expect(branchesOf([costLine({ branchId: "BR-ALEX" }), costLine({ warehouseId: "WH2", branchId: "BR-ALEX" })])).toEqual(["BR-ALEX", "BR-ALEX"]);
  });

  it("stays unattributed only when the targets genuinely span branches", () => {
    expect(branchesOf([costLine({ branchId: "BR-ALEX" }), costLine({ warehouseId: "WH2", branchId: "BR-MAIN" })])).toEqual([null, null]);
  });

  it("stays unattributed for a line stamped before the dimension existed", () => {
    expect(branchesOf([costLine()])).toEqual([null, null]);
  });
});
