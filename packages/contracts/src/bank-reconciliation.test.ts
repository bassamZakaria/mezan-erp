import { describe, it, expect } from "vitest";
import {
  bankStatementStatusSchema,
  statementLineStatusSchema,
  statementDateFormatSchema,
  columnMappingInputSchema,
  bankStatementSchema,
  statementLineSchema,
  importBankStatementSchema,
  matchStatementLineSchema,
  addManualLineSchema,
  matchSummarySchema,
  bankStatementListItemSchema,
  matchCandidateSchema,
  bankStatementListQuerySchema,
} from "./bank-reconciliation.js";

describe("bankStatementStatusSchema", () => {
  it("accepts each known status", () => {
    for (const s of ["imported", "in_progress", "completed"]) {
      expect(bankStatementStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(bankStatementStatusSchema.safeParse("archived").success).toBe(false);
  });
});

describe("statementDateFormatSchema", () => {
  it("accepts each known date format", () => {
    for (const f of ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"]) {
      expect(statementDateFormatSchema.safeParse(f).success).toBe(true);
    }
  });

  it("rejects a format outside the enum", () => {
    expect(statementDateFormatSchema.safeParse("YYYY/MM/DD").success).toBe(false);
  });
});

describe("columnMappingInputSchema", () => {
  const mapping = { dateColumn: "Date", descriptionColumn: "Description" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = columnMappingInputSchema.safeParse(mapping);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(mapping);
  });

  it("rejects a payload missing descriptionColumn", () => {
    const { descriptionColumn, ...rest } = mapping;
    const result = columnMappingInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("descriptionColumn");
  });

  it("silently strips a caller-supplied treasuryAccountId — that field is stamped server-side, not client-supplied here", () => {
    const result = columnMappingInputSchema.safeParse({ ...mapping, treasuryAccountId: "acc-caller" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("treasuryAccountId");
  });
});

describe("bankStatementSchema", () => {
  const statement = {
    id: "stmt-1",
    treasuryAccountId: "acc-1",
    source: "csv" as const,
    statementNumber: null,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    openingBalance: "10000.123456",
    closingBalance: "12000.123456",
    status: "imported" as const,
    importedAt: "2026-09-01T10:00:00.000Z",
    finalizedAt: null,
  };

  it("accepts a minimal valid statement and preserves every field verbatim", () => {
    const result = bankStatementSchema.safeParse(statement);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(statement);
  });

  it("rejects a source other than the literal csv", () => {
    const result = bankStatementSchema.safeParse({ ...statement, source: "ofx" });
    expect(result.success).toBe(false);
  });

  it("never coerces openingBalance to a float — high-precision decimal string survives verbatim", () => {
    const result = bankStatementSchema.safeParse({ ...statement, openingBalance: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openingBalance).toBe("0.100001");
  });
});

describe("statementLineSchema", () => {
  const line = {
    id: "line-1",
    statementId: "stmt-1",
    date: "2026-08-15",
    description: "TRANSFER FROM CUSTOMER",
    reference: "REF123",
    amount: "1000.123456",
    status: "unmatched" as const,
    matchedEntryId: null,
    matchedEntryNo: null,
    matchedAt: null,
  };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = statementLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = statementLineSchema.safeParse({ ...line, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = statementLineSchema.safeParse({ ...line, amount: 1000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = statementLineSchema.safeParse({ ...line, status: "ignored" });
    expect(result.success).toBe(false);
  });
});

describe("importBankStatementSchema", () => {
  const importReq = {
    treasuryAccountId: "acc-1",
    rawCsv: "Date,Description,Amount\n2026-08-15,Transfer,1000.00",
    mapping: { dateColumn: "Date", descriptionColumn: "Description" },
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    openingBalance: "10000.000000",
    closingBalance: "11000.000000",
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = importBankStatementSchema.safeParse(importReq);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(importReq);
  });

  it("rejects a payload missing rawCsv", () => {
    const { rawCsv, ...rest } = importReq;
    const result = importBankStatementSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("rawCsv");
  });

  it("rejects an empty rawCsv", () => {
    const result = importBankStatementSchema.safeParse({ ...importReq, rawCsv: "" });
    expect(result.success).toBe(false);
  });
});

describe("matchStatementLineSchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const result = matchStatementLineSchema.safeParse({ entryId: "je-1" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing entryId", () => {
    const result = matchStatementLineSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("addManualLineSchema", () => {
  const line = { date: "2026-08-15", description: "Bank fee", amount: "-25.000000" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = addManualLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = addManualLineSchema.safeParse({ ...line, amount: -25 });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing description", () => {
    const { description, ...rest } = line;
    const result = addManualLineSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("description");
  });
});

describe("matchSummarySchema", () => {
  const summary = { total: 100, matched: 80, unmatched: 20, matchRate: 0.8 };

  it("accepts a minimal valid summary and preserves every field verbatim", () => {
    const result = matchSummarySchema.safeParse(summary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(summary);
  });

  it("rejects a matchRate outside 0-1", () => {
    expect(matchSummarySchema.safeParse({ ...summary, matchRate: -0.1 }).success).toBe(false);
    expect(matchSummarySchema.safeParse({ ...summary, matchRate: 1.1 }).success).toBe(false);
  });
});

describe("bankStatementListItemSchema", () => {
  it("accepts a statement extended with matchSummary", () => {
    const item = {
      id: "stmt-1",
      treasuryAccountId: "acc-1",
      source: "csv" as const,
      statementNumber: null,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      openingBalance: "10000.000000",
      closingBalance: "12000.000000",
      status: "completed" as const,
      importedAt: "2026-09-01T10:00:00.000Z",
      finalizedAt: "2026-09-02T10:00:00.000Z",
      matchSummary: { total: 10, matched: 10, unmatched: 0, matchRate: 1 },
    };
    const result = bankStatementListItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it("rejects an item missing matchSummary", () => {
    const item = {
      id: "stmt-1",
      treasuryAccountId: "acc-1",
      source: "csv" as const,
      statementNumber: null,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      openingBalance: "10000.000000",
      closingBalance: "12000.000000",
      status: "completed" as const,
      importedAt: "2026-09-01T10:00:00.000Z",
      finalizedAt: null,
    };
    const result = bankStatementListItemSchema.safeParse(item);
    expect(result.success).toBe(false);
  });
});

describe("matchCandidateSchema", () => {
  const candidate = { entryId: "je-1", entryNo: "JE-2026-001", date: "2026-08-15", amount: "1000.000000", description: "customer transfer" };

  it("accepts a minimal valid candidate and preserves every field verbatim", () => {
    const result = matchCandidateSchema.safeParse(candidate);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(candidate);
  });

  it("rejects a candidate missing amount", () => {
    const { amount, ...rest } = candidate;
    const result = matchCandidateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("bankStatementListQuerySchema", () => {
  it("accepts an empty query — every field is optional", () => {
    const result = bankStatementListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum status filter", () => {
    const result = bankStatementListQuerySchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});
