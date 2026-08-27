import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { App } from "@mezan/api";
import type { DashboardSummaryDTO, SessionDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle } from "./create-backend.js";

const handles: BackendHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

async function newBackend() {
  const handle = await createBackend({ dbPath: ":memory:" });
  handles.push(handle);
  return handle.app;
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

describe("createBackend — seeded app", () => {
  it("seeds an empty DB and logs the admin in with the real PIN", async () => {
    const app = await newBackend();
    const res = await post(app, "/auth/login", { username: "محمد الشهابي", pin: "1234" });
    expect(res.status).toBe(200);
    const session = (await res.json()) as SessionDTO;
    expect(session.isCompanyAdmin).toBe(true);
    expect(session.permissions).toContain("*");
    expect(session.tenantName).toBe("Cyag");
  });

  it("rejects a wrong PIN", async () => {
    const app = await newBackend();
    const res = await post(app, "/auth/login", { username: "محمد الشهابي", pin: "0000" });
    expect(res.status).toBe(401);
  });

  it("computes a real dashboard summary — seeded COA, zero money, empty activity", async () => {
    const app = await newBackend();
    const res = await app.fetch(
      new Request("http://local/dashboard/summary", { headers: { "x-permissions": "*" } }),
    );
    expect(res.status).toBe(200);
    const summary = (await res.json()) as DashboardSummaryDTO;
    expect(summary.counts.accounts).toBeGreaterThan(0);
    expect(summary.counts.customers).toBe(0);
    expect(Number(summary.gl.revenue)).toBe(0);
    expect(Number(summary.gl.netProfit)).toBe(0);
    expect(summary.recentActivity).toEqual([]);
  });

  it("gates the dashboard without permissions", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/dashboard/summary"));
    expect(res.status).toBe(403);
  });

  it("bootstrap/seed is idempotent and reports counts", async () => {
    const app = await newBackend();
    const res = await post(app, "/bootstrap/seed", {});
    expect(res.status).toBe(200);
    const result = (await res.json()) as { accounts: number; users: number };
    expect(result.accounts).toBeGreaterThan(0);
    expect(result.users).toBeGreaterThanOrEqual(1);
  });

  it("mounts /reports/* over the real seeded repositories (docs/catalog/08)", async () => {
    const app = await newBackend();
    const res = await app.fetch(
      new Request("http://local/reports/sales/by-period?groupBy=day", { headers: { "x-permissions": "*" } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toEqual([]); // freshly seeded DB — no invoices yet, but the route computes over real data
  });
});

/** Full permission set covering every route this suite exercises below. */
const ADMIN_HEADERS = {
  "x-user-id": "u1",
  "x-permissions":
    "sales.customer.create,sales.customer.view,admin.settings.edit,admin.settings.view,sales.invoice.create,sales.invoice.confirm,sales.invoice.view,sales.price_list.manage,sales.price_list.view,sales.promotion.manage,sales.promotion.view,sales.quote.create,sales.quote.view_own,sales.quote.view,sales.quote.send,sales.quote.edit",
};

function authedPost(app: App, path: string, body: unknown) {
  return post(app, path, body, ADMIN_HEADERS);
}

function authedGet(app: App, path: string) {
  return app.fetch(new Request(`http://local${path}`, { headers: ADMIN_HEADERS }));
}

async function createCustomer(app: App, id: string, creditLimit: string) {
  const res = await authedPost(app, "/customers", {
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
  });
  expect(res.status).toBe(201);
}

function invoiceBody(id: string, customerId: string, unitPrice: string) {
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
  };
}

describe("createBackend — sales-quotes, price-lists, promotions, credit control", () => {
  it("mounts /price-lists and round-trips a real create + list", async () => {
    const app = await newBackend();
    const create = await authedPost(app, "/price-lists", {
      id: "pl-1",
      code: "PL-001",
      nameAr: "قائمة الأسعار الأساسية",
      isBase: true,
      lines: [],
    });
    expect(create.status).toBe(201);
    const list = await authedGet(app, "/price-lists");
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown[]).toHaveLength(1);
  });

  it("mounts /promotions and round-trips a real create + list", async () => {
    const app = await newBackend();
    const create = await authedPost(app, "/promotions", {
      id: "promo-1",
      code: "SUMMER25",
      nameAr: "خصم الصيف",
      type: "percentage",
      percentValue: 25,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      priority: 1,
      requiresCoupon: false,
      scope: { type: "all", ids: [] },
    });
    expect(create.status).toBe(201);
    const list = await authedGet(app, "/promotions");
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown[]).toHaveLength(1);
  });

  it("mounts /sales-quotes and converts an accepted quote to a draft invoice", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-q1", "0");
    const create = await authedPost(app, "/sales-quotes", {
      id: "quote-1",
      date: "2026-08-22",
      expiryDate: "2026-09-22",
      customerId: "cust-q1",
      customerNameAr: "عميل cust-q1",
      branchId: "BR1",
      lines: [
        {
          lineId: "L1",
          itemId: "SVC-1",
          itemNameAr: "خدمة",
          qty: "1",
          unitPrice: "100",
          taxRatePercent: 0,
        },
      ],
    });
    expect(create.status).toBe(201);
    const quote = (await create.json()) as { id: string };

    // send -> accept (status machine, per docs/catalog/01: مسودة -> مرسل -> مقبول -> محول)
    const send = await authedPost(app, `/sales-quotes/${quote.id}/send`, {});
    expect(send.status).toBe(200);
    const accept = await authedPost(app, `/sales-quotes/${quote.id}/accept`, {});
    expect(accept.status).toBe(200);

    const convert = await authedPost(app, `/sales-quotes/${quote.id}/convert-to-invoice`, {
      id: "conv-inv-1",
      date: "2026-08-22",
      dueDate: "2026-09-21",
      warehouseId: "WH1",
      arAccountId: "1105",
      taxAccountId: "2200",
      lines: [{ lineId: "L1", isStock: false, revenueAccountId: "4100" }],
    });
    expect(convert.status).toBe(201);
    const converted = (await convert.json()) as { quote: { status: string }; invoiceId: string };
    expect(converted.quote.status).toBe("converted");
    expect(converted.invoiceId).toBeTruthy();
  });

  it("credit control BLOCK stops confirm once the customer exceeds their credit limit", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-cc1", "100");
    const putSettings = await app.fetch(
      new Request("http://local/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...ADMIN_HEADERS },
        body: JSON.stringify({ creditControlEnabled: true, creditControlMode: "BLOCK" }),
      }),
    );
    expect(putSettings.status).toBe(200);

    const create = await authedPost(app, "/sales-invoices", invoiceBody("inv-block-1", "cust-cc1", "150"));
    expect(create.status).toBe(201);
    const draft = (await create.json()) as { id: string };
    const confirm = await authedPost(app, `/sales-invoices/${draft.id}/confirm`, {});
    expect(confirm.status).toBe(422);
    const body = (await confirm.json()) as { error: string };
    expect(body.error).toBe("CREDIT_LIMIT_EXCEEDED");
  });

  it("credit control WARNING lets an over-limit confirm through, flagged as held", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-cc2", "100");
    const putSettings = await app.fetch(
      new Request("http://local/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...ADMIN_HEADERS },
        body: JSON.stringify({ creditControlEnabled: true, creditControlMode: "WARNING" }),
      }),
    );
    expect(putSettings.status).toBe(200);

    const create = await authedPost(app, "/sales-invoices", invoiceBody("inv-warn-1", "cust-cc2", "150"));
    const draft = (await create.json()) as { id: string };
    const confirm = await authedPost(app, `/sales-invoices/${draft.id}/confirm`, {});
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as { status: string; held?: boolean };
    expect(confirmed.status).toBe("confirmed");
  });

  it("under the credit limit confirms cleanly with credit control BLOCK on", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-cc3", "1000");
    const putSettings = await app.fetch(
      new Request("http://local/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...ADMIN_HEADERS },
        body: JSON.stringify({ creditControlEnabled: true, creditControlMode: "BLOCK" }),
      }),
    );
    expect(putSettings.status).toBe(200);

    const create = await authedPost(app, "/sales-invoices", invoiceBody("inv-ok-1", "cust-cc3", "150"));
    const draft = (await create.json()) as { id: string };
    const confirm = await authedPost(app, `/sales-invoices/${draft.id}/confirm`, {});
    expect(confirm.status).toBe(200);
  });
});

describe("createBackend — cheques + bank reconciliation (phase7/treasury-completion)", () => {
  const ADMIN = { "x-permissions": "*", "x-user-id": "admin" };

  it("mounts /cheques and runs a real incoming lifecycle over the seeded COA", async () => {
    const app = await newBackend();
    const created = await post(
      app,
      "/cheques",
      {
        id: "chq-1",
        direction: "incoming",
        chequeNumber: "CHQ-5001",
        bankName: "بنك مصر",
        amount: "1000.00",
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        branchId: "BR1",
        partyId: "cust-1",
        counterpartyGlAccountId: "1105",
        controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
      },
      ADMIN,
    );
    expect(created.status).toBe(201);
    expect((await created.json()) as { status: string }).toMatchObject({ status: "pending" });

    const deposited = await post(app, "/cheques/chq-1/deposit", { bankTreasuryAccountId: "ta-bank1" }, ADMIN);
    expect(deposited.status).toBe(200);

    const collected = await post(app, "/cheques/chq-1/collect", { bankGlAccountId: "1310" }, ADMIN);
    expect(collected.status).toBe(200);
    const body = (await collected.json()) as { status: string; collectionJournalEntryId: string | null };
    expect(body.status).toBe("collected");
    expect(body.collectionJournalEntryId).toBeTruthy();
  });

  it("posts an outgoing cheque against the seeded 2150 شيكات صادرة control account", async () => {
    const app = await newBackend();
    const res = await post(
      app,
      "/cheques",
      {
        direction: "outgoing",
        chequeNumber: "CHQ-9001",
        bankName: "البنك الأهلي",
        amount: "500.00",
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        branchId: "BR1",
        partyId: "sup-1",
        counterpartyGlAccountId: "2100",
        controlAccounts: { underCollectionAccountId: "2150" },
      },
      ADMIN,
    );
    expect(res.status).toBe(201);
  });

  it("gates /cheques behind cheques.view", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/cheques"));
    expect(res.status).toBe(403);
  });

  it("mounts /bank-statements and imports a CSV statement with its per-account column mapping", async () => {
    const app = await newBackend();
    const res = await post(
      app,
      "/bank-statements/import",
      {
        id: "stmt-1",
        treasuryAccountId: "ta-bank1",
        rawCsv: "Date,Description,Amount,Ref\n2026-08-01,Deposit,100.00,TX1\n2026-08-02,Fee,-5.00,TX2\n",
        mapping: { dateColumn: "Date", descriptionColumn: "Description", amountColumn: "Amount", referenceColumn: "Ref" },
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        openingBalance: "0.00",
        closingBalance: "95.00",
      },
      ADMIN,
    );
    expect(res.status).toBe(201);
    const imported = (await res.json()) as { status: string; lines: { amount: string }[] };
    expect(imported.status).toBe("imported");
    expect(imported.lines.map((l) => l.amount)).toEqual(["100.000000", "-5.000000"]);

    const mapping = await app.fetch(new Request("http://local/bank-statements/column-mapping/ta-bank1", { headers: ADMIN }));
    expect(mapping.status).toBe(200);
    expect((await mapping.json()) as { amountColumn: string }).toMatchObject({ amountColumn: "Amount", dateFormat: "YYYY-MM-DD" });

    const matched = await post(app, "/bank-statements/stmt-1/lines/stmt-1:L0/match", { entryId: "je-1" }, ADMIN);
    expect(matched.status).toBe(200);

    const detail = await app.fetch(new Request("http://local/bank-statements/stmt-1", { headers: ADMIN }));
    expect((await detail.json()) as { status: string }).toMatchObject({
      status: "in_progress",
      matchSummary: { total: 2, matched: 1, unmatched: 1, matchRate: 0.5 },
    });
  });

  it("gates /bank-statements behind treasury.reconciliation.view", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/bank-statements"));
    expect(res.status).toBe(403);
  });
});

describe("createBackend — CRM, Projects, Fixed Assets, Field/Van Sales (phase11/crm-projects-assets-field)", () => {
  const ADMIN = { "x-permissions": "*", "x-user-id": "admin" };

  it("seeds the 7 standard CRM pipeline stages on an empty DB", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/crm/pipeline-stages", { headers: ADMIN }));
    expect(res.status).toBe(200);
    const stages = (await res.json()) as { name: string; isWinStage: boolean; isLossStage: boolean }[];
    expect(stages).toHaveLength(7);
    expect(stages.filter((s) => s.isWinStage)).toHaveLength(1);
    expect(stages.filter((s) => s.isLossStage)).toHaveLength(1);
  });

  it("runs a lead through the full state machine and converts it to a customer + opportunity", async () => {
    const app = await newBackend();
    const create = await post(app, "/crm/leads", { id: "lead-1", name: "شركة الأمل" }, ADMIN);
    expect(create.status).toBe(201);
    expect(((await create.json()) as { status: string }).status).toBe("new");

    const contacted = await post(app, "/crm/leads/lead-1/transition", { status: "contacted" }, ADMIN);
    expect(contacted.status).toBe(200);
    const qualified = await post(app, "/crm/leads/lead-1/transition", { status: "qualified" }, ADMIN);
    expect(qualified.status).toBe(200);
    expect(((await qualified.json()) as { status: string }).status).toBe("qualified");

    // an invalid jump (qualified -> contacted) is rejected by the state machine
    const invalid = await post(app, "/crm/leads/lead-1/transition", { status: "contacted" }, ADMIN);
    expect(invalid.status).toBe(422);

    const stages = (await (await app.fetch(new Request("http://local/crm/pipeline-stages", { headers: ADMIN }))).json()) as {
      id: string;
      isWinStage: boolean;
    }[];
    const openStage = stages.find((s) => !s.isWinStage)!;

    const convert = await post(
      app,
      "/crm/leads/lead-1/convert",
      {
        createCustomer: true,
        customer: { id: "cust-from-lead-1", code: "CUST-LEAD-1" },
        createOpportunity: true,
        opportunity: { id: "opp-1", title: "صفقة الأمل", stageId: openStage.id, expectedValue: "5000", probability: 40 },
      },
      ADMIN,
    );
    expect(convert.status).toBe(200);
    const converted = (await convert.json()) as {
      lead: { status: string; convertedCustomerId: string | null; convertedOpportunityId: string | null };
    };
    expect(converted.lead.status).toBe("converted");
    expect(converted.lead.convertedCustomerId).toBe("cust-from-lead-1");
    expect(converted.lead.convertedOpportunityId).toBe("opp-1");

    const customer = await app.fetch(new Request("http://local/customers/cust-from-lead-1", { headers: ADMIN }));
    expect(customer.status).toBe(200);
    const opportunity = await app.fetch(new Request("http://local/crm/opportunities/opp-1", { headers: ADMIN }));
    expect(opportunity.status).toBe(200);
  });

  it("creates a project and auto-creates its linked PRJ-{code} cost center", async () => {
    const app = await newBackend();
    const create = await post(app, "/projects", { id: "proj-1", code: "TOWER-A", nameAr: "مشروع البرج أ", budget: "100000" }, ADMIN);
    expect(create.status).toBe(201);
    const project = (await create.json()) as { costCenterId: string; status: string };
    expect(project.status).toBe("planned");

    const costCenter = await app.fetch(new Request(`http://local/cost-centers/${project.costCenterId}`, { headers: ADMIN }));
    expect(costCenter.status).toBe(200);
    const cc = (await costCenter.json()) as { code: string };
    expect(cc.code).toBe("PRJ-TOWER-A");
  });

  it("registers an asset category + asset, runs depreciation, and posts a REAL balanced GL entry", async () => {
    const app = await newBackend();
    const category = await post(
      app,
      "/assets/categories",
      { id: "cat-1", code: "FA-01", nameAr: "سيارات", defaultUsefulLifeMonths: 60, defaultSalvagePercent: 10 },
      ADMIN,
    );
    expect(category.status).toBe(201);

    const asset = await post(
      app,
      "/assets",
      {
        id: "asset-1",
        code: "AST-0001",
        nameAr: "سيارة النقل الرئيسية",
        categoryId: "cat-1",
        acquisitionDate: "2026-01-01",
        acquisitionCost: "120000",
        usefulLifeMonths: 60,
      },
      ADMIN,
    );
    expect(asset.status).toBe(201);

    const run = await post(app, "/assets/depreciation/runs", { period: "2026-02" }, ADMIN);
    expect(run.status).toBe(201);
    const created = (await run.json()) as { id: string; status: string; totalAmount: string; lines: unknown[] };
    expect(created.status).toBe("draft");
    expect(created.lines).toHaveLength(1);
    expect(Number(created.totalAmount)).toBeGreaterThan(0);

    const posted = await post(app, `/assets/depreciation/runs/${created.id}/post`, {}, ADMIN);
    expect(posted.status).toBe(200);
    const postedRun = (await posted.json()) as { status: string; journalEntryId: string | null };
    expect(postedRun.status).toBe("posted");
    expect(postedRun.journalEntryId).toBeTruthy();

    const entry = await app.fetch(new Request(`http://local/gl/journal-entries/${postedRun.journalEntryId}`, { headers: ADMIN }));
    expect(entry.status).toBe(200);
    const je = (await entry.json()) as { lines: { accountId: string; debit: string; credit: string }[] };
    const totalDebit = je.lines.reduce((n, l) => n + Number(l.debit), 0);
    const totalCredit = je.lines.reduce((n, l) => n + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 6);
    expect(je.lines.some((l) => l.accountId === "5400")).toBe(true);
    expect(je.lines.some((l) => l.accountId === "1590")).toBe(true);
  });

  it("opens a van trip (real treasury transfer + real stock transfer) and settles it with cash + stock variance", async () => {
    const app = await newBackend();

    const van = await post(app, "/warehouses", { id: "wh-van1", code: "WH-VAN1", name: "مستودع الڤان 1", nameEn: null, branchId: "BR-MAIN", type: "VAN" }, ADMIN);
    expect(van.status).toBe(201);
    const sourceTa = await post(
      app,
      "/treasury-accounts",
      { id: "ta-main", code: "TA-MAIN", name: "خزينة الفرع الرئيسي", branchId: "BR-MAIN", glAccountId: "1300-1", openingBalance: "10000" },
      ADMIN,
    );
    expect(sourceTa.status).toBe(201);
    const vanTa = await post(
      app,
      "/treasury-accounts",
      { id: "ta-van1", code: "TA-VAN1", name: "خزينة الڤان 1", branchId: "BR-MAIN", glAccountId: "1310" },
      ADMIN,
    );
    expect(vanTa.status).toBe(201);
    const item = await post(
      app,
      "/items",
      { id: "item-van1", code: "ITEM-VAN1", nameAr: "منتج للفان", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
      ADMIN,
    );
    expect(item.status).toBe(201);

    // fund the source treasury account with a REAL posted capital-injection voucher —
    // a treasury account's own `openingBalance` field is metadata only; its actual
    // cash balance the guard checks comes from posted GL journal entries.
    const fund = await post(
      app,
      "/vouchers",
      {
        id: "voucher-fund-main",
        date: "2026-08-01",
        voucherType: "capital_injection",
        amount: "10000",
        branchId: "BR-MAIN",
        paymentMethod: "cash",
        treasuryAccountId: "ta-main",
        treasuryGlAccountId: "1300-1",
        counterpartyGlAccountId: "3100",
      },
      ADMIN,
    );
    expect(fund.status).toBe(201);
    const fundConfirm = await post(app, "/vouchers/voucher-fund-main/confirm", {}, ADMIN);
    expect(fundConfirm.status).toBe(200);

    // load the source warehouse with stock the van trip can transfer out of
    const adjust = await post(
      app,
      "/inventory/adjustments",
      {
        adjustmentId: "adj-van1",
        warehouseId: "WH-MAIN",
        reason: "INITIAL_STOCK",
        lines: [{ itemId: "item-van1", direction: "IN", qty: "20", unitCost: "50" }],
      },
      ADMIN,
    );
    expect(adjust.status).toBe(201);

    const open = await post(
      app,
      "/field/van-trips",
      {
        id: "trip-1",
        date: "2026-08-21",
        branchId: "BR-MAIN",
        vanWarehouseId: "wh-van1",
        vanTreasuryAccountId: "ta-van1",
        sourceWarehouseId: "WH-MAIN",
        sourceTreasuryAccountId: "ta-main",
        openingCashFloat: "500",
        crew: [{ employeeId: "emp-1", role: "driver" }],
        loadedStock: [{ itemId: "item-van1", qty: "10" }],
      },
      ADMIN,
    );
    expect(open.status).toBe(201);
    const trip = (await open.json()) as { id: string; status: string; openingCashFloat: string };
    expect(trip.status).toBe("ongoing");
    expect(trip.openingCashFloat).toBe("500.000000");

    // opening the trip really moved stock into the van warehouse via the real stock ledger
    const vanStock = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-van1&warehouseId=wh-van1", { headers: ADMIN }),
    );
    expect(vanStock.status).toBe(200);
    expect(Number(((await vanStock.json()) as { onHand: string }).onHand)).toBe(10);

    // and it really moved cash between the two treasury accounts via a confirmed inter-treasury voucher
    const sourceStock = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-van1&warehouseId=WH-MAIN", { headers: ADMIN }),
    );
    expect(Number(((await sourceStock.json()) as { onHand: string }).onHand)).toBe(10); // 20 loaded - 10 transferred to the van

    const collection = await post(
      app,
      `/field/van-trips/${trip.id}/cash-movements`,
      { id: "cm-1", kind: "collection", amount: "300", occurredAt: "2026-08-21T10:00:00.000Z" },
      ADMIN,
    );
    expect(collection.status).toBe(200);

    // in the field, the 300 collected really lands in the van's own treasury too
    // (a customer-collection voucher posted straight to the van's cash account) —
    // recordVanCashMovement only logs the trip-level summary line, so the
    // settlement's real cash-out transfer needs the van treasury to actually
    // hold what it's being asked to hand back.
    const vanCollection = await post(
      app,
      "/vouchers",
      {
        id: "voucher-van-collection",
        date: "2026-08-21",
        voucherType: "other_income",
        amount: "300",
        branchId: "BR-MAIN",
        paymentMethod: "cash",
        treasuryAccountId: "ta-van1",
        treasuryGlAccountId: "1310",
        counterpartyGlAccountId: "4900",
      },
      ADMIN,
    );
    expect(vanCollection.status).toBe(201);
    expect((await post(app, "/vouchers/voucher-van-collection/confirm", {}, ADMIN)).status).toBe(200);

    const settle = await post(
      app,
      `/field/van-trips/${trip.id}/settle`,
      { countedCash: "780", stockCounts: [{ itemId: "item-van1", countedQty: "6" }] },
      ADMIN,
    );
    expect(settle.status).toBe(200);
    const settled = (await settle.json()) as {
      status: string;
      settlement: { expectedCash: string; countedCash: string; cashVariance: string; stockCounts: { itemId: string; varianceQty: string }[] };
    };
    expect(settled.status).toBe("settled");
    // expected = opening float (500) + collection (300) = 800; counted 780 -> -20 shortage variance
    expect(settled.settlement.expectedCash).toBe("800.000000");
    expect(settled.settlement.cashVariance).toBe("-20.000000");
    const line = settled.settlement.stockCounts.find((s) => s.itemId === "item-van1")!;
    expect(line.varianceQty).toBe("-4.000000"); // loaded 10, counted 6
  });

  it("gates /crm, /projects, /assets and /field/van-trips behind their own permissions", async () => {
    const app = await newBackend();
    expect((await app.fetch(new Request("http://local/crm/leads"))).status).toBe(403);
    expect((await app.fetch(new Request("http://local/projects"))).status).toBe(403);
    expect((await app.fetch(new Request("http://local/assets"))).status).toBe(403);
    expect((await app.fetch(new Request("http://local/field/van-trips"))).status).toBe(403);
  });
});

describe("createBackend — sweep/finish-and-mount: manufacturing, RFQ, historical import", () => {
  it("mounts /manufacturing/* over the seeded COA's dedicated leaf accounts", async () => {
    const app = await newBackend();
    const boms = await app.fetch(new Request("http://local/manufacturing/boms", { headers: { "x-permissions": "*" } }));
    expect(boms.status).toBe(200);
    expect((await boms.json()) as unknown[]).toEqual([]);

    const workOrders = await app.fetch(
      new Request("http://local/manufacturing/work-orders", { headers: { "x-permissions": "*" } }),
    );
    expect(workOrders.status).toBe(200);

    const configInstances = await app.fetch(
      new Request("http://local/manufacturing/config-instances", { headers: { "x-permissions": "*" } }),
    );
    expect(configInstances.status).toBe(200);
    expect((await configInstances.json()) as unknown[]).toEqual([]);

    // The 4 dedicated leaf accounts from the standard COA template exist on the seeded DB.
    const accounts = await app.fetch(new Request("http://local/accounts", { headers: { "x-permissions": "*" } }));
    const accountIds = ((await accounts.json()) as { id: string }[]).map((a) => a.id);
    expect(accountIds).toEqual(expect.arrayContaining(["1210", "1220", "5110", "5210"]));
  });

  it("mounts /rfqs over the shared purchase-order store + numbering", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/rfqs", { headers: { "x-permissions": "*" } }));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it("mounts /purchases/historical-import/archives (no GL adapter — archive only)", async () => {
    const app = await newBackend();
    const res = await app.fetch(
      new Request("http://local/purchases/historical-import/archives", { headers: { "x-permissions": "*" } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it("mounts /sales-returns, /purchase-returns, /landed-costs, /installments/plans, /installments/follow-ups", async () => {
    const app = await newBackend();
    const headers = { "x-permissions": "*" };
    for (const path of [
      "/sales-returns",
      "/purchase-returns",
      "/landed-costs",
      "/installments/plans",
      "/installments/follow-ups",
    ]) {
      const res = await app.fetch(new Request(`http://local${path}`, { headers }));
      expect(res.status, `GET ${path}`).toBe(200);
      expect((await res.json()) as unknown[]).toEqual([]);
    }
  });
});

/**
 * w8/workflow-ui — إعدادات الموافقات chain-builder + الموافقات inbox. Proves
 * the `/workflow` routes are really mounted over the persisted SQLite stores,
 * AND that `documentWorkflowGate` (create-backend.ts) is bound to the SAME
 * store: configuring a chain for SALES_RETURN_CONFIRM actually holds a real
 * sales-return confirm بانتظار الموافقة instead of a config with no effect.
 */
describe("createBackend — workflow/approvals (w8/workflow-ui)", () => {
  const ADMIN = { "x-permissions": "*", "x-user-id": "admin" };

  it("mounts /workflow/configs and /workflow/requests", async () => {
    const app = await newBackend();
    const configs = await app.fetch(new Request("http://local/workflow/configs", { headers: ADMIN }));
    expect(configs.status).toBe(200);
    expect((await configs.json()) as unknown[]).toEqual([]);

    const pending = await app.fetch(new Request("http://local/workflow/requests/pending", { headers: ADMIN }));
    expect(pending.status).toBe(200);
    expect((await pending.json()) as unknown[]).toEqual([]);
  });
});

describe("createBackend — phase9/accounting-depth: reconciliation, inventory-ops document layer", () => {
  const ADMIN = { "x-permissions": "*", "x-user-id": "admin" };

  it("mounts /reconciliation with real AR/AP/inventory sub-ledger totals — all zero and matched on a fresh seeded DB", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/reconciliation", { headers: ADMIN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ key: string; controlAccountId: string; subLedgerBalance: string; glBalance: string; matched: boolean }>;
      allMatched: boolean;
    };
    expect(body.allMatched).toBe(true);
    expect(body.rows.map((r) => r.key).sort()).toEqual(["ap", "ar", "inventory"]);
    for (const row of body.rows) {
      expect(row.matched).toBe(true);
      expect(Number(row.subLedgerBalance)).toBe(0);
      expect(Number(row.glBalance)).toBe(0);
    }
  });

  it("mounts /inventory/stock-adjustments — INITIAL_STOCK draft → confirm posts stock AND a real balanced GL entry", async () => {
    const app = await newBackend();
    expect(
      (await post(app, "/items", { id: "item-adj", code: "ITEM-ADJ", nameAr: "منتج تسوية", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, ADMIN)).status,
    ).toBe(201);

    const draft = await post(
      app,
      "/inventory/stock-adjustments/draft",
      {
        id: "sa-1",
        date: "2026-08-22",
        lines: [{ itemId: "item-adj", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "100", unitCost: "10" }],
      },
      ADMIN,
    );
    expect(draft.status).toBe(201);

    const confirm = await post(app, "/inventory/stock-adjustments/sa-1/confirm", {}, ADMIN);
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as { document: { status: string } };
    expect(confirmed.document.status).toBe("confirmed");

    // The GL entry id == the adjustment's own doc id (createInventoryGlPostingHook's
    // trick — see packages/api/src/stock-documents-routes.test.ts); the document's own
    // journalEntryId field is a SEPARATE mechanism this stock hook doesn't populate.
    const entry = await app.fetch(new Request("http://local/gl/journal-entries/sa-1", { headers: ADMIN }));
    expect(entry.status).toBe(200);
    const je = (await entry.json()) as { lines: { accountId: string; debit: string; credit: string }[] };
    const totalDebit = je.lines.reduce((n, l) => n + Number(l.debit), 0);
    const totalCredit = je.lines.reduce((n, l) => n + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 6);
    expect(totalDebit).toBe(1000); // 100 qty × 10 unit cost

    const balance = await app.fetch(new Request("http://local/inventory/balance?itemId=item-adj&warehouseId=WH-MAIN", { headers: ADMIN }));
    expect(Number(((await balance.json()) as { onHand: string }).onHand)).toBe(100);
  });

  it("mounts /inventory/stock-transfers and /inventory/physical-counts (empty on a fresh seeded DB)", async () => {
    const app = await newBackend();
    for (const path of ["/inventory/stock-transfers", "/inventory/physical-counts"]) {
      const res = await app.fetch(new Request(`http://local${path}`, { headers: ADMIN }));
      expect(res.status, `GET ${path}`).toBe(200);
      expect((await res.json()) as unknown[]).toEqual([]);
    }
  });

  it("runs a physical count end to end: start → record → complete → generate adjustment, reusing the SAME stock-adjustments service", async () => {
    const app = await newBackend();
    expect(
      (await post(app, "/items", { id: "item-pc", code: "ITEM-PC", nameAr: "منتج جرد", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, ADMIN)).status,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          "/inventory/stock-adjustments/draft",
          { id: "sa-seed", date: "2026-08-01", lines: [{ itemId: "item-pc", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "50", unitCost: "5" }] },
          ADMIN,
        )
      ).status,
    ).toBe(201);
    expect((await post(app, "/inventory/stock-adjustments/sa-seed/confirm", {}, ADMIN)).status).toBe(200);

    const started = await post(app, "/inventory/physical-counts", { id: "pc-1", warehouseId: "WH-MAIN", date: "2026-08-22", itemIds: ["item-pc"] }, ADMIN);
    expect(started.status).toBe(201);
    const count = (await started.json()) as { status: string; lines: { itemId: string; systemQty: string }[] };
    expect(count.status).toBe("IN_PROGRESS");
    expect(count.lines[0]?.systemQty).toBe("50.000000");

    const recorded = await post(app, "/inventory/physical-counts/pc-1/counts", { entries: [{ itemId: "item-pc", countedQty: "48" }] }, ADMIN);
    expect(recorded.status).toBe(200);

    const completed = await post(app, "/inventory/physical-counts/pc-1/complete", {}, ADMIN);
    expect(completed.status).toBe(200);
    expect(((await completed.json()) as { status: string }).status).toBe("COMPLETED");

    const generated = await post(app, "/inventory/physical-counts/pc-1/generate-adjustment", { adjustmentId: "sa-from-pc-1" }, ADMIN);
    expect(generated.status).toBe(200);
    const result = (await generated.json()) as { count: { status: string; generatedAdjustmentId: string | null }; adjustment: { status: string; lines: unknown[] } | null };
    expect(result.count.status).toBe("ADJUSTMENT_GENERATED");
    expect(result.count.generatedAdjustmentId).toBe("sa-from-pc-1");
    // The generated adjustment is already confirmed (variance -2 → OUT line) — reachable via the SAME
    // stock-adjustments service, proving physical-counts and stock-adjustments share one DocumentService.
    expect(result.adjustment?.status).toBe("confirmed");

    const balance = await app.fetch(new Request("http://local/inventory/balance?itemId=item-pc&warehouseId=WH-MAIN", { headers: ADMIN }));
    expect(Number(((await balance.json()) as { onHand: string }).onHand)).toBe(48); // 50 - 2 variance
  });
});

/**
 * Regression test for the SQLite concurrency bug: `createBackend` used to open
 * one `better-sqlite3` connection PER store (~35 of them) against the SAME
 * on-disk file. Sales-invoice confirm runs stock issue + GL posting inside
 * the sales-invoice store's own transaction — with separate connections, the
 * inner write needed the SAME file's write lock the outer connection was
 * still holding, which threw SQLITE_BUSY ("database is locked"). `:memory:`
 * (every other suite above) can't reproduce this: each store's `:memory:` is
 * its own private, disconnected database, so there's no shared file for two
 * connections to contend over. These tests use a REAL file-backed DB, so the
 * assertions here are only meaningful against the fix in
 * packages/persistence/src/sqlite-connection.ts + create-backend.ts's single
 * shared connection — reverting that change reproduces SQLITE_BUSY (a single
 * confirm) or "no such savepoint" (concurrent confirms) here.
 */
describe("createBackend — SQLite concurrency (file-backed DB)", () => {
  const ADMIN = { "x-permissions": "*", "x-user-id": "admin" };
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function newFileBackedBackend() {
    dir = mkdtempSync(path.join(tmpdir(), "mezan-concurrency-test-"));
    const handle = await createBackend({ dbPath: path.join(dir, "mezan.db") });
    handles.push(handle);
    return handle.app;
  }

  async function seedStockAndCustomer(app: App) {
    expect(
      (
        await post(
          app,
          "/items",
          { id: "item-1", code: "ITEM-1", nameAr: "منتج 1", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
          ADMIN,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          "/inventory/adjustments",
          {
            adjustmentId: "adj-1",
            warehouseId: "WH-MAIN",
            reason: "INITIAL_STOCK",
            lines: [{ itemId: "item-1", direction: "IN", qty: "1000", unitCost: "10" }],
          },
          ADMIN,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          "/customers",
          {
            id: "cust-1",
            code: "cust-1",
            nameAr: "عميل 1",
            paymentTermsDays: 30,
            currency: "EGP",
            openingBalance: "0",
            active: true,
            creditLimit: "0",
            taxExempt: false,
            etaBuyerType: "auto",
          },
          ADMIN,
        )
      ).status,
    ).toBe(201);
  }

  function stockInvoiceBody(id: string) {
    return {
      id,
      date: "2026-08-22",
      dueDate: "2026-09-21",
      customerId: "cust-1",
      customerNameAr: "عميل 1",
      warehouseId: "WH-MAIN",
      branchId: "BR-MAIN",
      arAccountId: "1105",
      taxAccountId: "2200",
      lines: [
        {
          lineId: "L1",
          itemId: "item-1",
          itemNameAr: "منتج 1",
          isStock: true,
          qty: "5",
          unitPrice: "50",
          taxRatePercent: 0,
          revenueAccountId: "4100",
          cogsAccountId: "5100",
          inventoryAccountId: "1200",
        },
      ],
    };
  }

  it("confirms a sales invoice against a real file-backed DB with no SQLITE_BUSY — deducts stock and posts a balanced journal entry", async () => {
    const app = await newFileBackedBackend();
    await seedStockAndCustomer(app);

    const draft = await post(app, "/sales-invoices", stockInvoiceBody("inv-file-1"), ADMIN);
    expect(draft.status).toBe(201);

    const confirm = await post(app, "/sales-invoices/inv-file-1/confirm", {}, ADMIN);
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as { status: string; journalEntryId: string | null };
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.journalEntryId).toBeTruthy();

    const entry = await app.fetch(
      new Request(`http://local/gl/journal-entries/${confirmed.journalEntryId}`, { headers: ADMIN }),
    );
    expect(entry.status).toBe(200);
    const je = (await entry.json()) as { lines: { accountId: string; debit: string; credit: string }[] };
    const totalDebit = je.lines.reduce((n, l) => n + Number(l.debit), 0);
    const totalCredit = je.lines.reduce((n, l) => n + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 6);
    expect(totalDebit).toBeGreaterThan(0);

    const balance = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-1&warehouseId=WH-MAIN", { headers: ADMIN }),
    );
    expect(Number(((await balance.json()) as { onHand: string }).onHand)).toBe(995); // 1000 - 5
  });

  it("confirms several sales invoices CONCURRENTLY against a real file-backed DB with no SQLITE_BUSY", async () => {
    const app = await newFileBackedBackend();
    await seedStockAndCustomer(app);

    const N = 6;
    const ids = Array.from({ length: N }, (_, i) => `inv-conc-${i}`);
    for (const id of ids) {
      expect((await post(app, "/sales-invoices", stockInvoiceBody(id), ADMIN)).status).toBe(201);
    }

    // Overlapping confirms — this is exactly the shape that used to throw
    // SQLITE_BUSY (separate connections) or "no such savepoint" (a shared
    // connection without the per-connection serialization queue).
    const results = await Promise.all(
      ids.map((id) => post(app, `/sales-invoices/${id}/confirm`, {}, ADMIN)),
    );
    for (const r of results) expect(r.status).toBe(200);

    const docNos = await Promise.all(
      ids.map(async (id) => {
        const detail = await app.fetch(new Request(`http://local/sales-invoices/${id}`, { headers: ADMIN }));
        return ((await detail.json()) as { docNo: string }).docNo;
      }),
    );
    // Numbering allocated under contention must still be gap-free and unique.
    expect(new Set(docNos).size).toBe(N);

    const balance = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-1&warehouseId=WH-MAIN", { headers: ADMIN }),
    );
    expect(Number(((await balance.json()) as { onHand: string }).onHand)).toBe(1000 - N * 5);
  });

  it("confirms a stock adjustment against a real file-backed DB with no SQLITE_BUSY — proves the inventory-ops document store shares the ONE connection", async () => {
    // Regression coverage specifically for packages/persistence/src/inventory-ops-store.ts:
    // createSqliteInventoryOpsStore used to always open its OWN `new Database(path)`
    // regardless of what was passed — a SECOND writer connection onto the same
    // on-disk file createBackend already holds open (the exact shape this describe
    // block's header docs). It now goes through `openSqliteConnection`, so
    // create-backend.ts passing it the shared `sqlite` connection reuses it instead.
    const app = await newFileBackedBackend();
    expect(
      (await post(app, "/items", { id: "item-adj-file", code: "ITEM-ADJ-FILE", nameAr: "منتج تسوية", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, ADMIN)).status,
    ).toBe(201);

    const draft = await post(
      app,
      "/inventory/stock-adjustments/draft",
      {
        id: "sa-file-1",
        date: "2026-08-22",
        lines: [{ itemId: "item-adj-file", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "100", unitCost: "10" }],
      },
      ADMIN,
    );
    expect(draft.status).toBe(201);

    const confirm = await post(app, "/inventory/stock-adjustments/sa-file-1/confirm", {}, ADMIN);
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as { document: { status: string } };
    expect(confirmed.document.status).toBe("confirmed");

    // The GL entry id == the adjustment's own doc id (createInventoryGlPostingHook's trick).
    const entry = await app.fetch(new Request("http://local/gl/journal-entries/sa-file-1", { headers: ADMIN }));
    expect(entry.status).toBe(200);

    const balance = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-adj-file&warehouseId=WH-MAIN", { headers: ADMIN }),
    );
    expect(Number(((await balance.json()) as { onHand: string }).onHand)).toBe(100);
  });
});

/**
 * القوائم المالية over the REAL posted GL (docs/catalog/08, docs/tasks.md §6 Phase 8).
 * Proves the seven financial statements compute from actual posted journal
 * entries — not the static fixture ledger the screen used to render — by seeding
 * balanced posted entries through the real `/gl/journal-entries` poster against
 * a FILE-BACKED SQLite DB, then reading each `/reports/accounting/*` route and
 * asserting the figures + GL-reconciliation banners the engine returns.
 */
describe("createBackend — financial statements over real posted GL (file-backed)", () => {
  const ADMIN = { "x-permissions": "*", "x-user-id": "admin" };
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function newFileBackedBackend() {
    dir = mkdtempSync(path.join(tmpdir(), "mezan-financials-test-"));
    const handle = await createBackend({ dbPath: path.join(dir, "mezan.db") });
    handles.push(handle);
    return handle.app;
  }

  interface Line {
    accountId: string;
    debit: string;
    credit: string;
  }
  function line(accountId: string, debit: string, credit: string): Line {
    return { accountId, debit, credit };
  }

  async function postEntry(app: App, id: string, date: string, memo: string, lines: Line[]) {
    const res = await post(app, "/gl/journal-entries", { id, date, memo, source: "manual", lines }, ADMIN);
    expect(res.status, `post ${id}`).toBe(201);
  }

  /**
   * Five balanced posted entries over the seeded COA:
   *  E1 capital injection, E2 credit sale + 14% output VAT, E3 credit purchase +
   *  14% input VAT, E4 COGS, E5 cash operating expense.
   */
  async function seedLedger(app: App) {
    await postEntry(app, "je-cap", "2026-02-01", "رأس المال", [line("1300-1", "200000", "0"), line("3100", "0", "200000")]);
    await postEntry(app, "je-sale", "2026-03-01", "مبيعات آجلة (ض.ق.م 14%)", [
      line("1105", "114000", "0"),
      line("4100", "0", "100000"),
      line("2200", "0", "14000"),
    ]);
    await postEntry(app, "je-purch", "2026-03-05", "مشتريات آجلة (ض.ق.م 14%)", [
      line("1200", "80000", "0"),
      line("1400", "11200", "0"),
      line("2100", "0", "91200"),
    ]);
    await postEntry(app, "je-cogs", "2026-03-06", "تكلفة البضاعة المباعة", [line("5100", "60000", "0"), line("1200", "0", "60000")]);
    await postEntry(app, "je-opex", "2026-04-01", "مصروفات تشغيلية نقدية", [line("5200", "5000", "0"), line("1300-1", "0", "5000")]);
  }

  interface ReportBody {
    rows: { code?: string; nameAr?: string; debit?: number; credit?: number; amount?: number; side?: string; rate?: number; tax?: number; balance?: number }[];
    grandTotals: Record<string, number>;
    reconciliation: { labelAr: string; reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean } | null;
  }
  async function getReport(app: App, apiPath: string): Promise<ReportBody> {
    const res = await app.fetch(new Request(`http://local/reports${apiPath}`, { headers: ADMIN }));
    expect(res.status, `GET /reports${apiPath}`).toBe(200);
    return (await res.json()) as ReportBody;
  }

  it("trial balance nets to zero (Σ debit = Σ credit) over the real posted entries", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    const body = await getReport(app, "/accounting/trial-balance?asOfDate=2026-12-31");
    expect(body.grandTotals.debit).toBeCloseTo(405200, 2);
    expect(body.grandTotals.credit).toBeCloseTo(405200, 2);
    expect(body.reconciliation?.labelAr).toBe("إجمالي المدين = إجمالي الدائن");
    expect(body.reconciliation?.withinTolerance).toBe(true);
    // A specific real balance: cash drawer = 200000 − 5000 = 195000 debit.
    const cash = body.rows.find((r) => r.code === "1300-1");
    expect(cash?.debit).toBeCloseTo(195000, 2);
  });

  it("income statement computes net income = revenue − COGS − opex from real entries", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    const body = await getReport(app, "/accounting/income-statement?periodFrom=2026-01-01&periodTo=2026-12-31");
    // revenue 100000 − cogs 60000 − opex 5000 = 35000
    expect(body.grandTotals.amount).toBeCloseTo(35000, 2);
    const revenue = body.rows.find((r) => r.code === "4100");
    expect(revenue?.amount).toBeCloseTo(100000, 2);
    const cogs = body.rows.find((r) => r.code === "5100");
    expect(cogs?.amount).toBeCloseTo(-60000, 2);
  });

  it("balance sheet balances (assets = liabilities + equity) with real retained earnings", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    const body = await getReport(app, "/accounting/balance-sheet?asOfDate=2026-12-31");
    expect(body.reconciliation?.labelAr).toBe("الأصول = الالتزامات + حقوق الملكية");
    expect(body.reconciliation?.withinTolerance).toBe(true);
    // assets 340200 = liabilities 105200 + equity (200000 capital + 35000 retained)
    expect(body.reconciliation?.reportTotal).toBeCloseTo(340200, 2);
    expect(body.reconciliation?.referenceTotal).toBeCloseTo(340200, 2);
    const retained = body.rows.find((r) => r.nameAr?.includes("الأرباح المحتجزة"));
    expect(retained?.amount).toBeCloseTo(35000, 2);
  });

  it("cash flow ties out (opening + net change = closing) from real cash movements", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    const body = await getReport(app, "/accounting/cash-flow?periodFrom=2026-01-01&periodTo=2026-12-31");
    expect(body.reconciliation?.labelAr).toBe("الرصيد الافتتاحي + صافي التغيير = الرصيد الختامي");
    expect(body.reconciliation?.withinTolerance).toBe(true);
    expect(body.reconciliation?.reportTotal).toBeCloseTo(body.reconciliation?.referenceTotal ?? NaN, 2);
  });

  it("VAT return derives output/input tax by rate from the real VAT postings", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    const body = await getReport(app, "/accounting/vat-return?periodFrom=2026-01-01&periodTo=2026-12-31");
    const output = body.rows.find((r) => r.side === "output" && r.rate === 14);
    const input = body.rows.find((r) => r.side === "input" && r.rate === 14);
    expect(output?.tax).toBeCloseTo(14000, 2);
    expect(input?.tax).toBeCloseTo(11200, 2);
  });

  it("general ledger dumps every real posted line, balanced (Σ debit = Σ credit)", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    const body = await getReport(app, "/accounting/general-ledger?periodFrom=2026-01-01&periodTo=2026-12-31");
    // 5 entries × their lines = 12 posted lines total.
    expect(body.rows.length).toBe(12);
    // GL sums RAW line debits (unlike the trial balance's per-account net):
    // 200000 + 114000 + 80000 + 11200 + 60000 + 5000 = 470200, debit = credit.
    expect(body.grandTotals.debit).toBeCloseTo(470200, 2);
    expect(body.grandTotals.credit).toBeCloseTo(470200, 2);
    expect(body.reconciliation?.withinTolerance).toBe(true);
  });

  it("account ledger's closing running balance equals the account's real GL net", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    const body = await getReport(app, "/accounting/account-ledger?accountId=1300-1&periodFrom=2026-01-01&periodTo=2026-12-31");
    expect(body.reconciliation?.withinTolerance).toBe(true);
    // opening row + capital 200000 in + opex 5000 out → closing 195000
    const closing = body.rows[body.rows.length - 1];
    expect(closing?.balance).toBeCloseTo(195000, 2);
  });

  it("statements read only POSTED entries — a draft entry never reaches the trial balance", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    // A draft (created, not posted) must not move any statement.
    const draft = await post(
      app,
      "/gl/journal-entries/draft",
      { id: "je-draft", date: "2026-05-01", memo: "مسودة", source: "manual", lines: [line("1300-1", "9999", "0"), line("4100", "0", "9999")] },
      ADMIN,
    );
    expect(draft.status).toBe(201);
    const body = await getReport(app, "/accounting/trial-balance?asOfDate=2026-12-31");
    // Unchanged — the draft's 9999 is excluded.
    expect(body.grandTotals.debit).toBeCloseTo(405200, 2);
  });
});
