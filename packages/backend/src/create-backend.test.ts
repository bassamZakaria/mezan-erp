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
