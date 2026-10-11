import { describe, expect, it } from "vitest";
import { purchaseInvoiceLineTotal, returnLineTotal, returnLinesTotal } from "./exact-line-totals";

describe("the line totals a document screen shows are the ledger's own arithmetic (D79)", () => {
  it("extends a purchase line to the piastre before taxing it, where binary floats drift", () => {
    expect(purchaseInvoiceLineTotal({ qty: "3", unitCost: "0.335", taxRatePercent: 14 })).toBe(1.15);
    expect(purchaseInvoiceLineTotal({ qty: "1.1", unitCost: "1.1", taxRatePercent: 0 })).toBe(1.21);
    expect(1.1 * 1.1).not.toBe(1.21);
  });

  it("adds a return line's stored tax to its piastre-rounded extension exactly", () => {
    expect(returnLineTotal({ qty: "3", unitPrice: "0.1", taxAmount: "0.042" })).toBe(0.342);
    expect(3 * 0.1 + 0.042).not.toBe(0.342);
    expect(returnLineTotal({ qty: "1", unitPrice: "100", taxAmount: "14" })).toBe(114);
    const tenths = { qty: "1", unitPrice: "0.1", taxAmount: "0" };
    expect(returnLinesTotal([tenths, tenths, tenths])).toBe(0.3);
    expect(0.1 + 0.1 + 0.1).not.toBe(0.3);
  });
});
