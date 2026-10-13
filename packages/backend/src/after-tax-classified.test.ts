import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaxClassificationFilingOutcome } from "@mezan/domain";
import { createAfterTaxClassified } from "./eta-receipts.js";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

const ISSUED = { receiptNo: "R", uuid: "U", qrValue: "Q" };

function wiring(over: {
  correct?: () => Promise<{ outcome: TaxClassificationFilingOutcome; message?: string } | null>;
  reissueReturn?: (returnId: string) => Promise<typeof ISSUED | null>;
  returns?: readonly { id: string; docNo: string | null; status: string; reversesDocId: string | null }[];
}) {
  let scheduled = 0;
  const run = createAfterTaxClassified({
    receipts: {
      correctInvoiceReceiptAfterClassification: over.correct ?? (async () => null),
      reissueReturnReceipt: over.reissueReturn ?? (async () => null),
      issueReturnReceipt: async () => null,
      scheduleSubmission: () => {
        scheduled += 1;
      },
    },
    returnsOf: async () => over.returns ?? [],
    log: () => undefined,
  });
  return { run, scheduled: () => scheduled };
}

describe("what became of the e-receipt after its line's tax was classified (finding 12)", () => {
  it("reports a reissue that failed, in Arabic, instead of answering as if nothing happened", async () => {
    const { run } = wiring({
      correct: async () => {
        throw new Error("device offline");
      },
    });
    const result = await run("INV-1");
    expect(result?.outcome).toBe(TaxClassificationFilingOutcome.ReissueFailed);
    expect(result?.message).toMatch(/[؀-ۿ]/);
    expect(result?.message).not.toContain("device offline");
  });

  it("carries a failure's own Arabic reason when it has one", async () => {
    const { run } = wiring({
      correct: async () => {
        throw new Error("لا يوجد جهاز نقطة بيع مسجّل لهذا الفرع.");
      },
    });
    expect((await run("INV-1"))?.message).toContain("لا يوجد جهاز نقطة بيع مسجّل لهذا الفرع.");
  });

  it("succeeds on the retry once the cause is gone", async () => {
    let fail = true;
    const { run } = wiring({
      correct: async () => {
        if (fail) throw new Error("x");
        return { outcome: TaxClassificationFilingOutcome.Reissued };
      },
    });
    expect((await run("INV-1"))?.outcome).toBe(TaxClassificationFilingOutcome.ReissueFailed);
    fail = false;
    expect(await run("INV-1")).toEqual({ outcome: TaxClassificationFilingOutcome.Reissued });
  });

  it("reports a return's refund receipt that could not be reissued, naming the return, and still schedules the ones that were", async () => {
    const { run, scheduled } = wiring({
      returns: [
        { id: "R1", docNo: "SR-000001", status: "confirmed", reversesDocId: null },
        { id: "R2", docNo: "SR-000002", status: "confirmed", reversesDocId: null },
        { id: "R1:void", docNo: "JE-9", status: "confirmed", reversesDocId: "R0" },
      ],
      reissueReturn: async (returnId) => {
        if (returnId === "R1") throw new Error("x");
        if (returnId === "R1:void") throw new Error("a voided return's mirror is never reissued");
        return ISSUED;
      },
    });
    const result = await run("INV-1");
    expect(result?.outcome).toBe(TaxClassificationFilingOutcome.ReissueFailed);
    expect(result?.message).toContain("SR-000001");
    expect(result?.message).not.toContain("SR-000002");
    expect(result?.message).not.toContain("JE-9");
    expect(scheduled()).toBe(1);
  });

  it("says nothing when there was nothing to reissue", async () => {
    expect(await wiring({}).run("INV-1")).toBeNull();
  });
});

describe("POST /sales-invoices/:id/eta-receipt/retry", () => {
  let kit: BackendKit;
  beforeAll(async () => {
    kit = await bootBackendKit();
    const created = await kit.call("POST", "/sales-invoices", {
      id: "RETRY-1", date: "2026-08-24", dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
      arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: "4100", taxRateId: "VAT14" }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await kit.call("POST", "/sales-invoices/RETRY-1/confirm", {})).status).toBe(200);
  }, 120_000);
  afterAll(async () => {
    await kit.close();
  });

  it("answers with what became of the receipt, to a caller who may classify and may see the invoice", async () => {
    const retried = await kit.call("POST", "/sales-invoices/RETRY-1/eta-receipt/retry", {});
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toEqual({ documentId: "RETRY-1", filing: null });
    expect((await kit.call("POST", "/sales-invoices/RETRY-1/eta-receipt/retry", {}, ["sales.invoice.view"])).status).toBe(403);
    expect((await kit.call("POST", "/sales-invoices/NOPE/eta-receipt/retry", {})).status).toBe(404);
    expect((await kit.call("POST", "/sales-invoices/RETRY-1/eta-receipt/retry", {}, ["sales.invoice.classify_tax", "sales.invoice.view_own"])).status).toBe(404);
  });
});
