import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit, type Reply } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const VAT_RATE = "VAT14";
const SYSTEM_RATE = "SYS-NOT-SUBJECT";
const OUTPUT_VAT = "2200";

let kit: BackendKit;

const taxOf = (body: Reply["body"]) => (body?.lines ?? []).map((line: { taxRatePercent: number; taxRateId: string | null }) => [line.taxRatePercent, line.taxRateId]);

async function setVat(enabled: boolean) {
  const settings = (await kit.call("GET", "/settings")).body;
  expect((await kit.call("PUT", "/settings", { ...settings, taxEnabled: enabled })).status).toBe(200);
}

const serviceLine = (over: Record<string, unknown> = {}) => ({
  lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: "4100", ...over,
});

const draftSale = (id: string, line: Record<string, unknown> = {}) =>
  kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: OUTPUT_VAT, lines: [serviceLine(line)],
  });

const quote = (id: string, line: Record<string, unknown> = {}) =>
  kit.call("POST", "/sales-quotes", {
    id, date: TODAY, expiryDate: "2026-09-30", customerId: "CUST-DEMO-1", customerNameAr: "عميل", branchId: "BR-MAIN",
    lines: [{ lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", ...line }],
  });

async function acceptedQuote(id: string) {
  expect((await quote(id)).status).toBe(201);
  for (const action of ["send", "accept"]) expect((await kit.call("POST", `/sales-quotes/${id}/${action}`, {})).status).toBe(200);
}

const convert = (quoteId: string, invoiceId: string) =>
  kit.call("POST", `/sales-quotes/${quoteId}/convert-to-invoice`, {
    id: invoiceId, dueDate: "2026-09-30", warehouseId: "WH-MAIN", arAccountId: "1105", taxAccountId: OUTPUT_VAT,
    lines: [{ lineId: "A", isStock: false, revenueAccountId: "4100" }],
  });

const invoiceOf = async (id: string) => (await kit.call("GET", `/sales-invoices/${id}`)).body;
const outputVatOf = async (journalEntryId: string) => (await kit.journalLines(journalEntryId)).filter((line) => line.accountId === OUTPUT_VAT).map((line) => line.credit);

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("a document raised under one VAT setting and finished under the other", () => {
  it("off → on: a quote raised outside VAT converts into an invoice priced under VAT, and confirms", async () => {
    await setVat(false);
    await acceptedQuote("VS-Q1");
    await setVat(true);
    const converted = await convert("VS-Q1", "VS-Q1-I");
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    const draft = await invoiceOf("VS-Q1-I");
    expect([taxOf(draft), draft.totals.grandTotal]).toEqual([[[14, VAT_RATE]], "114.000000"]);
    const confirmed = await kit.call("POST", "/sales-invoices/VS-Q1-I/confirm", {});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(await outputVatOf((await invoiceOf("VS-Q1-I")).journalEntryId)).toEqual(["14.000000"]);
  });

  it("off → on: a draft raised outside VAT is re-rated when it confirms, and the reply says so in Arabic", async () => {
    await setVat(false);
    const draft = await draftSale("VS-D1");
    expect([draft.status, taxOf(draft.body), draft.body.totals.grandTotal]).toEqual([201, [[0, SYSTEM_RATE]], "100.000000"]);
    await setVat(true);
    const confirmed = await kit.call("POST", "/sales-invoices/VS-D1/confirm", {});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.taxRecalculated?.message).toContain("أُعيد احتساب الضريبة");
    const invoice = await invoiceOf("VS-D1");
    expect([invoice.status, taxOf(invoice), invoice.totals.grandTotal]).toEqual(["confirmed", [[14, VAT_RATE]], "114.000000"]);
    expect(await outputVatOf(invoice.journalEntryId)).toEqual(["14.000000"]);
  });

  it("on → off: a draft raised at 14% posts no output VAT once the tenant is outside VAT", async () => {
    const draft = await draftSale("VS-D2", { taxRateId: VAT_RATE });
    expect([draft.status, draft.body.totals.grandTotal]).toEqual([201, "114.000000"]);
    await setVat(false);
    const confirmed = await kit.call("POST", "/sales-invoices/VS-D2/confirm", {});
    await setVat(true);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.taxRecalculated?.message).toContain("أُعيد احتساب الضريبة");
    const invoice = await invoiceOf("VS-D2");
    expect([taxOf(invoice), invoice.totals.taxTotal, invoice.totals.grandTotal]).toEqual([[[0, SYSTEM_RATE]], "0.000000", "100.000000"]);
    expect(await outputVatOf(invoice.journalEntryId)).toEqual([]);
  });

  it("says nothing about recalculation when the setting has not moved", async () => {
    expect((await draftSale("VS-D3", { taxRateId: VAT_RATE })).status).toBe(201);
    const confirmed = await kit.call("POST", "/sales-invoices/VS-D3/confirm", {});
    expect([confirmed.status, confirmed.body.taxRecalculated ?? null]).toEqual([200, null]);
  });
});

describe("a converted draft that is cancelled gives its quote back", () => {
  it("returns the quote to accepted so it can be converted again", async () => {
    await acceptedQuote("VS-Q2");
    expect((await convert("VS-Q2", "VS-Q2-I1")).status).toBe(201);
    expect((await kit.call("GET", "/sales-quotes/VS-Q2")).body.status).toBe("converted");
    expect((await kit.call("POST", "/sales-invoices/VS-Q2-I1/cancel", {})).status).toBe(200);
    const reopened = (await kit.call("GET", "/sales-quotes/VS-Q2")).body;
    expect([reopened.status, reopened.convertedInvoiceId]).toEqual(["accepted", null]);
    const again = await convert("VS-Q2", "VS-Q2-I2");
    expect(again.status, JSON.stringify(again.body)).toBe(201);
  });
});

describe("the system's «غير خاضع» rate while VAT is on", () => {
  it("is refused on a new sales draft and a new quote", async () => {
    const draft = await draftSale("VS-SYS-D", { taxRateId: SYSTEM_RATE });
    const quoted = await quote("VS-SYS-Q", { taxRateId: SYSTEM_RATE });
    expect([draft.status, draft.body.error], JSON.stringify(draft.body)).toEqual([422, "TAX_RATE_SYSTEM_ONLY"]);
    expect([quoted.status, quoted.body.error], JSON.stringify(quoted.body)).toEqual([422, "TAX_RATE_SYSTEM_ONLY"]);
  });

  it("is refused on a purchase line and when classifying a purchase line, whatever the VAT setting", async () => {
    const purchase = (id: string, line: Record<string, unknown>) =>
      kit.call("POST", "/purchases/invoices", {
        id, supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: "WH-MAIN",
        lines: [{ itemId: null, kind: "expense", description: "خدمة", qty: "1", unitCost: "200", ...line }],
      });
    const named = await purchase("VS-SYS-P", { taxRateId: SYSTEM_RATE });
    expect([named.status, named.body.error], JSON.stringify(named.body)).toEqual([422, "TAX_RATE_SYSTEM_ONLY"]);
    expect((await purchase("VS-SYS-P2", { taxRateId: null, taxRatePercent: 0 })).status).toBe(201);
    expect((await kit.call("POST", "/purchases/invoices/VS-SYS-P2/confirm", {})).status).toBe(200);
    const classified = await kit.call("POST", "/purchases/invoices/VS-SYS-P2/lines/0/classify-tax", { taxRateId: SYSTEM_RATE });
    expect([classified.status, classified.body.error], JSON.stringify(classified.body)).toEqual([422, "TAX_RATE_SYSTEM_ONLY"]);
  });
});

describe("a draft's line can be corrected before it posts", () => {
  const edit = (id: string, change: Record<string, unknown>, permissions?: readonly string[]) =>
    kit.call("PATCH", `/sales-invoices/${id}/lines/A`, change, permissions);

  it("changes the quantity, the price and the tax rate of a draft line, recomputes the totals and audits before and after", async () => {
    expect((await draftSale("VS-EDIT", { taxRateId: null, taxRatePercent: 0 })).status).toBe(201);
    const edited = await edit("VS-EDIT", { qty: "3", unitPrice: "50", taxRateId: VAT_RATE });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect([taxOf(edited.body), edited.body.lines[0].qty, edited.body.lines[0].unitPrice, edited.body.totals.grandTotal]).toEqual([
      [[14, VAT_RATE]], "3.000000", "50.000000", "171.000000",
    ]);
    const stored = await invoiceOf("VS-EDIT");
    expect([stored.status, stored.totals.grandTotal]).toEqual(["draft", "171.000000"]);
    const [event] = await kit.auditRows("SALES_INVOICE", "VS-EDIT", "EDIT_DRAFT_LINE");
    expect(event.details.before).toEqual({ qty: "1.000000", unitPrice: "100.000000", taxRateId: null, taxRatePercent: 0 });
    expect(event.details.after).toEqual({ qty: "3.000000", unitPrice: "50.000000", taxRateId: VAT_RATE, taxRatePercent: 14 });
    expect((await kit.call("POST", "/sales-invoices/VS-EDIT/confirm", {})).status).toBe(200);
  });

  it("refuses a posted invoice, an unknown line, an empty change, a bad figure and a caller without the permission", async () => {
    expect((await draftSale("VS-EDIT-2", { taxRateId: VAT_RATE })).status).toBe(201);
    const noRight = await edit("VS-EDIT-2", { qty: "2" }, ["sales.invoice.view"]);
    const empty = await edit("VS-EDIT-2", {});
    const negative = await edit("VS-EDIT-2", { qty: "-1" });
    const unknownLine = await kit.call("PATCH", "/sales-invoices/VS-EDIT-2/lines/NOPE", { qty: "2" });
    const systemRate = await edit("VS-EDIT-2", { taxRateId: SYSTEM_RATE });
    expect([noRight.status, empty.status, unknownLine.status]).toEqual([403, 400, 404]);
    expect([negative.status, systemRate.status, systemRate.body.error]).toEqual([422, 422, "TAX_RATE_SYSTEM_ONLY"]);
    expect((await kit.call("POST", "/sales-invoices/VS-EDIT-2/confirm", {})).status).toBe(200);
    const posted = await edit("VS-EDIT-2", { qty: "2" });
    expect([posted.status, posted.body.error]).toEqual([409, "SALES_INVOICE_NOT_DRAFT"]);
    expect((await invoiceOf("VS-EDIT-2")).lines[0].qty).toBe("1.000000");
    expect(await kit.auditRows("SALES_INVOICE", "VS-EDIT-2", "EDIT_DRAFT_LINE")).toHaveLength(0);
  });
});
