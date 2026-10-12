import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit, type Reply } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const VAT_RATE = "VAT14";
const SYSTEM_RATE = "SYS-NOT-SUBJECT";
const SUBMITTER = ["sales.invoice.create", "sales.invoice.confirm", "sales.invoice.view", "sales.invoice.edit"];

let kit: BackendKit;

const taxOf = (body: Reply["body"]) => (body?.lines ?? []).map((line: { taxRatePercent: number; taxRateId: string | null }) => [line.taxRatePercent, line.taxRateId]);

async function setVat(enabled: boolean) {
  const settings = (await kit.call("GET", "/settings")).body;
  expect((await kit.call("PUT", "/settings", { ...settings, taxEnabled: enabled })).status).toBe(200);
}

const draftSale = (id: string, line: Record<string, unknown> = {}) =>
  kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: "4100", ...line }],
  });

const invoiceOf = async (id: string) => (await kit.call("GET", `/sales-invoices/${id}`)).body;
const submit = (id: string) => kit.call("POST", `/sales-invoices/${id}/confirm`, { acknowledgeTaxRecalculation: true }, SUBMITTER);
const approve = async (id: string) => {
  const requestId = (await invoiceOf(id)).workflowRequestId;
  return kit.call("POST", `/workflow/requests/${encodeURIComponent(requestId)}/decide`, { decision: "approve" });
};

async function held(id: string, line: Record<string, unknown> = {}) {
  expect((await draftSale(id, line)).status).toBe(201);
  const submitted = await submit(id);
  expect([submitted.status, submitted.body.held], JSON.stringify(submitted.body)).toEqual([200, true]);
  return invoiceOf(id);
}

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("approving a held invoice posts what the approver read, or nothing", () => {
  it("posts the named rate at the held total when the VAT setting has not moved", async () => {
    const before = await held("HELD-SAME", { taxRateId: VAT_RATE });
    const approved = await approve("HELD-SAME");
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const posted = await invoiceOf("HELD-SAME");
    expect([posted.status, taxOf(posted), posted.totals.grandTotal]).toEqual(["confirmed", [[14, VAT_RATE]], before.totals.grandTotal]);
    expect((await kit.journalLines(posted.journalEntryId)).filter((line) => line.accountId !== "1105").map((line) => line.taxRateId)).toEqual([VAT_RATE, VAT_RATE]);
  });

  it("off → on: refuses to post 114 on an approval given for 100, hands the draft back re-rated and asks for a fresh approval", async () => {
    await setVat(false);
    const before = await held("HELD-OFF-ON");
    expect([taxOf(before), before.totals.grandTotal]).toEqual([[[0, SYSTEM_RATE]], "100.000000"]);
    await setVat(true);

    const refused = await approve("HELD-OFF-ON");
    expect([refused.status, refused.body.reason], JSON.stringify(refused.body)).toEqual([409, "APPROVED_DOCUMENT_RERATED"]);
    expect(refused.body.message).toMatch(/[؀-ۿ]/);
    expect(refused.body.messageEn).toBeTruthy();

    const handedBack = await invoiceOf("HELD-OFF-ON");
    expect([handedBack.status, taxOf(handedBack), handedBack.totals.grandTotal, handedBack.journalEntryId]).toEqual(["draft", [[14, VAT_RATE]], "114.000000", null]);

    const resubmitted = await submit("HELD-OFF-ON");
    expect([resubmitted.status, resubmitted.body.held], JSON.stringify(resubmitted.body)).toEqual([200, true]);
    expect((await approve("HELD-OFF-ON")).status).toBe(200);
    const posted = await invoiceOf("HELD-OFF-ON");
    expect([posted.status, taxOf(posted), posted.totals.grandTotal]).toEqual(["confirmed", [[14, VAT_RATE]], "114.000000"]);
    expect((await kit.journalLines(posted.journalEntryId)).filter((line) => line.accountId !== "1105").map((line) => line.taxRateId)).toEqual([VAT_RATE, VAT_RATE]);
  });

  it("on → off: refuses to post 100 on an approval given for 114, and the fresh approval posts no output VAT under the system rate", async () => {
    const before = await held("HELD-ON-OFF", { taxRateId: VAT_RATE });
    expect(before.totals.grandTotal).toBe("114.000000");
    await setVat(false);
    try {
      const refused = await approve("HELD-ON-OFF");
      expect([refused.status, refused.body.reason], JSON.stringify(refused.body)).toEqual([409, "APPROVED_DOCUMENT_RERATED"]);
      const handedBack = await invoiceOf("HELD-ON-OFF");
      expect([handedBack.status, taxOf(handedBack), handedBack.totals.grandTotal]).toEqual(["draft", [[0, SYSTEM_RATE]], "100.000000"]);
      expect((await submit("HELD-ON-OFF")).body.held).toBe(true);
      expect((await approve("HELD-ON-OFF")).status).toBe(200);
      const posted = await invoiceOf("HELD-ON-OFF");
      expect([posted.status, taxOf(posted), posted.totals.grandTotal]).toEqual(["confirmed", [[0, SYSTEM_RATE]], "100.000000"]);
      expect((await kit.journalLines(posted.journalEntryId)).filter((line) => line.accountId === "2200")).toEqual([]);
    } finally {
      await setVat(true);
    }
    expect(await kit.invariants()).toEqual({ tb: 0n, inventory: 0n, ap: 0n, ar: 0n });
  });
});
