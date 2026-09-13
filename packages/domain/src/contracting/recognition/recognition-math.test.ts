import { describe, expect, it } from "vitest";
import { Money, Qty } from "../../money/index.js";
import type { PostedLine } from "../../gl/ledger.js";
import type { BoqLine, VariationOrder } from "../contracts/contract.js";
import type { CostCategory } from "../cost-category.js";
import {
  computeRecognition,
  contractValueAsOf,
  costToDateOf,
  estimatedTotalCostAsOf,
  isMonthEnd,
  monthEndOf,
  previousMonthEnd,
  proportionOf,
  type RecognitionAccountIds,
  type RecognitionInput,
} from "./recognition-math.js";

const ACCOUNTS: RecognitionAccountIds = {
  wip: "1230",
  costOfRevenue: "5150",
  billings: "2165",
  contractAsset: "1170",
  contractLiability: "2175",
  onerousProvision: "2196",
  onerousLoss: "5930",
  revenue: "4100",
  plantRecovery: "5160",
};

const EXPENSES = new Set(["5150", "5155", "5160", "5930"]);

function line(
  accountId: string,
  side: "debit" | "credit",
  amount: string,
  date = "2026-05-10",
  costCategory: CostCategory | null = null,
): PostedLine {
  return {
    entryId: `JE-${accountId}-${date}-${amount}-${side}`,
    entryNo: null,
    date,
    source: "system",
    accountId,
    costCenterId: null,
    projectId: "PRJ-1",
    costCategory,
    currency: null,
    fxRate: null,
    memo: null,
    debit: side === "debit" ? Money.fromMajor(amount) : Money.zero(),
    credit: side === "credit" ? Money.fromMajor(amount) : Money.zero(),
  };
}

function input(overrides: Partial<RecognitionInput> = {}): RecognitionInput {
  return {
    periodEnd: "2026-05-31",
    recognitionPolicy: "cost_to_cost",
    estimatedTotalCost: Money.fromMajor("800000"),
    contractValue: Money.fromMajor("1000000"),
    lines: [],
    expenseAccountIds: EXPENSES,
    accounts: ACCOUNTS,
    revenueRecognisedPreviously: Money.zero(),
    billedReclassedPreviously: Money.zero(),
    ...overrides,
  };
}

describe("date helpers", () => {
  it("recognises a month end and refuses any other day", () => {
    expect(isMonthEnd("2026-05-31")).toBe(true);
    expect(isMonthEnd("2026-02-28")).toBe(true);
    expect(isMonthEnd("2024-02-29")).toBe(true);
    expect(isMonthEnd("2026-02-29")).toBe(false);
    expect(isMonthEnd("2026-05-30")).toBe(false);
    expect(isMonthEnd("not-a-date")).toBe(false);
  });

  it("walks back one month and forward to a month end", () => {
    expect(previousMonthEnd("2026-05-31")).toBe("2026-04-30");
    expect(previousMonthEnd("2026-01-31")).toBe("2025-12-31");
    expect(monthEndOf("2026-02-04")).toBe("2026-02-28");
  });
});

describe("proportionOf", () => {
  it("is exact and rounds half up to the minor unit", () => {
    expect(proportionOf(Money.fromMajor("1000000"), Money.fromMajor("200000"), Money.fromMajor("800000")).toString()).toBe(
      "250000.000000",
    );
    expect(proportionOf(Money.fromMajor("100"), Money.fromMajor("1"), Money.fromMajor("3")).toString()).toBe("33.330000");
    expect(proportionOf(Money.fromMajor("100"), Money.fromMajor("2"), Money.fromMajor("3")).toString()).toBe("66.670000");
  });

  it("is zero when there is nothing to divide by", () => {
    expect(proportionOf(Money.fromMajor("100"), Money.fromMajor("1"), Money.zero()).toString()).toBe("0.000000");
  });
});

describe("estimatedTotalCostAsOf", () => {
  const contract = {
    estimatedTotalCost: Money.fromMajor("900000"),
    budgetRevisions: [
      {
        date: "2026-06-15",
        previousValue: Money.fromMajor("800000"),
        newValue: Money.fromMajor("900000"),
        reason: "ارتفاع أسعار الحديد",
        userId: "u1",
      },
    ],
  };

  it("reads the value that stood at the period end, not today's", () => {
    expect(estimatedTotalCostAsOf(contract, "2026-05-31")!.toString()).toBe("800000.000000");
    expect(estimatedTotalCostAsOf(contract, "2026-06-30")!.toString()).toBe("900000.000000");
  });
});

describe("contractValueAsOf", () => {
  const boq: BoqLine[] = [
    {
      id: "B1",
      contractId: "C1",
      code: "1",
      descriptionAr: "الخرسانة",
      descriptionEn: null,
      unit: "m3",
      qty: Qty.fromMajor("100"),
      unitRate: Money.fromMajor("1000"),
      estimatedUnitCost: null,
      section: null,
      sortOrder: 0,
      origin: "base",
      variationOrderId: null,
      costCategory: "materials",
      theoreticalQtyPerUnit: null,
      theoreticalItemId: null,
    },
  ];
  const order: VariationOrder = {
    id: "VO-1",
    docNo: "VO-0001",
    contractId: "C1",
    date: "2026-06-01",
    titleAr: "زيادة كميات",
    reason: "منسوب التأسيس",
    requestedBy: "consultant",
    status: "approved",
    approvedAt: "2026-06-10",
    approvedBy: "u1",
    rejectedReason: null,
    createdBy: null,
    lines: [
      {
        id: "VOL-1",
        variationOrderId: "VO-1",
        kind: "change",
        boqLineId: "B1",
        newLine: null,
        qtyDelta: Qty.fromMajor("20"),
        unitRateOverride: null,
        sortOrder: 0,
      },
    ],
  };

  it("counts only the variation orders approved on or before the period end", () => {
    expect(contractValueAsOf(boq, [order], "2026-05-31").toString()).toBe("100000.000000");
    expect(contractValueAsOf(boq, [order], "2026-06-30").toString()).toBe("120000.000000");
  });

  it("ignores an order that is still a draft", () => {
    const draft: VariationOrder = { ...order, status: "draft", approvedAt: null };
    expect(contractValueAsOf(boq, [draft], "2026-12-31").toString()).toBe("100000.000000");
  });
});

describe("costToDateOf", () => {
  it("counts WIP and cost of revenue together, so a relieved month does not read as zero cost", () => {
    const lines = [
      line("1230", "debit", "200000", "2026-05-10", "materials"),
      line("1230", "credit", "200000", "2026-05-31", "materials"),
      line("5150", "debit", "200000", "2026-05-31", "materials"),
    ];
    expect(costToDateOf(lines, EXPENSES, ACCOUNTS).toString()).toBe("200000.000000");
  });

  it("excludes the foreseeable-loss charge and the internal plant recovery", () => {
    const lines = [
      line("1230", "debit", "100000"),
      line("5930", "debit", "50000"),
      line("5160", "credit", "30000"),
    ];
    expect(costToDateOf(lines, EXPENSES, ACCOUNTS).toString()).toBe("100000.000000");
  });

  it("counts a direct project expense that never passed through WIP", () => {
    expect(costToDateOf([line("5155", "debit", "12000")], EXPENSES, ACCOUNTS).toString()).toBe("12000.000000");
  });
});

describe("computeRecognition — cost to cost", () => {
  it("recognises revenue in proportion to cost incurred", () => {
    const figures = computeRecognition(input({ lines: [line("1230", "debit", "200000", "2026-05-10", "materials")] }));
    expect(figures.costToDate.toString()).toBe("200000.000000");
    expect(figures.costToComplete.toString()).toBe("600000.000000");
    expect(figures.percentComplete).toBe("25.0000");
    expect(figures.revenueToDate.toString()).toBe("250000.000000");
    expect(figures.periodRevenue.toString()).toBe("250000.000000");
  });

  it("caps the percentage at 100 once cost has overrun the estimate", () => {
    const figures = computeRecognition(input({ lines: [line("1230", "debit", "900000", "2026-05-10", "materials")] }));
    expect(figures.percentComplete).toBe("100.0000");
    expect(figures.costToComplete.toString()).toBe("0.000000");
    expect(figures.revenueToDate.toString()).toBe("1000000.000000");
  });

  it("posts a negative period revenue when the estimate has worsened since last month", () => {
    const figures = computeRecognition(
      input({
        lines: [line("1230", "debit", "200000", "2026-05-10", "materials")],
        revenueRecognisedPreviously: Money.fromMajor("300000"),
      }),
    );
    expect(figures.periodRevenue.toString()).toBe("-50000.000000");
  });

  it("reports an asset when revenue runs ahead of the billings", () => {
    const figures = computeRecognition(
      input({
        lines: [line("1230", "debit", "200000", "2026-05-10", "materials"), line("2165", "credit", "100000")],
      }),
    );
    expect(figures.billedInPeriod.toString()).toBe("100000.000000");
    expect(figures.billedToDate.toString()).toBe("100000.000000");
    expect(figures.contractAsset.toString()).toBe("150000.000000");
    expect(figures.contractLiability.toString()).toBe("0.000000");
    // 1170 would hold 250,000 − 100,000 = 150,000 after the two steps, which is
    // exactly the asset — nothing has to move to 2175.
    expect(figures.contractPositionMovement.toString()).toBe("0.000000");
  });

  it("flips to a liability when the billings run ahead of the revenue, and back again", () => {
    const overBilled = computeRecognition(
      input({
        lines: [line("1230", "debit", "200000", "2026-05-10", "materials"), line("2165", "credit", "400000")],
      }),
    );
    expect(overBilled.contractAsset.toString()).toBe("0.000000");
    expect(overBilled.contractLiability.toString()).toBe("150000.000000");
    expect(overBilled.contractPositionMovement.toString()).toBe("150000.000000");

    // Next month: the liability from last month sits in 2175, more cost has
    // been incurred and nothing new has been billed, so the position turns back
    // into an asset and the liability is released.
    const released = computeRecognition(
      input({
        periodEnd: "2026-06-30",
        lines: [
          line("1230", "debit", "600000", "2026-05-10", "materials"),
          line("2165", "credit", "400000", "2026-05-15"),
          line("1170", "debit", "250000", "2026-05-31"),
          line("4100", "credit", "250000", "2026-05-31"),
          line("2165", "debit", "400000", "2026-05-31"),
          line("1170", "credit", "400000", "2026-05-31"),
          line("1170", "debit", "150000", "2026-05-31"),
          line("2175", "credit", "150000", "2026-05-31"),
        ],
        revenueRecognisedPreviously: Money.fromMajor("250000"),
        billedReclassedPreviously: Money.fromMajor("400000"),
      }),
    );
    expect(released.revenueToDate.toString()).toBe("750000.000000");
    expect(released.billedToDate.toString()).toBe("400000.000000");
    expect(released.contractAsset.toString()).toBe("350000.000000");
    expect(released.contractPositionMovement.toString()).toBe("-150000.000000");
  });

  it("provides for the whole foreseeable loss not yet passed through P&L, and releases it when the contract recovers", () => {
    const onerous = computeRecognition(
      input({
        contractValue: Money.fromMajor("700000"),
        lines: [line("1230", "debit", "200000", "2026-05-10", "materials")],
      }),
    );
    expect(onerous.foreseeableLoss.toString()).toBe("100000.000000");
    // 100,000 × (1 − 25%) — the quarter already charged through cost is not provided for twice.
    expect(onerous.provisionRequired.toString()).toBe("75000.000000");
    expect(onerous.provisionMovement.toString()).toBe("75000.000000");

    const recovered = computeRecognition(
      input({
        periodEnd: "2026-06-30",
        contractValue: Money.fromMajor("1000000"),
        lines: [
          line("1230", "debit", "200000", "2026-05-10", "materials"),
          line("2196", "credit", "75000", "2026-05-31"),
          line("5930", "debit", "75000", "2026-05-31"),
        ],
      }),
    );
    expect(recovered.foreseeableLoss.toString()).toBe("0.000000");
    expect(recovered.provisionRequired.toString()).toBe("0.000000");
    expect(recovered.provisionMovement.toString()).toBe("-75000.000000");
  });

  it("splits the WIP relief by the category the cost was capitalised under, summing to the balance exactly", () => {
    const figures = computeRecognition(
      input({
        lines: [
          line("1230", "debit", "120000", "2026-04-10", "materials"),
          line("1230", "debit", "30000", "2026-05-12", "labour"),
          line("1230", "debit", "50000", "2026-05-20", "equipment"),
          line("1230", "credit", "5000", "2026-05-21", "materials"),
          line("1230", "debit", "7500", "2026-05-22"),
        ],
      }),
    );
    expect(figures.wipOpening.toString()).toBe("120000.000000");
    expect(figures.wipIncurred.toString()).toBe("82500.000000");
    expect(figures.wipRelieved.toString()).toBe("202500.000000");
    expect(figures.wipClosing.toString()).toBe("0.000000");
    expect(Money.sum(figures.wipByCategory.map((b) => b.amount)).toString()).toBe(figures.wipRelieved.toString());
    expect(figures.wipByCategory.map((b) => [b.costCategory, b.amount.toString()])).toEqual([
      ["materials", "115000.000000"],
      ["labour", "30000.000000"],
      ["equipment", "50000.000000"],
      [null, "7500.000000"],
    ]);
  });
});

describe("computeRecognition — certified value", () => {
  it("recognises no revenue at all and still relieves WIP", () => {
    const figures = computeRecognition(
      input({
        recognitionPolicy: "certified_value",
        lines: [line("1230", "debit", "200000", "2026-05-10", "materials"), line("2165", "credit", "100000")],
      }),
    );
    expect(figures.revenueToDate.toString()).toBe("0.000000");
    expect(figures.periodRevenue.toString()).toBe("0.000000");
    expect(figures.billedInPeriod.toString()).toBe("0.000000");
    expect(figures.contractAsset.toString()).toBe("0.000000");
    expect(figures.contractLiability.toString()).toBe("0.000000");
    expect(figures.provisionMovement.toString()).toBe("0.000000");
    expect(figures.wipRelieved.toString()).toBe("200000.000000");
    // The cost figures are still real — the workspace shows them either way.
    expect(figures.percentComplete).toBe("25.0000");
  });
});
