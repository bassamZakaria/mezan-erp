import { describe, expect, it } from "vitest";
import { purchaseInvoiceLineTotal, returnLineTotal, returnLinesTotal } from "./exact-line-totals";

describe("the line totals a document screen shows are the ledger's own arithmetic (D79)", () => {
  it("prices a purchase line in exact decimals, where binary floats drift", () => {
    expect(purchaseInvoiceLineTotal({ qty: "1.1", unitCost: "1.1", taxRatePercent: 0 })).toBe(1.21);
    expect(1.1 * 1.1).not.toBe(1.21);
    expect(purchaseInvoiceLineTotal({ qty: "0.1", unitCost: "0.2", taxRatePercent: 0 })).toBe(0.02);
    expect(0.1 * 0.2).not.toBe(0.02);
    expect(purchaseInvoiceLineTotal({ qty: "3", unitCost: "100", taxRatePercent: 14 })).toBe(342);
  });

  it("adds a return line's stored tax to its extension, and sums lines, exactly", () => {
    expect(returnLineTotal({ qty: "0.1", unitPrice: "0.2", taxAmount: "0" })).toBe(0.02);
    expect(returnLineTotal({ qty: "1", unitPrice: "100", taxAmount: "14" })).toBe(114);
    const tenths = { qty: "1", unitPrice: "0.1", taxAmount: "0" };
    expect(returnLinesTotal([tenths, tenths, tenths])).toBe(0.3);
    expect(0.1 + 0.1 + 0.1).not.toBe(0.3);
  });
});
