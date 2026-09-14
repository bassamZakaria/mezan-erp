import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import {
  DuplicateForm41FilingError,
  Form41FilingNotFoundError,
  Form41PeriodAlreadyFiledError,
  amendForm41Filing,
  assertWithholdingNotFiled,
  recordForm41Filing,
  withholdingQuarter,
  withholdingQuarterOf,
  type Form41Filing,
  type Form41FilingRepository,
} from "./form41-filing.js";

function repo(): Form41FilingRepository & { rows: Map<string, Form41Filing> } {
  const rows = new Map<string, Form41Filing>();
  return {
    rows,
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async save(filing) {
      rows.set(filing.id, filing);
    },
    async findCovering(date) {
      return [...rows.values()].filter((f) => f.periodFrom <= date && date <= f.periodTo);
    },
  };
}

describe("the statutory quarters", () => {
  it("runs Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec", () => {
    expect(withholdingQuarter(2026, 1)).toMatchObject({ periodFrom: "2026-01-01", periodTo: "2026-03-31" });
    expect(withholdingQuarter(2026, 2)).toMatchObject({ periodFrom: "2026-04-01", periodTo: "2026-06-30" });
    expect(withholdingQuarter(2026, 3)).toMatchObject({ periodFrom: "2026-07-01", periodTo: "2026-09-30" });
    expect(withholdingQuarter(2026, 4)).toMatchObject({ periodFrom: "2026-10-01", periodTo: "2026-12-31" });
  });

  it("is due within the month following the quarter's end", () => {
    expect(withholdingQuarter(2026, 1).dueDate).toBe("2026-04-30");
    expect(withholdingQuarter(2026, 2).dueDate).toBe("2026-07-31");
    expect(withholdingQuarter(2026, 3).dueDate).toBe("2026-10-31");
  });

  it("rolls the fourth quarter's due date into the NEXT year", () => {
    expect(withholdingQuarter(2026, 4).dueDate).toBe("2027-01-31");
  });

  it("places a date in its own quarter, boundaries included", () => {
    expect(withholdingQuarterOf("2026-01-01").quarter).toBe(1);
    expect(withholdingQuarterOf("2026-03-31").quarter).toBe(1);
    expect(withholdingQuarterOf("2026-04-01").quarter).toBe(2);
    expect(withholdingQuarterOf("2026-09-30").quarter).toBe(3);
    expect(withholdingQuarterOf("2026-10-01").quarter).toBe(4);
    expect(withholdingQuarterOf("2026-12-31")).toMatchObject({ year: 2026, quarter: 4 });
  });
});

describe("recordForm41Filing", () => {
  it("records the quarter, the remitted figure and the authority's reference", async () => {
    const filings = repo();
    const filing = await recordForm41Filing(
      {
        id: "f41-2026Q3",
        year: 2026,
        quarter: 3,
        remittedAmount: Money.fromMajor("12500.75"),
        referenceNo: "ETA-41-0099",
        filedBy: "u-1",
        filedAt: "2026-10-15T09:00:00.000Z",
      },
      { filings },
    );

    expect(filing).toMatchObject({
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
      status: "filed",
      referenceNo: "ETA-41-0099",
      filedBy: "u-1",
      amendedAt: null,
    });
    expect(filing.remittedAmount.toString()).toBe("12500.750000");
    expect(filings.rows.size).toBe(1);
  });

  it("refuses a second live filing for the same quarter", async () => {
    const filings = repo();
    const cmd = { id: "f41-1", year: 2026, quarter: 3 as const, remittedAmount: Money.zero() };
    await recordForm41Filing(cmd, { filings });
    await expect(recordForm41Filing({ ...cmd, id: "f41-2" }, { filings })).rejects.toBeInstanceOf(
      DuplicateForm41FilingError,
    );
  });

  it("lets a quarter be re-filed once the previous filing is amended", async () => {
    const filings = repo();
    await recordForm41Filing(
      { id: "f41-1", year: 2026, quarter: 3, remittedAmount: Money.fromMajor("100") },
      { filings },
    );
    await amendForm41Filing("f41-1", "supplier invoice restated", { filings });
    await expect(
      recordForm41Filing({ id: "f41-2", year: 2026, quarter: 3, remittedAmount: Money.fromMajor("120") }, { filings }),
    ).resolves.toMatchObject({ status: "filed" });
  });

  it("does not treat a neighbouring quarter as the same period", async () => {
    const filings = repo();
    await recordForm41Filing({ id: "f41-q3", year: 2026, quarter: 3, remittedAmount: Money.zero() }, { filings });
    await expect(
      recordForm41Filing({ id: "f41-q4", year: 2026, quarter: 4, remittedAmount: Money.zero() }, { filings }),
    ).resolves.toMatchObject({ periodFrom: "2026-10-01" });
  });
});

describe("amendForm41Filing", () => {
  it("requires a reason — an amendment with none is the silent restatement this exists to stop", async () => {
    const filings = repo();
    await recordForm41Filing({ id: "f41-1", year: 2026, quarter: 3, remittedAmount: Money.zero() }, { filings });
    await expect(amendForm41Filing("f41-1", "   ", { filings })).rejects.toThrow("سبب تعديل");
  });

  it("stamps the reason and the time, and leaves the original figure readable", async () => {
    const filings = repo();
    await recordForm41Filing(
      { id: "f41-1", year: 2026, quarter: 3, remittedAmount: Money.fromMajor("500") },
      { filings },
    );
    const amended = await amendForm41Filing("f41-1", "خطأ في نسبة الخصم", {
      filings,
      now: () => "2026-11-01T00:00:00.000Z",
    });

    expect(amended.status).toBe("amended");
    expect(amended.amendmentReason).toBe("خطأ في نسبة الخصم");
    expect(amended.amendedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(amended.remittedAmount.toString()).toBe("500.000000");
  });

  it("404s an amendment of a filing that does not exist", async () => {
    await expect(amendForm41Filing("ghost", "x", { filings: repo() })).rejects.toBeInstanceOf(
      Form41FilingNotFoundError,
    );
  });
});

describe("assertWithholdingNotFiled — the refusal to backdate into a filed quarter", () => {
  it("passes when the tenant has no filing repository configured at all", async () => {
    await expect(assertWithholdingNotFiled("2026-08-15", undefined)).resolves.toBeUndefined();
  });

  it("refuses a date inside a filed quarter", async () => {
    const filings = repo();
    await recordForm41Filing({ id: "f41-q3", year: 2026, quarter: 3, remittedAmount: Money.zero() }, { filings });

    await expect(assertWithholdingNotFiled("2026-08-15", filings)).rejects.toBeInstanceOf(
      Form41PeriodAlreadyFiledError,
    );
    const err = await assertWithholdingNotFiled("2026-08-15", filings).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toContain("نموذج 41");
    expect(err?.message).toContain("2026-08-15");
  });

  it("allows a date outside every filed quarter", async () => {
    const filings = repo();
    await recordForm41Filing({ id: "f41-q3", year: 2026, quarter: 3, remittedAmount: Money.zero() }, { filings });
    await expect(assertWithholdingNotFiled("2026-06-30", filings)).resolves.toBeUndefined();
    await expect(assertWithholdingNotFiled("2026-10-01", filings)).resolves.toBeUndefined();
  });

  it("stops refusing once the filing is amended, which is what makes the amendment a decision", async () => {
    const filings = repo();
    await recordForm41Filing({ id: "f41-q3", year: 2026, quarter: 3, remittedAmount: Money.zero() }, { filings });
    await expect(assertWithholdingNotFiled("2026-08-15", filings)).rejects.toBeInstanceOf(
      Form41PeriodAlreadyFiledError,
    );

    await amendForm41Filing("f41-q3", "correction", { filings });
    await expect(assertWithholdingNotFiled("2026-08-15", filings)).resolves.toBeUndefined();
  });

  it("matches the LIVE VAT control's shape, taking any repository that can answer findCovering", async () => {
    const structural = {
      async findCovering() {
        return [{ id: "f41-x", status: "filed" }];
      },
    };
    await expect(assertWithholdingNotFiled("2026-08-15", structural)).rejects.toBeInstanceOf(
      Form41PeriodAlreadyFiledError,
    );
  });
});
