import { describe, it, expect } from "vitest";
import {
  SEQUENCE_DEFINITIONS,
  getSequenceDefinition,
  formatSequenceNumber,
} from "./sequences.js";

describe("sequence definitions", () => {
  it("encodes the 25 catalog-09 sequences plus SALES_RETURN, SALES_QUOTE, WORK_ORDER and the 3 phase4 inventory-ops sequences (STOCK_ADJUSTMENT, STOCK_TRANSFER, PHYSICAL_COUNT)", () => {
    expect(SEQUENCE_DEFINITIONS).toHaveLength(31);
    expect(getSequenceDefinition("WORK_ORDER").prefix).toBe("WO-");
    expect(getSequenceDefinition("STOCK_ADJUSTMENT").prefix).toBe("ADJ-");
    expect(getSequenceDefinition("PHYSICAL_COUNT").prefix).toBe("CNT-");
  });

  it("has unique codes and unique prefixes", () => {
    const codes = new Set(SEQUENCE_DEFINITIONS.map((d) => d.code));
    const prefixes = new Set(SEQUENCE_DEFINITIONS.map((d) => d.prefix));
    expect(codes.size).toBe(28);
    expect(prefixes.size).toBe(28);
  });

  it("matches the catalog's next-number previews", () => {
    // current value + 1, formatted (docs/catalog/09).
    expect(formatSequenceNumber(getSequenceDefinition("SALES_INVOICE"), 15)).toBe(
      "INV-000015",
    );
    expect(formatSequenceNumber(getSequenceDefinition("JOURNAL_ENTRY"), 86)).toBe(
      "JE-000086",
    );
    expect(formatSequenceNumber(getSequenceDefinition("BOM"), 5)).toBe("BOM-0005");
    // POS uses an 8-wide pad to absorb high volume.
    expect(formatSequenceNumber(getSequenceDefinition("POS_SALE"), 1)).toBe(
      "POS-00000001",
    );
  });

  it("appends an optional suffix when present", () => {
    expect(
      formatSequenceNumber(
        { code: "X", labelAr: "x", prefix: "INV-", suffix: "-2026", padLength: 6, annualReset: true },
        7,
      ),
    ).toBe("INV-000007-2026");
  });

  it("throws on an unknown code", () => {
    expect(() => getSequenceDefinition("NOPE")).toThrow();
  });
});
