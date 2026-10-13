import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, rowsOf, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const BUSINESS_CUSTOMER = "CUST-DEMO-1";
const CONSUMER = "CUST-DEMO-3";
const DEMO_ITEMS = ["ITEM-DEMO-1", "ITEM-DEMO-5", "ITEM-DEMO-6", "ITEM-DEMO-7", "ITEM-DEMO-8", "ITEM-DEMO-10", "ITEM-DEMO-11", "ITEM-DEMO-12"];
const BLOCKING = "blocking";

let kit: BackendKit;

async function sale(id: string, customerId: string, itemId: string, isStock: boolean) {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId, customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId, itemNameAr: "صنف", isStock, qty: "1", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const confirmed = await kit.call("POST", `/sales-invoices/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return confirmed.body;
}

const submissionOf = async (internalId: string) =>
  rowsOf((await kit.call("GET", "/eta/submissions?pageSize=10000")).body).find((row) => row.internalId === internalId);

const blockersOf = (submission: { prevalidation?: { severity: string; code: string }[] } | undefined) =>
  (submission?.prevalidation ?? []).filter((finding) => finding.severity === BLOCKING).map((finding) => finding.code);

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("the demo tenant can file what it sells", () => {
  it("queues an e-invoice with nothing blocking it for a sale of each demo item to a business customer", async () => {
    const held: Record<string, string[]> = {};
    for (const [index, itemId] of DEMO_ITEMS.entries()) {
      const posted = await sale(`SEED-ETA-INV-${index}`, BUSINESS_CUSTOMER, itemId, false);
      const submission = await submissionOf(posted.docNo);
      expect(submission, `e-invoice of ${posted.docNo}`).toBeDefined();
      const blockers = blockersOf(submission);
      if (blockers.length > 0) held[itemId] = blockers;
    }
    expect(held).toEqual({});
  });

  it("queues the credit note of a return on such a sale with nothing blocking it", async () => {
    const posted = await sale("SEED-ETA-INV-RET", BUSINESS_CUSTOMER, "ITEM-DEMO-5", false);
    expect(posted.status).toBe("confirmed");
    const drafted = await kit.call("POST", "/sales-returns/from-invoice", { id: "SEED-ETA-RET", date: TODAY, memo: "", warehouseId: "WH-MAIN", sourceInvoiceId: "SEED-ETA-INV-RET", reason: "DEFECTIVE", requested: [{ itemId: "ITEM-DEMO-5", sourceLineId: "A", qty: "1" }] });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const returned = await kit.call("POST", "/sales-returns/SEED-ETA-RET/confirm", {});
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    const creditNote = await submissionOf(returned.body.document.docNo);
    expect(creditNote?.documentType).toBe("credit_note");
    expect(blockersOf(creditNote)).toEqual([]);
  });

  it("issues a consumer e-receipt at the confirm of a sale to an individual", async () => {
    const posted = await sale("SEED-ETA-RCPT", CONSUMER, "ITEM-DEMO-6", false);
    expect(posted.etaReceiptError ?? null).toBeNull();
    expect(posted.etaReceipt?.uuid).toEqual(expect.any(String));
  });
});
