import { describe, it, expect } from "vitest";
import {
  journalEntrySourceSchema,
  journalEntryStatusSchema,
  glJournalLineSchema,
  recordVatFilingSchema,
  amendVatFilingSchema,
  closeFiscalYearSchema,
  yearEndClosePreviewLineSchema,
  yearEndClosePreviewSchema,
  closeFiscalYearResultSchema,
  createGlJournalEntrySchema,
  reverseGlJournalEntrySchema,
  journalSourceModuleSchema,
  glJournalListQuerySchema,
  partyCurrencyBalanceSchema,
  currencyBalanceGroupSchema,
  partyCurrencyBalanceReportSchema,
} from "./gl.js";

describe("glJournalLineSchema", () => {
  const line = {
    accountId: "acc-1",
    debit: "1000.123456",
    credit: "0",
    memo: "opening",
    costCenterId: "cc-1",
    currency: "USD",
    fxRate: "49.500000",
    taxRatePercent: 14,
  };

  it("accepts a full line and preserves every field verbatim, including cost centre and FX dimensions", () => {
    const result = glJournalLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("accepts a minimal line with every dimension omitted", () => {
    const result = glJournalLineSchema.safeParse({ accountId: "acc-1", debit: "1000.000000", credit: "0" });
    expect(result.success).toBe(true);
  });

  it("never coerces debit to a float — high-precision decimal string survives verbatim", () => {
    const result = glJournalLineSchema.safeParse({ ...line, debit: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.debit).toBe("0.100001");
  });

  it("rejects debit sent as a JS number instead of a string", () => {
    const result = glJournalLineSchema.safeParse({ ...line, debit: 1000 });
    expect(result.success).toBe(false);
  });

  it("never coerces fxRate to a float — high-precision decimal string survives verbatim", () => {
    const result = glJournalLineSchema.safeParse({ ...line, fxRate: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.fxRate).toBe("0.100001");
  });

  it("rejects fxRate sent as a JS number instead of a string", () => {
    const result = glJournalLineSchema.safeParse({ ...line, fxRate: 49.5 });
    expect(result.success).toBe(false);
  });
});

describe("recordVatFilingSchema", () => {
  const filing = { id: "vf-1", periodFrom: "2026-08-01", periodTo: "2026-08-31", netAmount: "5000.123456" };

  it("accepts a minimal valid payload with the optional reference omitted", () => {
    const result = recordVatFilingSchema.safeParse(filing);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(filing);
  });

  it("rejects a non-ISO periodFrom", () => {
    const result = recordVatFilingSchema.safeParse({ ...filing, periodFrom: "01/08/2026" });
    expect(result.success).toBe(false);
  });

  it("rejects netAmount sent as a JS number instead of a string", () => {
    const result = recordVatFilingSchema.safeParse({ ...filing, netAmount: 5000.12 });
    expect(result.success).toBe(false);
  });
});

describe("amendVatFilingSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = amendVatFilingSchema.safeParse({ reason: "correction after audit" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty reason with the Arabic message", () => {
    const result = amendVatFilingSchema.safeParse({ reason: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.reason?.[0]).toContain("سبب تعديل الإقرار مطلوب");
  });
});

describe("closeFiscalYearSchema", () => {
  const close = { year: 2026, retainedEarningsAccountId: "acc-re" };

  it("accepts a minimal valid payload with memo omitted", () => {
    const result = closeFiscalYearSchema.safeParse(close);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(close);
  });

  it("rejects a year outside 1900-9999", () => {
    expect(closeFiscalYearSchema.safeParse({ ...close, year: 1899 }).success).toBe(false);
    expect(closeFiscalYearSchema.safeParse({ ...close, year: 10000 }).success).toBe(false);
  });

  it("rejects a payload missing retainedEarningsAccountId", () => {
    const { retainedEarningsAccountId, ...rest } = close;
    const result = closeFiscalYearSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("retainedEarningsAccountId");
  });
});

describe("createGlJournalEntrySchema", () => {
  const entry = {
    id: "je-1",
    date: "2026-08-30",
    memo: "opening balances",
    lines: [
      { accountId: "acc-1", debit: "1000.000000", credit: "0" },
      { accountId: "acc-2", debit: "0", credit: "1000.000000" },
    ],
  };

  it("accepts a minimal valid entry with source omitted", () => {
    const result = createGlJournalEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(entry);
  });

  it("rejects an entry with fewer than two lines", () => {
    const result = createGlJournalEntrySchema.safeParse({ ...entry, lines: [entry.lines[0]] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });

  it("rejects an out-of-enum source when supplied", () => {
    const result = createGlJournalEntrySchema.safeParse({ ...entry, source: "auto" });
    expect(result.success).toBe(false);
  });

  it("preserves a line's cost centre, currency, fxRate and tax rate through the full entry", () => {
    const withDims = {
      ...entry,
      lines: [
        { accountId: "acc-1", debit: "1000.000000", credit: "0", costCenterId: "cc-1", currency: "USD", fxRate: "49.500000", taxRatePercent: 14 },
        { accountId: "acc-2", debit: "0", credit: "1000.000000" },
      ],
    };
    const result = createGlJournalEntrySchema.safeParse(withDims);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lines[0]).toEqual(withDims.lines[0]);
  });
});

describe("reverseGlJournalEntrySchema", () => {
  it("accepts an empty payload — the server can generate everything", () => {
    const result = reverseGlJournalEntrySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("preserves an explicit reversalId, date and memo", () => {
    const payload = { reversalId: "je-2", date: "2026-08-31", memo: "reversal" };
    const result = reverseGlJournalEntrySchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });
});

describe("journalSourceModuleSchema", () => {
  it("accepts each known module", () => {
    for (const m of ["sales", "purchases", "inventory", "treasury", "manufacturing", "payroll", "assets", "contracting", "manual", "unknown"]) {
      expect(journalSourceModuleSchema.safeParse(m).success).toBe(true);
    }
  });

  it("rejects a module outside the enum", () => {
    expect(journalSourceModuleSchema.safeParse("crm").success).toBe(false);
  });
});

describe("glJournalListQuerySchema", () => {
  it("accepts an empty query — every field is optional", () => {
    const result = glJournalListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum sourceModule filter", () => {
    const result = glJournalListQuerySchema.safeParse({ sourceModule: "crm" });
    expect(result.success).toBe(false);
  });
});

describe("yearEndClosePreviewLineSchema", () => {
  const line = { accountId: "acc-1", accountCode: "4000", accountNameAr: "الإيرادات", accountType: "revenue" as const, debit: "0", credit: "100000.000000" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = yearEndClosePreviewLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects an accountType outside revenue/expense", () => {
    const result = yearEndClosePreviewLineSchema.safeParse({ ...line, accountType: "asset" });
    expect(result.success).toBe(false);
  });
});

describe("yearEndClosePreviewSchema", () => {
  const preview = {
    year: 2026,
    entryId: "je-close-1",
    date: "2026-12-31",
    netResult: "60000.000000",
    revenueClosed: "100000.000000",
    expensesClosed: "40000.000000",
    lines: [],
  };

  it("accepts a minimal valid preview and preserves every field verbatim", () => {
    const result = yearEndClosePreviewSchema.safeParse(preview);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(preview);
  });

  it("rejects a preview missing netResult", () => {
    const { netResult, ...rest } = preview;
    const result = yearEndClosePreviewSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("netResult");
  });
});

describe("closeFiscalYearResultSchema", () => {
  const result = { journalEntryId: "je-close-1", year: 2026, netResult: "60000.000000", revenueClosed: "100000.000000", expensesClosed: "40000.000000", accountsClosed: 12 };

  it("accepts a minimal valid result and preserves every field verbatim", () => {
    const parsed = closeFiscalYearResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(result);
  });

  it("rejects a negative accountsClosed", () => {
    const parsed = closeFiscalYearResultSchema.safeParse({ ...result, accountsClosed: -1 });
    expect(parsed.success).toBe(false);
  });
});

describe("partyCurrencyBalanceSchema", () => {
  const balance = { partyId: "cust-1", partyName: "شركة النور", currency: "USD", outstandingBase: "49500.000000", outstandingTransaction: "1000.000000", documentCount: 3 };

  it("accepts a minimal valid balance and preserves every field verbatim", () => {
    const result = partyCurrencyBalanceSchema.safeParse(balance);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(balance);
  });

  it("rejects a balance missing outstandingBase", () => {
    const { outstandingBase, ...rest } = balance;
    const result = partyCurrencyBalanceSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("currencyBalanceGroupSchema", () => {
  it("accepts a minimal valid group with an empty parties array", () => {
    const group = { currency: "USD", outstandingBase: "0", outstandingTransaction: "0", parties: [] };
    const result = currencyBalanceGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
  });
});

describe("partyCurrencyBalanceReportSchema", () => {
  const report = {
    baseCurrency: "EGP",
    receivables: [
      {
        currency: "USD",
        outstandingBase: "49500.000000",
        outstandingTransaction: "1000.000000",
        parties: [
          { partyId: "cust-1", partyName: "شركة النور", currency: "USD", outstandingBase: "49500.000000", outstandingTransaction: "1000.000000", documentCount: 3 },
        ],
      },
    ],
    payables: [],
    receivableTotalBase: "49500.000000",
    payableTotalBase: "0",
  };

  it("accepts a minimal valid report and preserves every field verbatim", () => {
    const result = partyCurrencyBalanceReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(report);
  });

  it("rejects a report missing baseCurrency", () => {
    const { baseCurrency, ...rest } = report;
    const result = partyCurrencyBalanceReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("baseCurrency");
  });
});
