import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";

/**
 * D79 round 4, against the real seeded backend and through the routes the UI
 * calls: who decides a sale is zero-rated, which rate its lines then name, and
 * what a retention release tells the tax authority (nothing).
 */

const BRANCH = "BR-MAIN";
const WAREHOUSE = "WH-MAIN";
const AR = "1105";
const OUTPUT_TAX = "2200";
const REVENUE = "4100";
const TODAY = "2026-08-24";
const NOT_EXEMPT_CUSTOMER = "CUST-DEMO-1";
const CARDED_EXEMPT_CUSTOMER = "CUST-DEMO-3";
const VAT_RATE = "VAT14";
const EXEMPT_RATE = "VAT-EXEMPT";
const EXPORT_RATE = "VAT-EXPORT";
const SYSTEM_RATE = "SYS-NOT-SUBJECT";

interface Reply {
  readonly status: number;
  readonly body: any;
}

let backend: BackendHandle;
let token = "";

async function call(method: string, path: string, body?: unknown, permissions?: readonly string[]): Promise<Reply> {
  const bearer = permissions
    ? backend.sessions.issue({ userId: "LIMITED", permissions, roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE })
    : token;
  const res = await backend.app.fetch(
    new Request(`http://local${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, "x-branch-scope": "*", "x-warehouse-scope": "*" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  try {
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, body: text };
  }
}

const rowsOf = (body: Reply["body"]): Reply["body"][] => (Array.isArray(body) ? body : (body?.items ?? body?.rows ?? []));

function serviceLine(lineId: string, over: Record<string, unknown> = {}) {
  return { lineId, itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", revenueAccountId: REVENUE, ...over };
}

function sale(id: string, customerId: string, lines: readonly Record<string, unknown>[], over: Record<string, unknown> = {}) {
  return call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId, customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: BRANCH,
    arAccountId: AR, taxAccountId: OUTPUT_TAX, lines, ...over,
  });
}

const docNoOf = (confirmed: Reply): string => confirmed.body?.invoice?.docNo ?? confirmed.body?.docNo;

const taxOf = (reply: Reply) => (reply.body?.lines ?? []).map((l: { taxRatePercent: number; taxRateId: string | null }) => [l.taxRatePercent, l.taxRateId]);

async function submissionOf(docNo: string) {
  await backend.drain();
  return rowsOf((await call("GET", "/eta/submissions?pageSize=500")).body).find((s) => s.internalId === docNo) ?? null;
}

beforeAll(async () => {
  backend = await createBackend({
    dbPath: ":memory:",
    seedDemoData: true,
    resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null }),
  });
  token = backend.sessions.issue({ userId: "USER-ADMIN", permissions: ["*"], roleCode: "*", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
}, 120_000);

afterAll(async () => {
  await backend.drain();
  backend.close();
});

describe("who decides a sale is zero-rated (D79 round 4)", () => {
  it("does not believe a request that CLAIMS exemption for a customer who is not exempt", async () => {
    const draft = await sale("T-CLAIMED", NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: VAT_RATE })], { customerTaxExempt: true });
    expect(draft.status).toBe(201);
    expect(taxOf(draft)).toEqual([[14, VAT_RATE]]);
    expect(draft.body.customerTaxExempt).toBe(false);
    expect(draft.body.totals.taxTotal).toBe("14.000000");
  });

  it("zero-rates an exempt customer's sale whatever the request says, under the rate on the customer's card", async () => {
    const draft = await sale("T-CARDED", CARDED_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: VAT_RATE }), serviceLine("L2", { taxRatePercent: 14 })], { customerTaxExempt: false });
    expect(draft.status).toBe(201);
    expect(taxOf(draft)).toEqual([[0, EXEMPT_RATE], [0, EXEMPT_RATE]]);
    expect(draft.body.customerTaxExempt).toBe(true);
  });

  it("applies the same rule to a quote: the claim is ignored, the card is read", async () => {
    const quote = (id: string, customerId: string) =>
      call("POST", "/sales-quotes", {
        id, date: TODAY, expiryDate: "2026-09-23", customerId, customerNameAr: "عميل", branchId: BRANCH, customerTaxExempt: customerId === NOT_EXEMPT_CUSTOMER,
        lines: [{ lineId: "QL1", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", taxRateId: VAT_RATE }],
      });
    const claimed = await quote("T-QT-CLAIMED", NOT_EXEMPT_CUSTOMER);
    expect([claimed.status, taxOf(claimed), claimed.body.customerTaxExempt]).toEqual([201, [[14, VAT_RATE]], false]);
    const carded = await quote("T-QT-CARDED", CARDED_EXEMPT_CUSTOMER);
    expect([carded.status, taxOf(carded), carded.body.customerTaxExempt]).toEqual([201, [[0, EXEMPT_RATE]], true]);
  });
});

describe("the exemption rate on the customer card", () => {
  const exemptCustomer = (id: string, over: Record<string, unknown> = {}) =>
    call("POST", "/customers", { id, code: id, nameAr: "جهة معفاة", taxNumber: "311222333", etaBuyerType: "business", taxExempt: true, ...over });

  it("accepts an active 0% rate of the tenant's own choosing and serves it back", async () => {
    const created = await exemptCustomer("T-EX-EXPORT", { taxExemptionRateId: EXPORT_RATE });
    expect(created.status).toBe(201);
    expect((await call("GET", "/customers/T-EX-EXPORT")).body.taxExemptionRateId).toBe(EXPORT_RATE);
    const draft = await sale("T-EXPORT-SALE", "T-EX-EXPORT", [serviceLine("L1", { taxRatePercent: 14 })]);
    expect(taxOf(draft)).toEqual([[0, EXPORT_RATE]]);
  });

  it("refuses a taxed rate, an unknown rate, and any rate on a customer who is not exempt — in Arabic", async () => {
    const taxed = await exemptCustomer("T-EX-TAXED", { taxExemptionRateId: VAT_RATE });
    expect([taxed.status, taxed.body.error]).toEqual([422, "CUSTOMER_EXEMPTION_RATE_INVALID"]);
    expect(taxed.body.message).toMatch(/[؀-ۿ]/);
    expect((await call("GET", "/customers/T-EX-TAXED")).status).toBe(404);

    const unknown = await exemptCustomer("T-EX-UNKNOWN", { taxExemptionRateId: "NOPE" });
    expect([unknown.status, unknown.body.error]).toEqual([422, "TAX_RATE_NOT_FOUND"]);

    const notExempt = await call("PATCH", `/customers/${NOT_EXEMPT_CUSTOMER}`, { taxExemptionRateId: EXEMPT_RATE });
    expect([notExempt.status, notExempt.body.error]).toEqual([422, "CUSTOMER_EXEMPTION_RATE_WITHOUT_EXEMPTION"]);
    expect((await call("GET", `/customers/${NOT_EXEMPT_CUSTOMER}`)).body.taxExemptionRateId).toBeNull();
  });

  it("drops the rate when the customer stops being exempt, and keeps an unchanged rate through an unrelated edit", async () => {
    await exemptCustomer("T-EX-TOGGLE", { taxExemptionRateId: EXEMPT_RATE });
    const phone = await call("PATCH", "/customers/T-EX-TOGGLE", { phone: "01000000000" });
    expect([phone.status, phone.body.taxExemptionRateId]).toEqual([200, EXEMPT_RATE]);
    const off = await call("PATCH", "/customers/T-EX-TOGGLE", { taxExempt: false });
    expect([off.status, off.body.taxExempt, off.body.taxExemptionRateId]).toEqual([200, false, null]);
  });

  it("with no rate on the card, the line names NONE and the e-invoice is blocked, pointing at the card and the classify action", async () => {
    await exemptCustomer("T-EX-NONE");
    const draft = await sale("T-STUCK", "T-EX-NONE", [serviceLine("L1", { taxRatePercent: 14 })]);
    expect(taxOf(draft)).toEqual([[0, null]]);
    const confirmed = await call("POST", "/sales-invoices/T-STUCK/confirm", {});
    expect(confirmed.status).toBe(200);
    const submission = await submissionOf(docNoOf(confirmed));
    const findings = (submission?.prevalidation ?? []).filter((f: { code: string }) => f.code === "TAX_SUBTYPE_NOT_MAPPED");
    expect(findings.map((f: { severity: string }) => f.severity)).toEqual(["blocking"]);
    expect(findings[0].fixHintAr).toContain("تصنيف ضريبة البند");
    expect(findings[0].fixHintAr).toContain("بطاقة العميل");
  });

  it("never names the system «غير خاضع» rate for an exempt customer", async () => {
    const all = rowsOf((await call("GET", "/sales-invoices?pageSize=500")).body).filter((i) => String(i.id).startsWith("T-"));
    expect(all.flatMap((i) => (i.lines ?? []).map((l: { taxRateId: string | null }) => l.taxRateId))).not.toContain(SYSTEM_RATE);
  });
});

describe("a retention release is not a supply", () => {
  it("posts Dr receivables / Cr retention, names no tax rate, reports no VAT row and files nothing with the authority", async () => {
    const drafted = await call("POST", "/contracting/retention/releases", { id: "T-REL", contractId: "CTR-DEMO-1", kind: "provisional", date: "2026-09-02", amount: "100.00", notes: "t" });
    expect(drafted.status).toBe(201);
    const released = await call("POST", "/contracting/retention/releases/T-REL/release", { approvedBy: "T-APPROVER" }, ["*"]);
    expect(released.status).toBe(200);
    const invoice = (await call("GET", `/sales-invoices/${released.body.invoiceId}`)).body;
    expect(invoice.status).toBe("confirmed");
    expect(taxOf({ status: 200, body: invoice })).toEqual([[0, null]]);

    const journal = (await call("GET", `/gl/journal-entries/${invoice.journalEntryId}`)).body;
    const lines = journal.lines as { accountId: string; debit: string; credit: string; taxRateId: string | null }[];
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountId === AR)?.debit).toBe("100.000000");
    expect(lines.filter((l) => l.accountId !== AR).map((l) => l.credit)).toEqual(["100.000000"]);
    expect(lines.some((l) => l.accountId === OUTPUT_TAX || l.taxRateId !== null)).toBe(false);

    expect(rowsOf((await call("GET", "/financial-reports/vat-return?periodFrom=2026-09-02&periodTo=2026-09-02")).body)).toEqual([]);
    expect(await submissionOf(invoice.docNo)).toBeNull();
  });
});
