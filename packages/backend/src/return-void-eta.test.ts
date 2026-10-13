import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, rowsOf, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const STOCK_ITEM = "ITEM-DEMO-2";
const WAREHOUSE = "WH-MAIN";
const BUSINESS_CUSTOMER = "RVE-BUSINESS";
const UNFILEABLE_CUSTOMER = "RVE-UNFILEABLE";
const REASON = "أُدخل المرتجع على الفاتورة الخطأ";

interface GatewayRequest {
  readonly url: string;
  readonly body?: string;
}

let kit: BackendKit;
const sentToAuthority: GatewayRequest[] = [];

const transmitted = () => sentToAuthority.filter((request) => !request.url.endsWith("/connect/token"));
const transmittedNaming = (internalId: string) => transmitted().filter((request) => (request.body ?? "").includes(internalId));

async function submissionOf(docNo: string) {
  await kit.backend.drain();
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const found = rowsOf((await kit.call("GET", "/eta/submissions?pageSize=500")).body).find((row) => row.internalId === docNo);
    if (found) return found;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return null;
}

const stock = async () => {
  const balance = (await kit.call("GET", `/inventory/balance?itemId=${STOCK_ITEM}&warehouseId=${WAREHOUSE}`)).body;
  return [balance.onHand, balance.totalValue];
};

async function confirmedBusinessReturn(tag: string, customerId: string = BUSINESS_CUSTOMER) {
  const created = await kit.call("POST", "/sales-invoices", {
    id: tag, date: TODAY, dueDate: "2026-09-23", customerId, customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId: STOCK_ITEM, itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/sales-invoices/${tag}/confirm`, {})).status).toBe(200);
  const drafted = await kit.call("POST", "/sales-returns/from-invoice", {
    id: `${tag}-R`, date: TODAY, memo: "", warehouseId: WAREHOUSE, sourceInvoiceId: tag, reason: "DEFECTIVE",
    requested: [{ itemId: STOCK_ITEM, sourceLineId: "A", qty: "1" }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const confirmed = await kit.call("POST", `/sales-returns/${tag}-R/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  const creditNote = await submissionOf(confirmed.body.document.docNo);
  expect(creditNote, "the return's credit note in the real queue").not.toBeNull();
  return { id: `${tag}-R`, docNo: confirmed.body.document.docNo as string, creditNote };
}

beforeAll(async () => {
  kit = await bootBackendKit({
    etaHttpClient: async (request) => {
      sentToAuthority.push({ url: request.url, body: request.body });
      if (request.url.endsWith("/connect/token")) return { status: 200, body: JSON.stringify({ access_token: "token", expires_in: 3600 }) };
      const documents = (JSON.parse(request.body ?? "{}") as { documents?: { internalID?: string; internalId?: string }[] }).documents ?? [];
      return {
        status: 202,
        body: JSON.stringify({
          submissionId: "SUB-1",
          acceptedDocuments: documents.map((document, index) => ({ uuid: `UUID-${index}`, longId: `LONG-${index}`, internalId: document.internalID ?? document.internalId })),
          rejectedDocuments: [],
        }),
      };
    },
  });
  const customer = await kit.call("POST", "/customers", {
    id: BUSINESS_CUSTOMER, code: BUSINESS_CUSTOMER, nameAr: "شركة الاختبار للتوريدات", paymentTermsDays: 30, currency: "EGP", openingBalance: "0",
    active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "business", taxNumber: "311222333",
  });
  expect(customer.status, JSON.stringify(customer.body)).toBe(201);
  const unfileable = await kit.call("POST", "/customers", {
    id: UNFILEABLE_CUSTOMER, code: UNFILEABLE_CUSTOMER, nameAr: "شركة برقم ضريبي ناقص", paymentTermsDays: 30, currency: "EGP", openingBalance: "0",
    active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "business", taxNumber: "300112233445",
  });
  expect(unfileable.status, JSON.stringify(unfileable.body)).toBe(201);
}, 180_000);

afterAll(async () => {
  await kit.close();
});

describe("voiding a B2B sales return whose credit note sits in the real e-document queue", () => {
  it("withdraws a credit note that was queued and never sent, and no later pass over the queue sends it", async () => {
    const returned = await confirmedBusinessReturn("RVE-1");
    expect([returned.creditNote.documentType, returned.creditNote.status, returned.creditNote.prevalidation.filter((f: { severity: string }) => f.severity === "blocking")]).toEqual(["credit_note", "ready", []]);
    expect(transmittedNaming(returned.docNo)).toEqual([]);
    const sendable = await confirmedBusinessReturn("RVE-1-SENT");
    const unfileable = await confirmedBusinessReturn("RVE-1-BLOCKED", UNFILEABLE_CUSTOMER);

    const voided = await kit.call("POST", `/sales-returns/${returned.id}/void`, { reason: REASON });
    expect([voided.status, voided.body.status], JSON.stringify(voided.body)).toEqual([200, "reversed"]);

    const withdrawn = await submissionOf(returned.docNo);
    expect(withdrawn.status).toBe("excluded");
    expect(withdrawn.exclusionReason).toContain(returned.docNo);

    const pass = await kit.call("POST", "/eta/submissions/process", {});
    expect(pass.status, JSON.stringify(pass.body)).toBe(200);
    expect(pass.body.blocked).toContain(unfileable.creditNote.id);
    expect(pass.body.submitted.map((row: { internalId: string }) => row.internalId)).toContain(sendable.docNo);
    expect(transmittedNaming(sendable.docNo)).toHaveLength(1);
    const again = await kit.call("POST", "/eta/submissions/submit-all", {});
    expect([again.status, again.body.blocked], JSON.stringify(again.body)).toEqual([200, expect.arrayContaining([unfileable.creditNote.id])]);
    expect((await submissionOf(unfileable.docNo)).status).toBe("ready");
    expect(transmittedNaming(returned.docNo)).toEqual([]);
    expect((await submissionOf(returned.docNo)).status).toBe("excluded");
    const direct = await kit.call("POST", `/eta/submissions/${withdrawn.id}/submit`, {});
    expect(direct.status, JSON.stringify(direct.body)).toBeGreaterThanOrEqual(400);
    expect(transmittedNaming(returned.docNo)).toEqual([]);
    expect(await kit.invariants()).toEqual({ tb: 0n, inventory: 0n, ap: 0n, ar: 0n });
  });

  it("leaves the credit note queued when the void itself is refused", async () => {
    const returned = await confirmedBusinessReturn("RVE-2");
    const refused = await kit.call("POST", `/sales-returns/${returned.id}/void`, { reason: "  " });
    expect(refused.status).toBe(400);
    expect((await submissionOf(returned.docNo)).status).toBe("ready");
  });

  it("is refused once the credit note has been sent, and again once the authority accepts it — the return and its stock stand", async () => {
    const returned = await confirmedBusinessReturn("RVE-3");
    const before = await stock();

    const sent = await kit.call("POST", `/eta/submissions/${returned.creditNote.id}/submit`, {});
    expect([sent.status, sent.body.status], JSON.stringify(sent.body)).toEqual([200, "submitted"]);
    expect(transmittedNaming(returned.docNo)).toHaveLength(1);
    const awaiting = await kit.call("POST", `/sales-returns/${returned.id}/void`, { reason: REASON });
    expect([awaiting.status, awaiting.body.error], JSON.stringify(awaiting.body)).toEqual([409, "ETA_RETURN_AWAITING_VERDICT"]);
    expect(awaiting.body.message).toMatch(/[؀-ۿ]/);

    const accepted = await kit.call("POST", `/eta/submissions/${returned.creditNote.id}/accept`, { etaUuid: "UUID-ACCEPTED" });
    expect([accepted.status, accepted.body.status], JSON.stringify(accepted.body)).toEqual([200, "accepted"]);
    const held = await kit.call("POST", `/sales-returns/${returned.id}/void`, { reason: REASON });
    expect([held.status, held.body.error], JSON.stringify(held.body)).toEqual([409, "ETA_RETURN_ACCEPTED"]);
    expect(held.body.message).toContain("بفاتورة مبيعات جديدة");

    expect((await kit.call("GET", `/sales-returns/${returned.id}`)).body.status).toBe("confirmed");
    expect((await submissionOf(returned.docNo)).status).toBe("accepted");
    expect(await stock()).toEqual(before);
    expect(await kit.invariants()).toEqual({ tb: 0n, inventory: 0n, ap: 0n, ar: 0n });
  });
});
