import { describe, expect, it } from "vitest";
import { Qty } from "../money/index.js";
import { InvalidDocumentError } from "./errors.js";
import type { FrameworkDocument } from "./document.js";
import { assertReturnTotalsWithinAvailable, createReturnConfirmGuard, type ReturnDocumentLine } from "./return-availability.js";

const q = (major: string) => Qty.fromMajor(major);
const line = (sourceLineId: string | null, qty: string, availableQty: string, itemId = "X"): ReturnDocumentLine => ({
  itemId,
  sourceInvoiceId: "INV1",
  sourceLineId,
  qty: q(qty),
  availableQty: q(availableQty),
});
const doc = (lines: ReturnDocumentLine[]): FrameworkDocument<ReturnDocumentLine> => ({
  id: "RET1",
  docType: "SALES_RETURN",
  docNo: null,
  date: "2026-08-21",
  memo: "",
  status: "draft",
  lines,
  createdAt: "2026-08-21T00:00:00.000Z",
  confirmedAt: null,
  reversesDocId: null,
  reversedByDocId: null,
  workflowRequestId: null,
  journalEntryId: null,
});

describe("assertReturnTotalsWithinAvailable — one document may not return a source line more than once over", () => {
  it("refuses two lines against one source line whose total exceeds what is available, though each alone fits", () => {
    expect(() => assertReturnTotalsWithinAvailable("SALES_RETURN", "RET1", [line("L1", "3", "3"), line("L1", "3", "3")])).toThrow(InvalidDocumentError);
    expect(() => assertReturnTotalsWithinAvailable("SALES_RETURN", "RET1", [line("L1", "3", "3"), line("L1", "3", "3")])).toThrow(/6\.000000.*3\.000000/);
  });

  it("accepts two lines against one source line that together take exactly what is available", () => {
    expect(() => assertReturnTotalsWithinAvailable("SALES_RETURN", "RET1", [line("L1", "1", "3"), line("L1", "2", "3")])).not.toThrow();
  });

  it("counts each source line on its own — one item on two lines is not one pool", () => {
    expect(() => assertReturnTotalsWithinAvailable("SALES_RETURN", "RET1", [line("L1", "3", "3"), line("L2", "3", "3")])).not.toThrow();
  });

  it("pools lines that name no source line by item, against the least any of them was offered", () => {
    expect(() => assertReturnTotalsWithinAvailable("SALES_RETURN", "RET1", [line(null, "2", "3"), line(null, "2", "3")])).toThrow(InvalidDocumentError);
  });
});

describe("createReturnConfirmGuard — what is returnable is read again from posted documents when a return confirms", () => {
  const invoice = (alreadyReturned: string) => ({
    lines: [{ sourceLineId: "L1", itemId: "X", qty: q("3"), alreadyReturnedQty: q(alreadyReturned) }],
  });

  it("lets a draft confirm while its line still has the quantity", async () => {
    const guard = createReturnConfirmGuard<ReturnDocumentLine>("SALES_RETURN", async () => invoice("0"));
    await expect(guard(doc([line("L1", "3", "3")]))).resolves.toBeUndefined();
  });

  it("refuses a draft whose line another return has confirmed against since it was drafted", async () => {
    const guard = createReturnConfirmGuard<ReturnDocumentLine>("SALES_RETURN", async () => invoice("3"));
    await expect(guard(doc([line("L1", "3", "3")]))).rejects.toThrow(InvalidDocumentError);
    await expect(guard(doc([line("L1", "3", "3")]))).rejects.toThrow(/3\.000000.*0\.000000/);
  });

  it("refuses a draft naming a line the invoice does not carry", async () => {
    const guard = createReturnConfirmGuard<ReturnDocumentLine>("SALES_RETURN", async () => invoice("0"));
    await expect(guard(doc([line("L9", "1", "3")]))).rejects.toThrow(/غير موجود في الفاتورة المصدر/);
  });

  it("refuses a draft whose source invoice is no longer a confirmed invoice", async () => {
    const guard = createReturnConfirmGuard<ReturnDocumentLine>("SALES_RETURN", async () => null);
    await expect(guard(doc([line("L1", "1", "3")]))).rejects.toThrow(/الفاتورة المصدر/);
  });

  it("leaves a reversal's mirror alone — it returns nothing new", async () => {
    const guard = createReturnConfirmGuard<ReturnDocumentLine>("SALES_RETURN", async () => invoice("3"));
    await expect(guard({ ...doc([line("L1", "3", "3")]), reversesDocId: "RET0" })).resolves.toBeUndefined();
  });
});
