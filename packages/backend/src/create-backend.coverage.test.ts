import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import type { App, SessionRegistry } from "@mezan/api";
import { createBackend, type BackendHandle } from "./create-backend.js";

/**
 * Closes the branch-coverage gaps in `resolveReconciliationControls()` and
 * `collectOpenPartyDocuments()` (create-backend.ts) — the AR/AP sub-ledger
 * reconciliation sources behind `GET /reconciliation` and
 * `GET /gl/balances-by-currency`. Harness copied from create-backend.test.ts
 * (its exact request shapes), since a .test.ts file cannot be imported from.
 */

const handles: BackendHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

const registries = new WeakMap<App, SessionRegistry>();

function keep(handle: BackendHandle): App {
  handles.push(handle);
  registries.set(handle.app, handle.sessions);
  return handle.app;
}

const headerCache = new WeakMap<App, Map<string, Record<string, string>>>();

function sessionHeaders(app: App, userId: string, permissions: readonly string[]): Record<string, string> {
  const sessions = registries.get(app);
  if (!sessions) throw new Error("app was not built through newBackend()");
  const perApp = headerCache.get(app) ?? new Map<string, Record<string, string>>();
  headerCache.set(app, perApp);
  const key = `${userId}|${permissions.join(",")}`;
  const cached = perApp.get(key);
  if (cached) return cached;
  const token = sessions.issue({
    userId,
    permissions,
    roleCode: null,
    branchScope: ALL_SCOPE,
    warehouseScope: ALL_SCOPE,
  });
  const headers = { authorization: `Bearer ${token}` };
  perApp.set(key, headers);
  return headers;
}

function admin(app: App): Record<string, string> {
  return sessionHeaders(app, "admin", ["*"]);
}

async function newBackend() {
  return keep(await createBackend({ dbPath: ":memory:" }));
}

function post(app: App, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request(`http://local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function get(app: App, path: string, headers: Record<string, string> = {}) {
  return app.fetch(new Request(`http://local${path}`, { headers }));
}

async function createCustomer(app: App, id: string, creditLimit: string) {
  const res = await post(
    app,
    "/customers",
    {
      id,
      code: id,
      nameAr: `عميل ${id}`,
      paymentTermsDays: 30,
      currency: "EGP",
      openingBalance: "0",
      active: true,
      creditLimit,
      taxExempt: false,
      etaBuyerType: "auto",
    },
    admin(app),
  );
  expect(res.status).toBe(201);
}

async function createServiceItem(app: App, id = "SVC-1") {
  const res = await post(
    app,
    "/items",
    { id, code: id, nameAr: "خدمة", type: "service", baseUnitCode: "PCS" },
    admin(app),
  );
  expect(res.status).toBe(201);
}

function invoiceBody(id: string, customerId: string, unitPrice: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId,
    customerNameAr: `عميل ${customerId}`,
    warehouseId: "WH1",
    branchId: "BR1",
    arAccountId: "1105",
    taxAccountId: "2200",
    lines: [
      {
        lineId: "L1",
        itemId: "SVC-1",
        itemNameAr: "خدمة",
        isStock: false,
        qty: "1",
        unitPrice,
        taxRatePercent: 0,
        revenueAccountId: "4100",
      },
    ],
    ...extra,
  };
}

async function treasuryAccount(app: App, id: string, glAccountId: string, openingBalance = "0") {
  const res = await post(
    app,
    "/treasury-accounts",
    { id, code: id, name: "خزينة", branchId: "BR1", glAccountId, type: "cash", currency: "EGP", openingBalance },
    admin(app),
  );
  expect(res.status).toBe(201);
}

interface ReconciliationRow {
  key: string;
  subLedgerBalance: string;
  glBalance: string;
  matched: boolean;
}

async function reconciliation(app: App) {
  const res = await get(app, "/reconciliation", admin(app));
  expect(res.status).toBe(200);
  return (await res.json()) as { allMatched: boolean; rows: ReconciliationRow[] };
}

function rowFor(rows: ReconciliationRow[], key: string): ReconciliationRow {
  const row = rows.find((r) => r.key === key);
  if (!row) throw new Error(`no reconciliation row for "${key}"`);
  return row;
}

async function createVoucher(
  app: App,
  body: {
    id: string;
    voucherType: string;
    amount: string;
    treasuryAccountId: string;
    treasuryGlAccountId: string;
    counterpartyGlAccountId?: string;
    customerId?: string;
    supplierId?: string;
    counterTreasuryAccountId?: string;
    counterTreasuryGlAccountId?: string;
  },
) {
  const created = await post(
    app,
    "/vouchers",
    {
      date: "2026-08-22",
      branchId: "BR1",
      paymentMethod: "cash",
      ...body,
    },
    admin(app),
  );
  expect(created.status).toBe(201);
  const confirmed = await post(app, `/vouchers/${body.id}/confirm`, {}, admin(app));
  expect(confirmed.status).toBe(200);
  return confirmed;
}

describe("create-backend — resolveReconciliationControls follows confirmed vouchers by counterparty and direction", () => {
  it("a receipt against AR settles it, a payment against AR restores it, and a transfer moves neither", async () => {
    const app = await newBackend();
    await treasuryAccount(app, "ta-v1", "1300-1");
    await treasuryAccount(app, "ta-v2", "1310");
    await createCustomer(app, "cust-v1", "0");
    await createServiceItem(app);
    await post(app, "/suppliers", { id: "sup-v1", code: "sup-v1", nameAr: "مورد v1", currency: "EGP", openingBalance: "0" }, admin(app));

    // Non-zero opening AR/AP: a confirmed 1000 EGP invoice and a confirmed 500 EGP purchase invoice.
    await post(app, "/sales-invoices", invoiceBody("inv-v1", "cust-v1", "1000.00"), admin(app));
    expect((await post(app, "/sales-invoices/inv-v1/confirm", {}, admin(app))).status).toBe(200);
    await post(
      app,
      "/purchases/invoices",
      { id: "pi-v1", supplierId: "sup-v1", date: "2026-08-22", branchId: "BR1", warehouseId: "WH1", lines: [{ description: "إيجار", kind: "expense", qty: "1", unitCost: "500.00", taxRatePercent: 0 }] },
      admin(app),
    );
    expect((await post(app, "/purchases/invoices/pi-v1/confirm", {}, admin(app))).status).toBe(200);

    const before = await reconciliation(app);
    expect(Number(rowFor(before.rows, "ar").subLedgerBalance)).toBe(1000);
    expect(Number(rowFor(before.rows, "ap").subLedgerBalance)).toBe(500);

    // Receipt against AR (customer_collection): credits the counterparty, so AR falls.
    await createVoucher(app, {
      id: "v-collect",
      voucherType: "customer_collection",
      amount: "300.00",
      treasuryAccountId: "ta-v1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "1105",
      customerId: "cust-v1",
    });
    // Receipt against AP (supplier_refund): credits the counterparty, so AP rises.
    await createVoucher(app, {
      id: "v-suprefund",
      voucherType: "supplier_refund",
      amount: "50.00",
      treasuryAccountId: "ta-v1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "2100",
      supplierId: "sup-v1",
    });
    // Payment against AR (customer_refund): debits the counterparty, so AR rises back.
    await createVoucher(app, {
      id: "v-refund",
      voucherType: "customer_refund",
      amount: "100.00",
      treasuryAccountId: "ta-v1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "1105",
      customerId: "cust-v1",
    });
    // Payment against AP (supplier_payment): debits the counterparty, so AP falls.
    await createVoucher(app, {
      id: "v-pay",
      voucherType: "supplier_payment",
      amount: "200.00",
      treasuryAccountId: "ta-v1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "2100",
      supplierId: "sup-v1",
    });
    // A transfer between two treasuries moves neither AR nor AP.
    await createVoucher(app, {
      id: "v-transfer",
      voucherType: "inter_treasury_transfer",
      amount: "20.00",
      treasuryAccountId: "ta-v1",
      treasuryGlAccountId: "1300-1",
      counterTreasuryAccountId: "ta-v2",
      counterTreasuryGlAccountId: "1310",
    });

    const after = await reconciliation(app);
    // AR: 1000 - 300 (collection) + 100 (refund) = 800.
    const ar = rowFor(after.rows, "ar");
    expect(Number(ar.subLedgerBalance)).toBe(800);
    expect(ar.subLedgerBalance).toBe(ar.glBalance);
    expect(ar.matched).toBe(true);
    // AP: 500 + 50 (supplier refund) - 200 (supplier payment) = 350.
    const ap = rowFor(after.rows, "ap");
    expect(Number(ap.subLedgerBalance)).toBe(350);
    expect(ap.subLedgerBalance).toBe(ap.glBalance);
    expect(ap.matched).toBe(true);
    expect(after.allMatched).toBe(true);
  });
});

describe("create-backend — resolveReconciliationControls follows cheques by counterparty, direction and bounce status", () => {
  it("an incoming cheque drops AR, an outgoing cheque drops AP, and an outgoing BOUNCED cheque restores it", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-chq", "0");
    await createServiceItem(app);
    await post(app, "/suppliers", { id: "sup-chq", code: "sup-chq", nameAr: "مورد chq", currency: "EGP", openingBalance: "0" }, admin(app));

    await post(app, "/sales-invoices", invoiceBody("inv-chq", "cust-chq", "1000.00"), admin(app));
    expect((await post(app, "/sales-invoices/inv-chq/confirm", {}, admin(app))).status).toBe(200);
    await post(
      app,
      "/purchases/invoices",
      { id: "pi-chq", supplierId: "sup-chq", date: "2026-08-22", branchId: "BR1", warehouseId: "WH1", lines: [{ description: "صيانة", kind: "expense", qty: "1", unitCost: "500.00", taxRatePercent: 0 }] },
      admin(app),
    );
    expect((await post(app, "/purchases/invoices/pi-chq/confirm", {}, admin(app))).status).toBe(200);

    // Incoming cheque against AR: reduces it (net = -amount) regardless of status.
    const incoming = await post(
      app,
      "/cheques",
      {
        id: "chq-in-1",
        direction: "incoming",
        chequeNumber: "CHQ-IN-1",
        bankName: "بنك مصر",
        amount: "400.00",
        issueDate: "2026-08-01",
        dueDate: "2026-09-01",
        branchId: "BR1",
        partyId: "cust-chq",
        counterpartyGlAccountId: "1105",
        controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
      },
      admin(app),
    );
    expect(incoming.status).toBe(201);

    // Outgoing cheque against AP, left pending: reduces AP.
    const outgoingKept = await post(
      app,
      "/cheques",
      {
        id: "chq-out-1",
        direction: "outgoing",
        chequeNumber: "CHQ-OUT-1",
        bankName: "بنك مصر",
        amount: "150.00",
        issueDate: "2026-08-01",
        dueDate: "2026-09-01",
        branchId: "BR1",
        partyId: "sup-chq",
        counterpartyGlAccountId: "2100",
        controlAccounts: { underCollectionAccountId: "2150" },
      },
      admin(app),
    );
    expect(outgoingKept.status).toBe(201);

    // A second outgoing cheque against AP, deposited then BOUNCED: contributes nothing
    // (restored), so AP is NOT reduced by it.
    const outgoingBounced = await post(
      app,
      "/cheques",
      {
        id: "chq-out-2",
        direction: "outgoing",
        chequeNumber: "CHQ-OUT-2",
        bankName: "بنك مصر",
        amount: "100.00",
        issueDate: "2026-08-01",
        dueDate: "2026-09-01",
        branchId: "BR1",
        partyId: "sup-chq",
        counterpartyGlAccountId: "2100",
        controlAccounts: { underCollectionAccountId: "2150" },
      },
      admin(app),
    );
    expect(outgoingBounced.status).toBe(201);
    const deposited = await post(app, "/cheques/chq-out-2/deposit", { bankTreasuryAccountId: "ta-bank" }, admin(app));
    expect(deposited.status).toBe(200);
    const bounced = await post(app, "/cheques/chq-out-2/bounce", {}, admin(app));
    expect(bounced.status).toBe(200);
    expect(((await bounced.json()) as { status: string }).status).toBe("bounced");

    const after = await reconciliation(app);
    const ar = rowFor(after.rows, "ar");
    // AR: 1000 - 400 (incoming cheque) = 600.
    expect(Number(ar.subLedgerBalance)).toBe(600);
    expect(ar.subLedgerBalance).toBe(ar.glBalance);
    expect(ar.matched).toBe(true);

    const ap = rowFor(after.rows, "ap");
    // AP: 500 - 150 (non-bounced outgoing cheque) - 0 (bounced one restored) = 350.
    expect(Number(ap.subLedgerBalance)).toBe(350);
    expect(ap.subLedgerBalance).toBe(ap.glBalance);
    expect(ap.matched).toBe(true);
  });
});

describe("create-backend — resolveReconciliationControls counts only a CONFIRMED purchase invoice against AP", () => {
  it("a confirmed purchase invoice moves the AP sub-ledger; a draft one does not", async () => {
    const app = await newBackend();
    await post(app, "/suppliers", { id: "sup-pi-arm", code: "sup-pi-arm", nameAr: "مورد", currency: "EGP", openingBalance: "0" }, admin(app));

    const draft = await post(
      app,
      "/purchases/invoices",
      { id: "pi-arm-draft", supplierId: "sup-pi-arm", date: "2026-08-22", branchId: "BR1", warehouseId: "WH1", lines: [{ description: "غير مؤكد", kind: "expense", qty: "1", unitCost: "100.00", taxRatePercent: 0 }] },
      admin(app),
    );
    expect(draft.status).toBe(201);

    const confirmedBody = await post(
      app,
      "/purchases/invoices",
      { id: "pi-arm-confirmed", supplierId: "sup-pi-arm", date: "2026-08-22", branchId: "BR1", warehouseId: "WH1", lines: [{ description: "مؤكد", kind: "expense", qty: "1", unitCost: "250.00", taxRatePercent: 0 }] },
      admin(app),
    );
    expect(confirmedBody.status).toBe(201);
    expect((await post(app, "/purchases/invoices/pi-arm-confirmed/confirm", {}, admin(app))).status).toBe(200);

    const result = await reconciliation(app);
    const ap = rowFor(result.rows, "ap");
    expect(Number(ap.subLedgerBalance)).toBe(250);
    expect(ap.subLedgerBalance).toBe(ap.glBalance);
    expect(ap.matched).toBe(true);
  });
});

describe("create-backend — resolveReconciliationControls nets historical-import archives, skipping settled ones and flipping sign for returns", () => {
  it("an unsettled invoice archive adds to the sub-ledger, an unsettled return archive subtracts, and a settled archive is skipped entirely", async () => {
    const app = await newBackend();

    const purchaseCommit = await post(
      app,
      "/purchases/historical-import/commit",
      {
        rows: [
          // Settled in full — skipped.
          { rowNumber: 1, docType: "PURCHASE_INVOICE", documentNumber: "PI-HIST-1", supplierId: "sup-hist-1", date: "2026-01-15", qty: "10", unitCost: "20.00", amountPaid: "200.00" },
          // Unsettled invoice — adds its remaining balance (300 - 100 = 200).
          { rowNumber: 2, docType: "PURCHASE_INVOICE", documentNumber: "PI-HIST-2", supplierId: "sup-hist-1", date: "2026-01-16", qty: "10", unitCost: "30.00", amountPaid: "100.00" },
          // Unsettled return — subtracts its remaining balance (100 - 0 = 100).
          { rowNumber: 3, docType: "PURCHASE_RETURN", documentNumber: "PR-HIST-1", supplierId: "sup-hist-1", date: "2026-01-17", qty: "5", unitCost: "20.00", amountPaid: "0.00" },
        ],
      },
      admin(app),
    );
    expect(purchaseCommit.status).toBe(201);
    expect(((await purchaseCommit.json()) as { archivedIds: string[] }).archivedIds).toHaveLength(3);

    const salesCommit = await post(
      app,
      "/sales/historical-import/commit",
      {
        rows: [
          // Settled in full — skipped.
          { rowNumber: 1, docType: "SALES_INVOICE", documentNumber: "SI-HIST-1", customerId: "cust-hist-1", date: "2026-01-15", qty: "10", unitCost: "15.00", amountPaid: "150.00" },
          // Unsettled invoice — adds its remaining balance (250 - 100 = 150).
          { rowNumber: 2, docType: "SALES_INVOICE", documentNumber: "SI-HIST-2", customerId: "cust-hist-1", date: "2026-01-16", qty: "10", unitCost: "25.00", amountPaid: "100.00" },
          // Unsettled return — subtracts its remaining balance (60 - 0 = 60).
          { rowNumber: 3, docType: "SALES_RETURN", documentNumber: "SR-HIST-1", customerId: "cust-hist-1", date: "2026-01-17", qty: "3", unitCost: "20.00", amountPaid: "0.00" },
        ],
      },
      admin(app),
    );
    expect(salesCommit.status).toBe(201);
    expect(((await salesCommit.json()) as { archivedIds: string[] }).archivedIds).toHaveLength(3);

    const result = await reconciliation(app);
    const ap = rowFor(result.rows, "ap");
    expect(Number(ap.subLedgerBalance)).toBe(200 - 100);
    expect(ap.subLedgerBalance).toBe(ap.glBalance);
    expect(ap.matched).toBe(true);

    const ar = rowFor(result.rows, "ar");
    expect(Number(ar.subLedgerBalance)).toBe(150 - 60);
    expect(ar.subLedgerBalance).toBe(ar.glBalance);
    expect(ar.matched).toBe(true);
    expect(result.allMatched).toBe(true);
  });
});

describe("create-backend — resolveReconciliationControls credits AP once for a confirmed landed cost document, not once per denormalized line", () => {
  it("costItems repeat on every target line, but the AP sub-ledger only counts their total once", async () => {
    const app = await newBackend();

    await post(app, "/items", { id: "item-lc-1", code: "item-lc-1", nameAr: "صنف 1", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app));
    await post(app, "/items", { id: "item-lc-2", code: "item-lc-2", nameAr: "صنف 2", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app));
    for (const [itemId, adjId] of [["item-lc-1", "adj-lc-1"], ["item-lc-2", "adj-lc-2"]] as const) {
      const adj = await post(
        app,
        "/inventory/adjustments",
        { adjustmentId: adjId, warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", occurredAt: "2026-08-22", lines: [{ itemId, direction: "IN", qty: "50", unitCost: "10" }] },
        admin(app),
      );
      expect(adj.status).toBe(201);
    }

    const before = await reconciliation(app);
    expect(Number(rowFor(before.rows, "ap").subLedgerBalance)).toBe(0);
    expect(Number(rowFor(before.rows, "inventory").subLedgerBalance)).toBe(1000); // 2 * 50 * 10

    const create = await post(
      app,
      "/landed-costs",
      {
        id: "lc-1",
        date: "2026-08-22",
        memo: "شحن",
        distributionMethod: "BY_VALUE",
        costItems: [{ costType: "SHIPPING", description: "شحن بحري", amount: "300.00" }],
        targets: [
          { itemId: "item-lc-1", warehouseId: "WH-MAIN", sourceInvoiceId: "adj-lc-1", sourceInvoiceNumber: null, qty: "50", unitCost: "10.00", weight: "0" },
          { itemId: "item-lc-2", warehouseId: "WH-MAIN", sourceInvoiceId: "adj-lc-2", sourceInvoiceNumber: null, qty: "50", unitCost: "10.00", weight: "0" },
        ],
      },
      admin(app),
    );
    expect(create.status).toBe(201);
    const doc = (await create.json()) as { id: string; lines: unknown[] };
    expect(doc.lines).toHaveLength(2);

    const confirm = await post(app, "/landed-costs/lc-1/confirm", {}, admin(app));
    expect(confirm.status).toBe(200);

    const after = await reconciliation(app);
    const ap = rowFor(after.rows, "ap");
    // 300, not 600 (2 lines * 300) — costItems is read from ONE line only.
    expect(Number(ap.subLedgerBalance)).toBe(300);
    expect(ap.subLedgerBalance).toBe(ap.glBalance);
    expect(ap.matched).toBe(true);

    const inventory = rowFor(after.rows, "inventory");
    expect(Number(inventory.subLedgerBalance)).toBe(1000 + 300);
    expect(inventory.subLedgerBalance).toBe(inventory.glBalance);
    expect(inventory.matched).toBe(true);
  });
});

interface BalancesByCurrencyDTO {
  baseCurrency: string;
  receivables: { currency: string; parties: { partyId: string; partyName: string; outstandingBase: string }[] }[];
  payables: { currency: string; parties: { partyId: string; partyName: string; outstandingBase: string }[] }[];
}

describe("create-backend — collectOpenPartyDocuments falls back when the party row or the document currency is missing", () => {
  it("a receivable row falls back to the invoice's own customerNameAr and to the base currency", async () => {
    const app = await newBackend();
    await createServiceItem(app);
    // No /customers call for "cust-ghost-recv" — the customer row will not exist.
    const create = await post(
      app,
      "/sales-invoices",
      invoiceBody("inv-ghost-recv", "cust-ghost-recv", "200.00", { customerNameAr: "عميل شبح", currency: "" }),
      admin(app),
    );
    expect(create.status).toBe(201);
    expect((await post(app, "/sales-invoices/inv-ghost-recv/confirm", {}, admin(app))).status).toBe(200);

    const res = await get(app, "/gl/balances-by-currency", admin(app));
    expect(res.status).toBe(200);
    const body = (await res.json()) as BalancesByCurrencyDTO;
    expect(body.baseCurrency).toBe("EGP");
    const egp = body.receivables.find((r) => r.currency === "EGP");
    const party = egp?.parties.find((p) => p.partyId === "cust-ghost-recv");
    expect(party).toBeDefined();
    expect(party?.partyName).toBe("عميل شبح");
    expect(party?.outstandingBase).toBe("200.000000");
  });

  it("a payable row falls back to the supplier's own id when the supplier row is missing", async () => {
    const app = await newBackend();
    // No /suppliers call for "sup-ghost-pay" — the supplier row will not exist.
    const create = await post(
      app,
      "/purchases/invoices",
      { id: "pi-ghost-pay", supplierId: "sup-ghost-pay", date: "2026-08-22", branchId: "BR1", warehouseId: "WH1", lines: [{ description: "خدمة شبح", kind: "expense", qty: "1", unitCost: "75.00", taxRatePercent: 0 }] },
      admin(app),
    );
    expect(create.status).toBe(201);
    expect((await post(app, "/purchases/invoices/pi-ghost-pay/confirm", {}, admin(app))).status).toBe(200);

    const res = await get(app, "/gl/balances-by-currency", admin(app));
    expect(res.status).toBe(200);
    const body = (await res.json()) as BalancesByCurrencyDTO;
    const egp = body.payables.find((r) => r.currency === "EGP");
    const party = egp?.parties.find((p) => p.partyId === "sup-ghost-pay");
    expect(party).toBeDefined();
    expect(party?.partyName).toBe("sup-ghost-pay");
    expect(party?.outstandingBase).toBe("75.000000");
  });
});
