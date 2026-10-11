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
const CARDED_EXEMPT_CUSTOMER = "CUST-DEMO-4";
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

const rowsOf = (body: Reply["body"]): Reply["body"][] => (Array.isArray(body) ? body : (body?.items ?? body?.rows ?? body?.events ?? []));

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

  it("refuses the system rate on a customer card, in Arabic", async () => {
    const refused = await exemptCustomer("T-EX-SYSTEM", { taxExemptionRateId: SYSTEM_RATE });
    expect([refused.status, refused.body.error]).toEqual([422, "CUSTOMER_EXEMPTION_RATE_SYSTEM"]);
    expect(refused.body.message).toMatch(/[؀-ۿ]/);
    expect((await call("GET", "/customers/T-EX-SYSTEM")).status).toBe(404);
  });

  it("holds a rate named on customer cards to its percent, sub-type and status until the cards are cleared — saying how many", async () => {
    expect((await call("POST", "/tax-rates", { id: "T-CARD-ZERO", code: "T-CARD-ZERO", name: "صفري للبطاقات", rate: 0, etaSubType: "V002" })).status).toBe(201);
    await exemptCustomer("T-EX-CARD-1", { taxExemptionRateId: "T-CARD-ZERO" });
    await exemptCustomer("T-EX-CARD-2", { taxExemptionRateId: "T-CARD-ZERO" });

    for (const patch of [{ rate: 14 }, { etaSubType: "V003" }, { status: "inactive" }]) {
      const refused = await call("PATCH", "/tax-rates/T-CARD-ZERO", patch);
      expect([refused.status, refused.body.error, refused.body.customerCount]).toEqual([409, "TAX_RATE_ON_CUSTOMER_CARDS", 2]);
      expect(refused.body.message).toMatch(/2/);
      expect(refused.body.message).toMatch(/[؀-ۿ]/);
    }
    expect((await call("PATCH", "/tax-rates/T-CARD-ZERO", { name: "صفري — اسم جديد" })).status).toBe(200);

    await call("PATCH", "/customers/T-EX-CARD-1", { taxExemptionRateId: null });
    await call("PATCH", "/customers/T-EX-CARD-2", { taxExempt: false });
    expect((await call("PATCH", "/tax-rates/T-CARD-ZERO", { status: "inactive" })).status).toBe(200);
  });

  it("refuses an inactive rate a request names on the card", async () => {
    expect((await call("POST", "/tax-rates", { id: "T-CARD-OLD", code: "T-CARD-OLD", name: "صفري قديم", rate: 0, etaSubType: "V002" })).status).toBe(201);
    expect((await call("PATCH", "/tax-rates/T-CARD-OLD", { status: "inactive" })).status).toBe(200);
    await exemptCustomer("T-EX-RESEND");
    const fresh = await call("PATCH", "/customers/T-EX-RESEND", { taxExemptionRateId: "T-CARD-OLD" });
    expect([fresh.status, fresh.body.error]).toEqual([422, "CUSTOMER_EXEMPTION_RATE_INVALID"]);
  });

  it("treats a 0% rate named «غير خاضع» with the automatic sub-type as the system's look-alike", async () => {
    const shadow = await call("POST", "/tax-rates", { id: "T-SHADOW", code: "T-SHADOW", name: "غير خاضع", rate: 0, etaSubType: "auto" });
    expect([shadow.status, shadow.body.error]).toEqual([409, "TAX_RATE_RESERVED"]);
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

describe("a retention release is marked as one, for a consumer contract customer too (D79 round 5)", () => {
  it("is served with its document kind, is never classified, is never receipted and never queued", async () => {
    const contract = (await call("GET", "/contracting/contracts/CTR-DEMO-1")).body;
    const customer = (await call("GET", `/customers/${contract.customerId}`)).body;
    expect((await call("PATCH", `/customers/${contract.customerId}`, { taxNumber: null, etaBuyerType: "individual" })).status).toBe(200);
    try {
      expect((await call("POST", "/contracting/retention/releases", { id: "T-REL-B2C", contractId: "CTR-DEMO-1", kind: "provisional", date: "2026-09-03", amount: "50.00", notes: "t" })).status).toBe(201);
      const released = await call("POST", "/contracting/retention/releases/T-REL-B2C/release", { approvedBy: "T-APPROVER" }, ["*"]);
      expect(released.status).toBe(200);
      const invoice = (await call("GET", `/sales-invoices/${released.body.invoiceId}`)).body;
      expect(invoice.documentKind).toBe("retention_release");

      const classified = await call("POST", `/sales-invoices/${invoice.id}/lines/${invoice.lines[0].lineId}/classify-tax`, { taxRateId: EXEMPT_RATE });
      expect([classified.status, classified.body.error]).toEqual([409, "TAX_CLASSIFICATION_NOT_A_SUPPLY"]);
      expect(classified.body.message).toMatch(/[؀-ۿ]/);
      expect((await call("GET", `/sales-invoices/${invoice.id}`)).body.lines[0].taxRateId).toBeNull();

      const receipt = await call("POST", `/eta/receipts/issue/invoice/${invoice.id}`, {});
      expect([receipt.status, receipt.body.error]).toEqual([409, "ETA_RECEIPT_NOT_A_SUPPLY"]);
      expect(receipt.body.message).toMatch(/[؀-ۿ]/);
      expect(await submissionOf(invoice.docNo)).toBeNull();
      expect(rowsOf((await call("GET", "/eta/receipts/gaps")).body).filter((g) => g.internalId === invoice.docNo)).toEqual([]);
    } finally {
      await call("PATCH", `/customers/${contract.customerId}`, { taxNumber: customer.taxNumber, etaBuyerType: customer.etaBuyerType });
    }
  });

  it("marks a subcontractor's retention release the same way, and refuses to classify its line", async () => {
    const released = await call("POST", "/contracting/subcontracts/SUB-DEMO-1/release-retention", { amount: "100.00", date: "2026-09-03", kind: "final" }, ["*"]);
    expect(released.status).toBe(200);
    const release = released.body.retention.releases.at(-1);
    const invoice = (await call("GET", `/purchases/invoices/${release.invoiceId}`)).body;
    expect(invoice.documentKind).toBe("retention_release");
    const classified = await call("POST", `/purchases/invoices/${invoice.id}/lines/0/classify-tax`, { taxRateId: EXEMPT_RATE });
    expect([classified.status, classified.body.error]).toEqual([409, "TAX_CLASSIFICATION_NOT_A_SUPPLY"]);
    expect((await call("GET", `/purchases/invoices/${invoice.id}`)).body.lines[0].taxRateId).toBeNull();
  });
});

describe("classifying the tax of a posted line that stored none", () => {
  const classify = (invoiceId: string, lineId: string, body: Record<string, unknown>, permissions?: readonly string[]) =>
    call("POST", `/sales-invoices/${invoiceId}/lines/${lineId}/classify-tax`, body, permissions);
  const journalOf = async (invoiceId: string) => {
    const invoice = (await call("GET", `/sales-invoices/${invoiceId}`)).body;
    const entry = (await call("GET", `/gl/journal-entries/${invoice.journalEntryId}`)).body;
    return { invoice, entry, lines: entry.lines as { accountId: string; debit: string; credit: string; taxRatePercent: number | null; taxRateId: string | null }[] };
  };
  const vatRowsOn = async (date: string) =>
    rowsOf((await call("GET", `/financial-reports/vat-return?periodFrom=${date}&periodTo=${date}`)).body) as { side: string; taxRateId: string | null; base: string; tax: string }[];
  const moneyOnly = (lines: { accountId: string; debit: string; credit: string; taxRatePercent: number | null }[]) =>
    lines.map((l) => [l.accountId, l.debit, l.credit, l.taxRatePercent]);

  it("names the stuck line of the uncarded exempt customer's sale: NULL → «معفى», journal tagged, finding cleared, nothing else moved", async () => {
    const before = await journalOf("T-STUCK");
    expect(before.invoice.lines.map((l: { taxRateId: string | null }) => l.taxRateId)).toEqual([null]);
    const trialBefore = (await call("GET", "/financial-reports/trial-balance")).body.grandTotals;

    const taxed = await classify("T-STUCK", "L1", { taxRateId: VAT_RATE });
    expect([taxed.status, taxed.body.error]).toEqual([422, "TAX_RATE_CLASSIFICATION_PERCENT_MISMATCH"]);
    expect(taxed.body.message).toMatch(/[؀-ۿ]/);
    expect((await journalOf("T-STUCK")).lines).toEqual(before.lines);

    const done = await classify("T-STUCK", "L1", { taxRateId: EXEMPT_RATE });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ lineIds: ["L1"], taxRateId: EXEMPT_RATE, taxRatePercent: 0, journalLinesNamed: 1, filing: "requeued" });

    const after = await journalOf("T-STUCK");
    expect(after.invoice.lines.map((l: { taxRateId: string | null; taxRatePercent: number }) => [l.taxRatePercent, l.taxRateId])).toEqual([[0, EXEMPT_RATE]]);
    expect(moneyOnly(after.lines)).toEqual(moneyOnly(before.lines));
    expect(after.lines.filter((l) => l.taxRatePercent === 0).map((l) => l.taxRateId)).toEqual([EXEMPT_RATE]);
    expect([after.entry.date, after.entry.status, after.entry.entryNo]).toEqual([before.entry.date, before.entry.status, before.entry.entryNo]);
    expect(after.invoice.totals).toEqual(before.invoice.totals);
    expect((await call("GET", "/financial-reports/trial-balance")).body.grandTotals).toEqual(trialBefore);

    const submission = await submissionOf(after.invoice.docNo);
    expect(submission.status).toBe("ready");
    expect((submission.prevalidation ?? []).filter((f: { code: string }) => f.code === "TAX_SUBTYPE_NOT_MAPPED")).toEqual([]);
    const payload = (await call("GET", `/eta/submissions/${submission.id}`)).body.payload;
    expect(payload.invoiceLines[0].taxableItems[0].subType).toBe("V003");
  });

  it("refuses to move the line on to another rate, or to name it twice", async () => {
    const other = await classify("T-STUCK", "L1", { taxRateId: EXPORT_RATE });
    expect([other.status, other.body.error]).toEqual([409, "TAX_RATE_ALREADY_CLASSIFIED"]);
    const again = await classify("T-STUCK", "L1", { taxRateId: EXEMPT_RATE });
    expect(again.status).toBe(409);
    expect((await journalOf("T-STUCK")).invoice.lines[0].taxRateId).toBe(EXEMPT_RATE);
  });

  it("leaves an audit row naming the actor and the line's tax before and after", async () => {
    const events = rowsOf((await call("GET", "/audit?stream=sensitive&entityType=SALES_INVOICE&entityId=T-STUCK&action=CLASSIFY_LINE_TAX")).body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor: "USER-ADMIN",
      severity: "WARNING",
      details: { lineIds: ["L1"], before: { taxRateId: null, taxRatePercent: 0 }, after: { taxRateId: EXEMPT_RATE, taxRatePercent: 0 }, journalLinesNamed: 1, filing: "requeued" },
    });
  });

  it("needs its own permission — viewing, confirming and voiding invoices do not carry it", async () => {
    await sale("T-PERM", NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: null, taxRatePercent: 0 })]);
    await call("POST", "/sales-invoices/T-PERM/confirm", {});
    const refused = await classify("T-PERM", "L1", { taxRateId: EXEMPT_RATE }, ["sales.invoice.view", "sales.invoice.confirm", "sales.invoice.void", "accounting.tax.view"]);
    expect(refused.status).toBe(403);
    const allowed = await classify("T-PERM", "L1", { taxRateId: EXEMPT_RATE }, ["sales.invoice.classify_tax", "sales.invoice.view"]);
    expect(allowed.status).toBe(200);
  });

  it("is refused on a draft, for a line the invoice does not carry, and for an inactive rate", async () => {
    await sale("T-DRAFT", NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: null, taxRatePercent: 0 })]);
    const draft = await classify("T-DRAFT", "L1", { taxRateId: EXEMPT_RATE });
    expect([draft.status, draft.body.error]).toEqual([409, "TAX_CLASSIFICATION_NOT_POSTED"]);
    await call("POST", "/sales-invoices/T-DRAFT/confirm", {});
    const missing = await classify("T-DRAFT", "L9", { taxRateId: EXEMPT_RATE });
    expect([missing.status, missing.body.error]).toEqual([404, "DOCUMENT_LINE_NOT_FOUND"]);
    await call("POST", "/tax-rates", { id: "T-OLD-ZERO", code: "T-OLD-ZERO", name: "صفر موقوفة", rate: 0, etaSubType: "V003" });
    expect((await call("PATCH", "/tax-rates/T-OLD-ZERO", { status: "inactive" })).body.status).toBe("inactive");
    const inactive = await classify("T-DRAFT", "L1", { taxRateId: "T-OLD-ZERO" });
    expect([inactive.status, inactive.body.error]).toEqual([422, "TAX_RATE_INACTIVE"]);
  });

  it("classifies an invoice's unnamed lines at one percent together, only once the request names every one of them", async () => {
    await sale("T-SHARED", NOT_EXEMPT_CUSTOMER, [
      serviceLine("L1", { taxRateId: null, taxRatePercent: 0 }),
      serviceLine("L2", { taxRateId: null, taxRatePercent: 0, unitPrice: "50" }),
      serviceLine("L3", { taxRateId: VAT_RATE }),
    ]);
    await call("POST", "/sales-invoices/T-SHARED/confirm", {});
    const alone = await classify("T-SHARED", "L1", { taxRateId: EXPORT_RATE });
    expect([alone.status, alone.body.error, alone.body.sharedLineIds]).toEqual([409, "TAX_CLASSIFICATION_SHARED_POSTING", ["L2"]]);
    expect((await journalOf("T-SHARED")).invoice.lines.map((l: { taxRateId: string | null }) => l.taxRateId)).toEqual([null, null, VAT_RATE]);

    const together = await classify("T-SHARED", "L1", { taxRateId: EXPORT_RATE, withLineIds: ["L2"] });
    expect([together.status, together.body.lineIds, together.body.journalLinesNamed]).toEqual([200, ["L1", "L2"], 1]);
    const { invoice, lines } = await journalOf("T-SHARED");
    expect(invoice.lines.map((l: { taxRateId: string | null }) => l.taxRateId)).toEqual([EXPORT_RATE, EXPORT_RATE, VAT_RATE]);
    expect(lines.filter((l) => l.taxRatePercent !== null).map((l) => [l.credit, l.taxRatePercent, l.taxRateId])).toEqual(
      expect.arrayContaining([["150.000000", 0, EXPORT_RATE], ["100.000000", 14, VAT_RATE], ["14.000000", 14, VAT_RATE]]),
    );
  });

  it("moves a legacy 14% line off the VAT return's unnamed row onto the named one, to the piastre", async () => {
    const day = "2026-08-12";
    await sale("T-LEGACY", NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: null, taxRatePercent: 14, unitPrice: "300" })], { date: day });
    await call("POST", "/sales-invoices/T-LEGACY/confirm", {});
    const outputOf = (rows: Awaited<ReturnType<typeof vatRowsOn>>, taxRateId: string | null) =>
      rows.filter((r) => r.side === "output" && r.taxRateId === taxRateId && Number(r.tax) > 0).map((r) => [r.base, r.tax]);
    const before = await vatRowsOn(day);
    const unnamedBefore = outputOf(before, null);
    expect(unnamedBefore).toHaveLength(1);

    const done = await classify("T-LEGACY", "L1", { taxRateId: VAT_RATE });
    expect([done.status, done.body.journalLinesNamed]).toEqual([200, 2]);

    const after = await vatRowsOn(day);
    const total = (rows: typeof before, key: "base" | "tax") => rows.filter((r) => r.side === "output").reduce((sum, r) => sum + Math.round(Number(r[key]) * 100), 0);
    expect([total(after, "base"), total(after, "tax")]).toEqual([total(before, "base"), total(before, "tax")]);
    const moved = (key: 0 | 1) => Math.round(Number(unnamedBefore[0]![key]) * 100) - Math.round(Number(outputOf(after, null)[0]?.[key] ?? 0) * 100);
    expect([moved(0), moved(1)]).toEqual([30000, 4200]);
  });

  it("issues the e-receipt a consumer sale was refused for its unnamed 0% line, once the line is classified", async () => {
    await call("POST", "/customers", { id: "T-CONSUMER", code: "T-CONSUMER", nameAr: "مستهلك", etaBuyerType: "individual" });
    const coded = await call("PUT", "/eta/item-mappings/ITEM-DEMO-10", { etaItemCode: "EG-311222333-10", etaCodeType: "EGS" });
    expect(coded.status).toBe(200);
    await sale("T-B2C", "T-CONSUMER", [serviceLine("L1", { taxRateId: null, taxRatePercent: 0 })]);
    const confirmed = await call("POST", "/sales-invoices/T-B2C/confirm", {});
    expect(confirmed.status).toBe(200);
    expect(await submissionOf(docNoOf(confirmed))).toBeNull();

    const done = await classify("T-B2C", "L1", { taxRateId: EXEMPT_RATE });
    expect([done.status, done.body.filing]).toEqual([200, "not_queued"]);
    const receipt = await submissionOf(docNoOf(confirmed));
    expect(receipt?.documentType).toBe("receipt");
    const payload = (await call("GET", `/eta/submissions/${receipt.id}`)).body.payload;
    expect((payload.itemData ?? payload.invoiceLines)[0].taxableItems[0].subType).toBe("V003");
  });

  it("allows a classification an issued e-receipt already declares, and refuses one it contradicts — writing nothing", async () => {
    await sale("T-FILED", "T-CONSUMER", [serviceLine("L1", { taxRateId: null, taxRatePercent: 14 })]);
    const confirmed = await call("POST", "/sales-invoices/T-FILED/confirm", {});
    expect((await submissionOf(docNoOf(confirmed)))?.documentType).toBe("receipt");
    await sale("T-FILED-2", "T-CONSUMER", [serviceLine("L1", { taxRateId: null, taxRatePercent: 14 })]);
    await call("POST", "/sales-invoices/T-FILED-2/confirm", {});
    await backend.drain();

    const consistent = await classify("T-FILED", "L1", { taxRateId: VAT_RATE });
    expect([consistent.status, consistent.body.filing]).toEqual([200, "filed_consistent"]);

    const table = await call("POST", "/tax-rates", { id: "T-TABLE14", code: "T-TABLE14", name: "جدول 14", rate: 14, etaSubType: "V003" });
    expect(table.status).toBe(201);
    const before = await journalOf("T-FILED-2");
    const contradicting = await classify("T-FILED-2", "L1", { taxRateId: "T-TABLE14" });
    await call("PATCH", "/tax-rates/T-TABLE14", { status: "inactive" });
    expect([contradicting.status, contradicting.body.error]).toEqual([409, "TAX_CLASSIFICATION_ALREADY_FILED"]);
    const after = await journalOf("T-FILED-2");
    expect(after.invoice.lines[0].taxRateId).toBeNull();
    expect(after.lines).toEqual(before.lines);
  });

  it("leaves an excluded e-invoice excluded, with its reason, and says it was not queued", async () => {
    await sale("T-EXCLUDED", NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: null, taxRatePercent: 0 })]);
    const confirmed = await call("POST", "/sales-invoices/T-EXCLUDED/confirm", {});
    const queued = await submissionOf(docNoOf(confirmed));
    const reason = "خارج النطاق — قرار المحاسب";
    expect((await call("POST", `/eta/submissions/${queued.id}/exclude`, { reason })).status).toBe(200);

    const done = await classify("T-EXCLUDED", "L1", { taxRateId: EXEMPT_RATE });
    expect([done.status, done.body.filing]).toEqual([200, "not_queued"]);
    const after = await submissionOf(docNoOf(confirmed));
    expect([after.status, after.exclusionReason]).toEqual(["excluded", reason]);
  });

  it("is refused once the VAT return covering the entry's date is filed", async () => {
    await sale("T-JULY", NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: null, taxRatePercent: 0 })], { date: "2026-07-10", dueDate: "2026-08-10" });
    expect((await call("POST", "/sales-invoices/T-JULY/confirm", {})).status).toBe(200);
    const filed = await call("POST", "/gl/vat-filings", { id: "T-VATF-2026-07", periodFrom: "2026-07-01", periodTo: "2026-07-31", netAmount: "0.00" });
    expect(filed.status).toBe(201);
    const refused = await classify("T-JULY", "L1", { taxRateId: EXEMPT_RATE });
    expect([refused.status, refused.body.error]).toEqual([422, "VAT_PERIOD_ALREADY_FILED"]);
    expect(refused.body.message).toMatch(/[؀-ۿ]/);
    expect((await journalOf("T-JULY")).invoice.lines[0].taxRateId).toBeNull();
  });
});

describe("converting a quote whose lines stored no tax rate", () => {
  const quote = async (id: string, lines: readonly Record<string, unknown>[]) => {
    const created = await call("POST", "/sales-quotes", { id, date: TODAY, expiryDate: "2026-09-23", customerId: NOT_EXEMPT_CUSTOMER, customerNameAr: "عميل", branchId: BRANCH, lines });
    expect(created.status).toBe(201);
    await call("POST", `/sales-quotes/${id}/send`, {});
    await call("POST", `/sales-quotes/${id}/accept`, {});
  };
  const quoteLine = (lineId: string, over: Record<string, unknown>) => ({ lineId, itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", ...over });
  const convert = (id: string, invoiceId: string, lines: readonly Record<string, unknown>[]) =>
    call("POST", `/sales-quotes/${id}/convert-to-invoice`, {
      id: invoiceId, dueDate: "2026-09-23", warehouseId: WAREHOUSE, arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: lines.map((l) => ({ isStock: false, revenueAccountId: REVENUE, ...l })),
    });

  it("carries a NULL line as NULL when the convert names nothing, and names it when the convert does", async () => {
    await quote("T-QT-NULL", [quoteLine("QL1", { taxRateId: null, taxRatePercent: 14 }), quoteLine("QL2", { taxRateId: null, taxRatePercent: 0 })]);
    const named = await convert("T-QT-NULL", "T-QT-NULL-INV", [{ lineId: "QL1", taxRateId: VAT_RATE }, { lineId: "QL2" }]);
    expect(named.status).toBe(201);
    expect(taxOf(await call("GET", "/sales-invoices/T-QT-NULL-INV"))).toEqual([[14, VAT_RATE], [0, null]]);
  });

  it("refuses a rate at another percent and a rate other than the one the quote line already names, and leaves the quote convertible", async () => {
    await quote("T-QT-MIX", [quoteLine("QL1", { taxRateId: null, taxRatePercent: 14 }), quoteLine("QL2", { taxRateId: EXEMPT_RATE })]);
    const repriced = await convert("T-QT-MIX", "T-QT-MIX-INV", [{ lineId: "QL1", taxRateId: EXEMPT_RATE }, { lineId: "QL2" }]);
    expect([repriced.status, repriced.body.error]).toEqual([422, "TAX_RATE_CLASSIFICATION_PERCENT_MISMATCH"]);
    const swapped = await convert("T-QT-MIX", "T-QT-MIX-INV", [{ lineId: "QL1" }, { lineId: "QL2", taxRateId: EXPORT_RATE }]);
    expect([swapped.status, swapped.body.error]).toEqual([409, "TAX_RATE_ALREADY_CLASSIFIED"]);
    expect((await call("GET", "/sales-invoices/T-QT-MIX-INV")).status).toBe(404);
    const ok = await convert("T-QT-MIX", "T-QT-MIX-INV", [{ lineId: "QL1", taxRateId: VAT_RATE }, { lineId: "QL2", taxRateId: EXEMPT_RATE }]);
    expect(ok.status).toBe(201);
    expect(taxOf(await call("GET", "/sales-invoices/T-QT-MIX-INV"))).toEqual([[14, VAT_RATE], [0, EXEMPT_RATE]]);
  });
});

describe("classifying the tax of a posted purchase line that stored none", () => {
  const SUPPLIER = "SUPP-DEMO-1";
  const classify = (invoiceId: string, lineIndex: string, body: Record<string, unknown>, permissions?: readonly string[]) =>
    call("POST", `/purchases/invoices/${invoiceId}/lines/${lineIndex}/classify-tax`, body, permissions);
  const purchase = async (id: string, lines: readonly Record<string, unknown>[]) => {
    const created = await call("POST", "/purchases/invoices", { id, supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: BRANCH, warehouseId: WAREHOUSE, lines });
    expect(created.status).toBe(201);
    expect((await call("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
  };
  const expense = (over: Record<string, unknown>) => ({ itemId: null, kind: "expense", description: "خدمة", qty: "1", unitCost: "200", ...over });
  const entryOf = async (id: string) =>
    ((await call("GET", `/gl/journal-entries/${encodeURIComponent(`PI-JE:${id}`)}`)).body.lines ?? []) as { accountId: string; debit: string; credit: string; taxRatePercent: number | null; taxRateId: string | null }[];

  it("names a 0% line and a legacy 14% line, tags the journal's cost and input-VAT lines, and moves no amount", async () => {
    await purchase("T-PI", [expense({ taxRateId: null, taxRatePercent: 0 }), expense({ taxRateId: null, taxRatePercent: 14, unitCost: "100" })]);
    const before = await entryOf("T-PI");
    expect(before.filter((l) => l.taxRatePercent !== null).map((l) => l.taxRateId)).toEqual([null, null, null]);

    const zero = await classify("T-PI", "0", { taxRateId: EXEMPT_RATE });
    expect([zero.status, zero.body.lineIds, zero.body.journalLinesNamed]).toEqual([200, ["0"], 1]);
    const taxed = await classify("T-PI", "1", { taxRateId: VAT_RATE });
    expect([taxed.status, taxed.body.journalLinesNamed]).toEqual([200, 2]);

    const invoice = (await call("GET", "/purchases/invoices/T-PI")).body;
    expect(invoice.lines.map((l: { taxRatePercent: number; taxRateId: string | null }) => [l.taxRatePercent, l.taxRateId])).toEqual([[0, EXEMPT_RATE], [14, VAT_RATE]]);
    const after = await entryOf("T-PI");
    expect(after.map((l) => [l.accountId, l.debit, l.credit, l.taxRatePercent])).toEqual(before.map((l) => [l.accountId, l.debit, l.credit, l.taxRatePercent]));
    expect(after.filter((l) => l.taxRatePercent === 0).map((l) => l.taxRateId)).toEqual([EXEMPT_RATE]);
    expect(after.filter((l) => l.taxRatePercent === 14).map((l) => l.taxRateId)).toEqual([VAT_RATE, VAT_RATE]);
  });

  it("refuses another percent, a second rate, a draft and a caller without the permission; and audits the change", async () => {
    const repriced = await classify("T-PI", "0", { taxRateId: EXPORT_RATE });
    expect([repriced.status, repriced.body.error]).toEqual([409, "TAX_RATE_ALREADY_CLASSIFIED"]);

    await purchase("T-PI-2", [expense({ taxRateId: null, taxRatePercent: 14 })]);
    const mismatch = await classify("T-PI-2", "0", { taxRateId: EXEMPT_RATE });
    expect([mismatch.status, mismatch.body.error]).toEqual([422, "TAX_RATE_CLASSIFICATION_PERCENT_MISMATCH"]);
    const forbidden = await classify("T-PI-2", "0", { taxRateId: VAT_RATE }, ["purchases.invoice.view", "purchases.invoice.confirm", "purchases.invoice.void"]);
    expect(forbidden.status).toBe(403);
    expect((await call("GET", "/purchases/invoices/T-PI-2")).body.lines[0].taxRateId).toBeNull();

    await call("POST", "/purchases/invoices", { id: "T-PI-DRAFT", supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: BRANCH, warehouseId: WAREHOUSE, lines: [expense({ taxRateId: null, taxRatePercent: 0 })] });
    const draft = await classify("T-PI-DRAFT", "0", { taxRateId: EXEMPT_RATE });
    expect([draft.status, draft.body.error]).toEqual([409, "TAX_CLASSIFICATION_NOT_POSTED"]);

    const events = rowsOf((await call("GET", "/audit?stream=sensitive&entityType=PURCHASE_INVOICE&entityId=T-PI&action=CLASSIFY_LINE_TAX")).body);
    expect(events.map((e) => [e.actor, e.details.lineIds, e.details.before.taxRateId, e.details.after.taxRateId]).sort()).toEqual(
      [["USER-ADMIN", ["0"], null, EXEMPT_RATE], ["USER-ADMIN", ["1"], null, VAT_RATE]].sort(),
    );
  });
});

describe("who in the seeded tenant may classify (D79 round 5)", () => {
  async function signIn(username: string) {
    const res = await backend.app.fetch(
      new Request("http://local/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, pin: "123456" }) }),
    );
    return { status: res.status, body: (await res.json()) as { token: string; permissions: string[] } };
  }
  const as = async (bearer: string, method: string, path: string, body?: unknown) => {
    const res = await backend.app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, "x-branch-scope": "*", "x-warehouse-scope": "*" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as { taxRateId?: string } };
  };

  it.each([
    ["the accountant", "mona.abdelrahman@cyag.example"],
    ["the finance manager", "tarek.mansour@cyag.example"],
  ])("%s holds both classify permissions and classifies a posted sales and purchase line", async (_label, email) => {
    const session = await signIn(email);
    expect(session.status).toBe(200);
    expect(session.body.permissions).toEqual(expect.arrayContaining(["sales.invoice.classify_tax", "purchases.invoice.classify_tax"]));

    const tag = email.split(".")[0]!.toUpperCase();
    await sale(`T-SEEDED-${tag}`, NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: null, taxRatePercent: 0 })]);
    await call("POST", `/sales-invoices/T-SEEDED-${tag}/confirm`, {});
    const sold = await as(session.body.token, "POST", `/sales-invoices/T-SEEDED-${tag}/lines/L1/classify-tax`, { taxRateId: EXEMPT_RATE });
    expect([sold.status, sold.body.taxRateId]).toEqual([200, EXEMPT_RATE]);

    await call("POST", "/purchases/invoices", {
      id: `T-PI-SEEDED-${tag}`, supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: BRANCH, warehouseId: WAREHOUSE,
      lines: [{ itemId: null, kind: "expense", description: "خدمة", qty: "1", unitCost: "200", taxRateId: null, taxRatePercent: 0 }],
    });
    await call("POST", `/purchases/invoices/T-PI-SEEDED-${tag}/confirm`, {});
    const bought = await as(session.body.token, "POST", `/purchases/invoices/T-PI-SEEDED-${tag}/lines/0/classify-tax`, { taxRateId: EXEMPT_RATE });
    expect([bought.status, bought.body.taxRateId]).toEqual([200, EXEMPT_RATE]);
  });

  it("does not hand the permission to a sales representative", async () => {
    const session = await signIn("karim.fouad@cyag.example");
    expect(session.status).toBe(200);
    expect(session.body.permissions).not.toContain("sales.invoice.classify_tax");
  });
});

describe("re-rating a tax rate while a document starts naming it (D79 round 5)", () => {
  it.each([
    ["re-rate first", true],
    ["sale first", false],
  ])("never leaves a line naming a rate at a percent the rate no longer has (%s)", async (_label, patchFirst) => {
    const id = patchFirst ? "T-RERATE-A" : "T-RERATE-B";
    expect((await call("POST", "/tax-rates", { id, code: id, name: `صفري ${id}`, rate: 0, etaSubType: "V002" })).status).toBe(201);
    const rerate = () => call("PATCH", `/tax-rates/${id}`, { rate: 5 });
    const selling = () => sale(`${id}-SALE`, NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: id })]);
    const [first, second] = await Promise.all(patchFirst ? [rerate(), selling()] : [selling(), rerate()]);
    const patched = patchFirst ? first : second;
    const sold = patchFirst ? second : first;
    expect([200, 409]).toContain(patched.status);
    const rate = (await call("GET", `/tax-rates/${id}`)).body.rate as number;
    if (sold.status === 201) {
      expect((await call("GET", `/sales-invoices/${id}-SALE`)).body.lines[0].taxRatePercent).toBe(rate);
    } else {
      expect(sold.status).toBe(422);
    }
    const again = await call("PATCH", `/tax-rates/${id}`, { rate: 7 });
    expect(again.status).toBe(sold.status === 201 ? 409 : 200);
  });
});

describe("two requests racing over one posted line (D79 round 5)", () => {
  type TaxLine = { accountId: string; taxRatePercent: number | null; taxRateId: string | null };
  const classify = (invoiceId: string, lineId: string, taxRateId: string) =>
    call("POST", `/sales-invoices/${invoiceId}/lines/${lineId}/classify-tax`, { taxRateId });
  const unnamedSale = async (id: string) => {
    expect((await sale(id, NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: null, taxRatePercent: 0 })])).status).toBe(201);
    expect((await call("POST", `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
  };
  const zeroTagsOf = async (entryId: string) =>
    (((await call("GET", `/gl/journal-entries/${encodeURIComponent(entryId)}`)).body.lines ?? []) as TaxLine[]).filter((l) => l.taxRatePercent === 0).map((l) => l.taxRateId);
  const lineRateOf = async (id: string) => (await call("GET", `/sales-invoices/${id}`)).body.lines[0].taxRateId as string | null;

  it("lets exactly one of two classifications to different rates win, and the line and its journal agree", async () => {
    await unnamedSale("T-RACE-2");
    const replies = await Promise.all([classify("T-RACE-2", "L1", EXEMPT_RATE), classify("T-RACE-2", "L1", EXPORT_RATE)]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = replies.find((r) => r.status === 200)!.body.taxRateId;
    expect(replies.find((r) => r.status === 409)!.body.message).toMatch(/[؀-ۿ]/);
    expect(await lineRateOf("T-RACE-2")).toBe(winner);
    expect(await zeroTagsOf("T-RACE-2")).toEqual([winner]);
    const events = rowsOf((await call("GET", "/audit?stream=sensitive&entityType=SALES_INVOICE&entityId=T-RACE-2&action=CLASSIFY_LINE_TAX")).body);
    expect(events.map((e) => e.details.after.taxRateId)).toEqual([winner]);
  });

  it.each([
    ["void first", "T-RACE-VOID-A", true],
    ["classify first", "T-RACE-VOID-B", false],
  ])("keeps the invoice line, its entry and the void's reversal on ONE classification when a void races it (%s)", async (_label, id, voidFirst) => {
    await unnamedSale(id);
    const voiding = () => call("POST", `/sales-invoices/${id}/void`, { reason: "سباق" });
    const [first, second] = await Promise.all(voidFirst ? [voiding(), classify(id, "L1", EXEMPT_RATE)] : [classify(id, "L1", EXEMPT_RATE), voiding()]);
    const voided = voidFirst ? first : second;
    expect(voided.status).toBe(200);
    const lineRate = await lineRateOf(id);
    expect(await zeroTagsOf(id)).toEqual([lineRate]);
    expect(await zeroTagsOf(`${id}:void`)).toEqual([lineRate]);
  });

  it.each([
    ["collection first", "T-RACE-PAY-A", true],
    ["classify first", "T-RACE-PAY-B", false],
  ])("keeps both a collection and a classification that race each other (%s)", async (_label, id, payFirst) => {
    await unnamedSale(id);
    const paying = () => call("POST", `/sales-invoices/${id}/payments`, { amount: "40", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash" });
    const replies = await Promise.all(payFirst ? [paying(), classify(id, "L1", EXEMPT_RATE)] : [classify(id, "L1", EXEMPT_RATE), paying()]);
    expect(replies.map((r) => r.status)).toEqual([200, 200]);
    const invoice = (await call("GET", `/sales-invoices/${id}`)).body;
    expect([invoice.status, invoice.amountPaid, invoice.lines[0].taxRateId]).toEqual(["partially_paid", "40.000000", EXEMPT_RATE]);
    expect(await zeroTagsOf(id)).toEqual([EXEMPT_RATE]);
  });

  it("does the same for a purchase invoice: one of two classifications wins and the journal follows the line", async () => {
    const created = await call("POST", "/purchases/invoices", {
      id: "T-PI-RACE", supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: BRANCH, warehouseId: WAREHOUSE,
      lines: [{ itemId: null, kind: "expense", description: "خدمة", qty: "1", unitCost: "200", taxRateId: null, taxRatePercent: 0 }],
    });
    expect(created.status).toBe(201);
    expect((await call("POST", "/purchases/invoices/T-PI-RACE/confirm", {})).status).toBe(200);
    const pc = (taxRateId: string) => call("POST", "/purchases/invoices/T-PI-RACE/lines/0/classify-tax", { taxRateId });
    const replies = await Promise.all([pc(EXEMPT_RATE), pc(EXPORT_RATE)]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = replies.find((r) => r.status === 200)!.body.taxRateId;
    expect((await call("GET", "/purchases/invoices/T-PI-RACE")).body.lines[0].taxRateId).toBe(winner);
    expect(await zeroTagsOf("PI-JE:T-PI-RACE")).toEqual([winner]);
  });
});

describe("a filed VAT return closes classification on the purchase side too", () => {
  it("refuses to classify a purchase line once the return covering its entry's date is filed, and writes nothing", async () => {
    const created = await call("POST", "/purchases/invoices", {
      id: "T-PI-JUNE", supplierId: "SUPP-DEMO-1", date: "2026-06-10", dueDate: "2026-07-10", branchId: BRANCH, warehouseId: WAREHOUSE,
      lines: [{ itemId: null, kind: "expense", description: "خدمة", qty: "1", unitCost: "200", taxRateId: null, taxRatePercent: 0 }],
    });
    expect(created.status).toBe(201);
    expect((await call("POST", "/purchases/invoices/T-PI-JUNE/confirm", {})).status).toBe(200);
    const filed = await call("POST", "/gl/vat-filings", { id: "T-VATF-2026-06", periodFrom: "2026-06-01", periodTo: "2026-06-30", netAmount: "0.00" });
    expect(filed.status).toBe(201);

    const refused = await call("POST", "/purchases/invoices/T-PI-JUNE/lines/0/classify-tax", { taxRateId: EXEMPT_RATE });
    expect([refused.status, refused.body.error]).toEqual([422, "VAT_PERIOD_ALREADY_FILED"]);
    expect((await call("GET", "/purchases/invoices/T-PI-JUNE")).body.lines[0].taxRateId).toBeNull();
    const entry = (await call("GET", `/gl/journal-entries/${encodeURIComponent("PI-JE:T-PI-JUNE")}`)).body;
    expect((entry.lines as { taxRateId: string | null }[]).every((l) => l.taxRateId === null)).toBe(true);
  });
});

describe("what a return form may still take from an invoice is the server's figure", () => {
  it("serves each line's sold and already-returned quantity, moved only by CONFIRMED returns, and answers 409 to a second confirm", async () => {
    const stock = (lineId: string, qty: string) => ({
      lineId, itemId: "ITEM-DEMO-2", itemNameAr: "صنف", isStock: true, qty, unitPrice: "100", taxRateId: VAT_RATE,
      revenueAccountId: REVENUE, cogsAccountId: "5100", inventoryAccountId: "1200",
    });
    await sale("T-RET-SRC", NOT_EXEMPT_CUSTOMER, [stock("L1", "3"), stock("L2", "2")]);
    expect((await call("POST", "/sales-invoices/T-RET-SRC/confirm", {})).status).toBe(200);
    const sourceLines = async () => (await call("GET", "/sales-returns/source-lines/T-RET-SRC")).body.lines.map((l: { sourceLineId: string; soldQty: string; returnedQty: string }) => [l.sourceLineId, Number(l.soldQty), Number(l.returnedQty)]);
    expect(await sourceLines()).toEqual([["L1", 3, 0], ["L2", 2, 0]]);

    const draft = await call("POST", "/sales-returns/from-invoice", { id: "T-RET-1", date: TODAY, memo: "t", warehouseId: WAREHOUSE, sourceInvoiceId: "T-RET-SRC", reason: "DEFECTIVE", requested: [{ itemId: "ITEM-DEMO-2", sourceLineId: "L1", qty: "3" }] });
    expect(draft.status).toBe(201);
    expect(await sourceLines()).toEqual([["L1", 3, 0], ["L2", 2, 0]]);
    expect((await call("POST", "/sales-returns/T-RET-1/confirm", {})).status).toBe(200);
    expect(await sourceLines()).toEqual([["L1", 3, 3], ["L2", 2, 0]]);

    const again = await call("POST", "/sales-returns/T-RET-1/confirm", {});
    expect([again.status, again.body.error]).toEqual([409, "INVALID_DOCUMENT_TRANSITION"]);

    expect((await call("GET", "/sales-returns/source-lines/NOPE")).status).toBe(404);
    expect((await call("GET", "/sales-returns/source-lines/T-RET-SRC", undefined, ["sales.return.view"])).status).toBe(403);
  });

  it("does the same for a purchase invoice, whose lines are named by position", async () => {
    await call("POST", "/purchases/invoices", { id: "T-PRET-SRC", supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: BRANCH, warehouseId: WAREHOUSE, lines: [{ itemId: "ITEM-DEMO-2", kind: "inventory", qty: "4", unitCost: "72", taxRateId: VAT_RATE }] });
    expect((await call("POST", "/purchases/invoices/T-PRET-SRC/confirm", {})).status).toBe(200);
    const sourceLines = async () => (await call("GET", "/purchase-returns/source-lines/T-PRET-SRC")).body.lines.map((l: { sourceLineId: string; soldQty: string; returnedQty: string }) => [l.sourceLineId, Number(l.soldQty), Number(l.returnedQty)]);
    expect(await sourceLines()).toEqual([["0", 4, 0]]);
    const draft = await call("POST", "/purchase-returns", { id: "T-PRET-1", date: TODAY, memo: "t", lines: [{ itemId: "ITEM-DEMO-2", warehouseId: WAREHOUSE, supplierId: "SUPP-DEMO-1", sourceInvoiceId: "T-PRET-SRC", sourceInvoiceNumber: null, sourceLineId: "0", reason: "DEFECTIVE", qty: "1" }] });
    expect(draft.status).toBe(201);
    expect((await call("POST", "/purchase-returns/T-PRET-1/confirm", {})).status).toBe(200);
    expect(await sourceLines()).toEqual([["0", 4, 1]]);
    const again = await call("POST", "/purchase-returns/T-PRET-1/confirm", {});
    expect([again.status, again.body.error]).toEqual([409, "INVALID_DOCUMENT_TRANSITION"]);
  });
});

describe("a return form's source lines follow the invoice's own visibility (D79 round 5)", () => {
  it("hides a sales invoice's lines from a caller who may only see their own invoices, as the invoice read does", async () => {
    const own = ["sales.return.create", "sales.invoice.view_own"];
    expect((await call("GET", "/sales-invoices/T-RET-SRC", undefined, own)).status).toBe(404);
    expect((await call("GET", "/sales-returns/source-lines/T-RET-SRC", undefined, own)).status).toBe(404);
    expect((await call("GET", "/sales-returns/source-lines/T-RET-SRC", undefined, ["sales.return.create"])).status).toBe(404);
    expect((await call("GET", "/sales-returns/source-lines/T-RET-SRC", undefined, ["sales.return.create", "sales.invoice.view"])).status).toBe(200);
  });

  it("hides a purchase invoice's lines from a caller who did not enter it and may only see their own", async () => {
    const own = ["purchases.return.create", "purchases.invoice.view_own"];
    expect((await call("GET", "/purchases/invoices/T-PRET-SRC", undefined, own)).status).toBe(404);
    expect((await call("GET", "/purchase-returns/source-lines/T-PRET-SRC", undefined, own)).status).toBe(404);
    expect((await call("GET", "/purchase-returns/source-lines/T-PRET-SRC", undefined, ["purchases.return.create"])).status).toBe(404);
    expect((await call("GET", "/purchase-returns/source-lines/T-PRET-SRC", undefined, ["purchases.return.create", "purchases.invoice.view"])).status).toBe(200);
  });
});

describe("the tenant's VAT switch reaches every path that raises a sale (D79 round 5)", () => {
  const quoteLines = [
    { lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", taxRatePercent: 0, taxRateId: null },
    { lineId: "B", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", taxRateId: VAT_RATE },
  ];
  const quote = (id: string) =>
    call("POST", "/sales-quotes", { id, date: TODAY, expiryDate: "2026-09-30", customerId: NOT_EXEMPT_CUSTOMER, customerNameAr: "عميل", branchId: BRANCH, lines: quoteLines });
  const accept = async (id: string) => {
    for (const action of ["send", "accept"]) expect((await call("POST", `/sales-quotes/${id}/${action}`, {})).status).toBe(200);
  };
  const convert = (quoteId: string, id: string) =>
    call("POST", `/sales-quotes/${quoteId}/convert-to-invoice`, {
      id, dueDate: "2026-09-30", warehouseId: WAREHOUSE, arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: quoteLines.map((l) => ({ lineId: l.lineId, isStock: false, revenueAccountId: REVENUE })),
    });
  const setVat = async (taxEnabled: boolean) => {
    const settings = (await call("GET", "/settings")).body;
    expect((await call("PUT", "/settings", { ...settings, taxEnabled })).status).toBe(200);
  };

  it("zero-rates a quote raised, and a quote converted, while VAT is off — under the system rate, posting no VAT", async () => {
    expect((await quote("T-QT-BEFORE-OFF")).status).toBe(201);
    await accept("T-QT-BEFORE-OFF");
    await setVat(false);
    try {
      const raised = await quote("T-QT-VAT-OFF");
      expect([raised.status, taxOf(raised)]).toEqual([201, [[0, SYSTEM_RATE], [0, SYSTEM_RATE]]]);
      await accept("T-QT-VAT-OFF");

      const converted = await convert("T-QT-BEFORE-OFF", "T-INV-CONVERTED-OFF");
      expect(converted.status).toBe(201);
      const drafted = await call("GET", "/sales-invoices/T-INV-CONVERTED-OFF");
      expect(taxOf(drafted)).toEqual([[0, SYSTEM_RATE], [0, SYSTEM_RATE]]);
      expect(drafted.body.totals.taxTotal).toBe("0.000000");
      const confirmed = await call("POST", "/sales-invoices/T-INV-CONVERTED-OFF/confirm", {});
      expect(confirmed.status).toBe(200);
      const invoice = (await call("GET", "/sales-invoices/T-INV-CONVERTED-OFF")).body;
      const entry = (await call("GET", `/gl/journal-entries/${invoice.journalEntryId}`)).body;
      expect((entry.lines as { accountId: string }[]).some((l) => l.accountId === OUTPUT_TAX)).toBe(false);
    } finally {
      await setVat(true);
    }
  });

  it("refuses, at confirm and in Arabic, a sale that carries the system rate once VAT is on again", async () => {
    const converted = await convert("T-QT-VAT-OFF", "T-INV-STALE-SYSTEM");
    expect(converted.status).toBe(201);
    const refused = await call("POST", "/sales-invoices/T-INV-STALE-SYSTEM/confirm", {});
    expect([refused.status, refused.body.error]).toEqual([422, "INVALID_SALES_INVOICE"]);
    expect(refused.body.message).toMatch(/غير خاضع/);
    expect((await call("GET", "/sales-invoices/T-INV-STALE-SYSTEM")).body.status).toBe("draft");

    const named = await sale("T-INV-NAMED-SYSTEM", NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: SYSTEM_RATE })]);
    if (named.status === 201) {
      const second = await call("POST", "/sales-invoices/T-INV-NAMED-SYSTEM/confirm", {});
      expect([second.status, second.body.error]).toEqual([422, "INVALID_SALES_INVOICE"]);
    } else {
      expect(named.status).toBe(422);
    }
  });

  it("refuses to classify a posted line under the system rate while VAT is on", async () => {
    await sale("T-INV-CLASSIFY-SYSTEM", NOT_EXEMPT_CUSTOMER, [serviceLine("L1", { taxRateId: null, taxRatePercent: 0 })]);
    await call("POST", "/sales-invoices/T-INV-CLASSIFY-SYSTEM/confirm", {});
    const refused = await call("POST", "/sales-invoices/T-INV-CLASSIFY-SYSTEM/lines/L1/classify-tax", { taxRateId: SYSTEM_RATE });
    expect([refused.status, refused.body.error]).toEqual([422, "TAX_RATE_SYSTEM_ONLY"]);
    expect(refused.body.message).toMatch(/[؀-ۿ]/);
    expect((await call("GET", "/sales-invoices/T-INV-CLASSIFY-SYSTEM")).body.lines[0].taxRateId).toBeNull();
  });
});
