import { describe, it, expect } from "vitest";
import {
  reportDrillDownKindSchema,
  reportDrillDownDocTypeSchema,
  reportDrillDownFactSchema,
  reportDrillDownDocumentSchema,
  reportDrillDownSchema,
} from "./report-drill-down.js";

describe("reportDrillDownKindSchema", () => {
  it("accepts each known kind", () => {
    for (const kind of ["customer", "supplier", "item", "account"]) {
      expect(reportDrillDownKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("rejects a kind outside the enum", () => {
    expect(reportDrillDownKindSchema.safeParse("project").success).toBe(false);
  });
});

describe("reportDrillDownDocTypeSchema", () => {
  it("accepts each known doc type", () => {
    for (const t of ["SALES_INVOICE", "PURCHASE_INVOICE", "STOCK_MOVEMENT", "JOURNAL_ENTRY"]) {
      expect(reportDrillDownDocTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects a doc type outside the enum", () => {
    expect(reportDrillDownDocTypeSchema.safeParse("SALES_RETURN").success).toBe(false);
  });
});

describe("reportDrillDownFactSchema", () => {
  const fact = { key: "balance", labelAr: "الرصيد", value: "10000.123456", format: "money" as const };

  it("accepts a minimal valid fact and preserves every field verbatim", () => {
    const result = reportDrillDownFactSchema.safeParse(fact);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(fact);
  });

  it("accepts a fact without the optional format", () => {
    const { format, ...rest } = fact;
    const result = reportDrillDownFactSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum format when supplied", () => {
    const result = reportDrillDownFactSchema.safeParse({ ...fact, format: "percentage" });
    expect(result.success).toBe(false);
  });

  it("rejects a fact missing value", () => {
    const { value, ...rest } = fact;
    const result = reportDrillDownFactSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("value");
  });
});

describe("reportDrillDownDocumentSchema", () => {
  const doc = {
    id: "si-1",
    docNo: "SI-2026-001",
    date: "2026-08-30",
    type: "SALES_INVOICE" as const,
    status: "posted",
    amount: 1500.5,
    amountFormat: "money" as const,
  };

  it("accepts a minimal valid document and preserves every field verbatim", () => {
    const result = reportDrillDownDocumentSchema.safeParse(doc);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(doc);
  });

  it("rejects a document missing type", () => {
    const { type, ...rest } = doc;
    const result = reportDrillDownDocumentSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("type");
  });

  it("rejects an out-of-enum amountFormat", () => {
    const result = reportDrillDownDocumentSchema.safeParse({ ...doc, amountFormat: "percent" });
    expect(result.success).toBe(false);
  });

  it("rejects amount sent as a string — this schema uses a plain number, unlike ledger money fields", () => {
    const result = reportDrillDownDocumentSchema.safeParse({ ...doc, amount: "1500.50" });
    expect(result.success).toBe(false);
  });
});

describe("reportDrillDownSchema", () => {
  const drillDown = {
    kind: "customer" as const,
    id: "cust-1",
    titleAr: "شركة النور",
    subtitleAr: null,
    facts: [{ key: "balance", labelAr: "الرصيد", value: "10000.123456" }],
    documents: [
      {
        id: "si-1",
        docNo: "SI-2026-001",
        date: "2026-08-30",
        type: "SALES_INVOICE" as const,
        status: "posted",
        amount: 1500.5,
        amountFormat: "money" as const,
      },
    ],
    documentCount: 200,
  };

  it("accepts a minimal valid drill-down and preserves every field verbatim", () => {
    const result = reportDrillDownSchema.safeParse(drillDown);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(drillDown);
  });

  it("accepts documentCount larger than the length of documents — the list can be capped server-side", () => {
    const result = reportDrillDownSchema.safeParse({ ...drillDown, documents: [drillDown.documents[0]], documentCount: 200 });
    expect(result.success).toBe(true);
  });

  it("rejects a drill-down missing kind", () => {
    const { kind, ...rest } = drillDown;
    const result = reportDrillDownSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("kind");
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = reportDrillDownSchema.safeParse({ ...drillDown, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});
