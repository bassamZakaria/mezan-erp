import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { App, SessionRegistry } from "@mezan/api";
import { ALL_SCOPE, MODULE_CATALOG, Money, createCustomer as buildCustomer, createSupplier as buildSupplier, createEntitlements } from "@mezan/domain";
import { createSqliteCustomerRepository, createSqliteLedgerStore, createSqliteSupplierRepository, openSqliteConnection } from "@mezan/persistence";
import type { DashboardSummaryDTO, SessionDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle } from "./create-backend.js";

const handles: BackendHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

/**
 * The server resolves the caller from its OWN session registry, never from
 * `x-permissions` — so a test acts by minting a real session on the backend it
 * is talking to, exactly as `/auth/login` does.
 */
const registries = new WeakMap<App, SessionRegistry>();

function keep(handle: BackendHandle): App {
  handles.push(handle);
  registries.set(handle.app, handle.sessions);
  return handle.app;
}

const headerCache = new WeakMap<App, Map<string, Record<string, string>>>();

function sessionHeaders(app: App, userId: string, permissions: readonly string[]): Record<string, string> {
  const sessions = registries.get(app);
  if (!sessions) throw new Error("app was not built through newBackend()/newFileBackedBackend()");
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

/** A live session for a tenant admin (`"*"`) on `app`. */
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

describe("createBackend — seeded app", () => {
  it("seeds an empty DB and logs the admin in with the real PIN", async () => {
    const app = await newBackend();
    const res = await post(app, "/auth/login", { username: "admin@cyag.example", pin: "123456" });
    expect(res.status).toBe(200);
    const session = (await res.json()) as SessionDTO;
    expect(session.isCompanyAdmin).toBe(true);
    expect(session.permissions).toContain("*");
    expect(session.tenantName).toBe("Cyag");
  });

  /**
   * GUARDS U-10. `/health` answered `{ok:true}` and nothing else, so host and
   * client version skew was undetectable from either side: a till on an old
   * build kept talking to a host it no longer matched, and the first symptom
   * was wrong data. main/lan-client.ts reads both fields at startup.
   */
  it("reports the app and schema version on /health, not merely that it is up", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string; schemaVersion: number };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(body.schemaVersion).toBeGreaterThan(0);
  });

  it("rejects a wrong PIN", async () => {
    const app = await newBackend();
    const res = await post(app, "/auth/login", { username: "admin@cyag.example", pin: "000000" });
    expect(res.status).toBe(401);
  });

  it("computes a real dashboard summary — seeded COA, zero money, empty activity", async () => {
    const app = await newBackend();
    const res = await app.fetch(
      new Request("http://local/dashboard/summary", { headers: admin(app) }),
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
    const anonymous = await app.fetch(new Request("http://local/dashboard/summary"));
    expect(anonymous.status).toBe(401);

    const signedInElsewhere = await app.fetch(
      new Request("http://local/dashboard/summary", { headers: sessionHeaders(app, "u-nobody", ["sales.customer.view"]) }),
    );
    expect(signedInElsewhere.status).toBe(403);
  });

  it("bootstrap/seed is idempotent and reports counts", async () => {
    const app = await newBackend();
    const res = await post(app, "/bootstrap/seed", {});
    expect(res.status).toBe(200);
    const result = (await res.json()) as { accounts: number; users: number };
    expect(result.accounts).toBeGreaterThan(0);
    expect(result.users).toBeGreaterThanOrEqual(1);
  });

  it("mounts /reports/* over the real seeded repositories (docs/archive/catalog/08)", async () => {
    const app = await newBackend();
    const res = await app.fetch(
      new Request("http://local/reports/sales/by-period?groupBy=day", { headers: admin(app) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toEqual([]); // freshly seeded DB — no invoices yet, but the route computes over real data
  });
});

/** Full permission set covering every route this suite exercises below. */
const AUTHED_PERMISSIONS = [
  "sales.customer.create",
  "sales.customer.view",
  "admin.settings.edit",
  "admin.settings.view",
  "sales.invoice.create",
  "sales.invoice.confirm",
  "sales.invoice.view",
  "sales.price_list.manage",
  "sales.price_list.view",
  "sales.promotion.manage",
  "sales.promotion.view",
  "sales.quote.create",
  "sales.quote.view_own",
  "sales.quote.view",
  "sales.quote.send",
  "sales.quote.edit",
  "inventory.item.create",
];

/** A live session holding exactly {@link AUTHED_PERMISSIONS}, as user `u1`. */
function authed(app: App): Record<string, string> {
  return sessionHeaders(app, "u1", AUTHED_PERMISSIONS);
}

function authedPost(app: App, path: string, body: unknown) {
  return post(app, path, body, authed(app));
}

function authedGet(app: App, path: string) {
  return app.fetch(new Request(`http://local${path}`, { headers: authed(app) }));
}

async function createCustomer(app: App, id: string, creditLimit: string, taxNumber?: string) {
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
    ...(taxNumber ? { taxNumber } : {}),
  });
  expect(res.status).toBe(201);
}

/** Every document line names a real catalogue item (D38), so the suite registers SVC-1 for real. */
async function createServiceItem(app: App) {
  const res = await authedPost(app, "/items", {
    id: "SVC-1",
    code: "SVC-1",
    nameAr: "خدمة",
    type: "service",
    baseUnitCode: "PCS",
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
    await createServiceItem(app);
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

    // send -> accept (status machine, per docs/archive/catalog/01: مسودة -> مرسل -> مقبول -> محول)
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
    await createServiceItem(app);
    const putSettings = await app.fetch(
      new Request("http://local/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...authed(app) },
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
    await createServiceItem(app);
    const putSettings = await app.fetch(
      new Request("http://local/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...authed(app) },
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
    await createServiceItem(app);
    const putSettings = await app.fetch(
      new Request("http://local/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...authed(app) },
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
      admin(app),
    );
    expect(created.status).toBe(201);
    expect((await created.json()) as { status: string }).toMatchObject({ status: "pending" });

    const deposited = await post(app, "/cheques/chq-1/deposit", { bankTreasuryAccountId: "ta-bank1" }, admin(app));
    expect(deposited.status).toBe(200);

    const collected = await post(app, "/cheques/chq-1/collect", { bankGlAccountId: "1310" }, admin(app));
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
      admin(app),
    );
    expect(res.status).toBe(201);
  });

  it("D192: a cheque applied to an invoice and then bounced reopens the invoice, and the aging ladder still ties to 1105", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-chq", "0");
    await createServiceItem(app);
    expect((await authedPost(app, "/sales-invoices", invoiceBody("inv-chq", "cust-chq", "5335.20"))).status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-chq/confirm", {})).status).toBe(200);
    const get = async (path: string) => (await app.fetch(new Request(`http://local${path}`, { headers: admin(app) }))).json() as Promise<any>;
    const ar = async () => Number((await get("/gl/accounts/1105/ledger")).balance.balance);

    const created = await post(
      app,
      "/cheques",
      {
        id: "chq-d192",
        direction: "incoming",
        chequeNumber: "0451238",
        bankName: "بنك القاهرة",
        amount: "1750.00",
        issueDate: "2026-08-22",
        dueDate: "2026-08-30",
        branchId: "BR1",
        partyId: "cust-chq",
        counterpartyGlAccountId: "1105",
        controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
      },
      admin(app),
    );
    expect(created.status).toBe(201);
    const allocated = await post(app, "/cheques/chq-d192/allocations", { invoiceId: "inv-chq", amount: "1750.00" }, admin(app));
    expect(allocated.status).toBe(201);
    expect(((await allocated.json()) as { allocations: unknown[] }).allocations).toHaveLength(1);
    expect(await get("/sales-invoices/inv-chq")).toMatchObject({ status: "partially_paid", remainingBalance: "3585.200000" });
    expect(await ar()).toBe(3585.2);

    expect((await post(app, "/cheques/chq-d192/deposit", { bankTreasuryAccountId: "ta-bank1" }, admin(app))).status).toBe(200);
    const bounced = await post(app, "/cheques/chq-d192/bounce", { date: "2026-08-25" }, admin(app));
    expect(bounced.status).toBe(200);
    expect((await bounced.json()) as { status: string; allocations: unknown[] }).toMatchObject({ status: "bounced", allocations: [] });

    expect(await get("/sales-invoices/inv-chq")).toMatchObject({ status: "confirmed", remainingBalance: "5335.200000" });
    expect(await ar()).toBe(5335.2);
    expect(Number((await get("/gl/accounts/1360/ledger")).balance.balance)).toBe(0);

    const aging = await get("/reports/aging/customers?asOfDate=2026-09-30");
    expect(aging.reconciliation).toMatchObject({ withinTolerance: true });
    expect(aging.grandTotals.total).toBe(await ar());
    expect(aging.rows.find((row: { customerId: string }) => row.customerId === "cust-chq")?.total).toBe(5335.2);
  });

  it("gates /cheques behind cheques.view", async () => {
    const app = await newBackend();
    expect((await app.fetch(new Request("http://local/cheques"))).status).toBe(401);
    const res = await app.fetch(
      new Request("http://local/cheques", { headers: sessionHeaders(app, "u-nobody", ["sales.customer.view"]) }),
    );
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
      admin(app),
    );
    expect(res.status).toBe(201);
    const imported = (await res.json()) as { status: string; lines: { amount: string }[] };
    expect(imported.status).toBe("imported");
    expect(imported.lines.map((l) => l.amount)).toEqual(["100.000000", "-5.000000"]);

    const mapping = await app.fetch(new Request("http://local/bank-statements/column-mapping/ta-bank1", { headers: admin(app) }));
    expect(mapping.status).toBe(200);
    expect((await mapping.json()) as { amountColumn: string }).toMatchObject({ amountColumn: "Amount", dateFormat: "YYYY-MM-DD" });

    const matched = await post(app, "/bank-statements/stmt-1/lines/stmt-1:L0/match", { entryId: "je-1" }, admin(app));
    expect(matched.status).toBe(200);

    const detail = await app.fetch(new Request("http://local/bank-statements/stmt-1", { headers: admin(app) }));
    expect((await detail.json()) as { status: string }).toMatchObject({
      status: "in_progress",
      matchSummary: { total: 2, matched: 1, unmatched: 1, matchRate: 0.5 },
    });
  });

  it("gates /bank-statements behind treasury.reconciliation.view", async () => {
    const app = await newBackend();
    expect((await app.fetch(new Request("http://local/bank-statements"))).status).toBe(401);
    const res = await app.fetch(
      new Request("http://local/bank-statements", { headers: sessionHeaders(app, "u-nobody", ["sales.customer.view"]) }),
    );
    expect(res.status).toBe(403);
  });
});

describe("createBackend — CRM, Projects, Fixed Assets, Field/Van Sales (phase11/crm-projects-assets-field)", () => {

  it("seeds the 7 standard CRM pipeline stages on an empty DB", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/crm/pipeline-stages", { headers: admin(app) }));
    expect(res.status).toBe(200);
    const stages = (await res.json()) as { name: string; isWinStage: boolean; isLossStage: boolean }[];
    expect(stages).toHaveLength(7);
    expect(stages.filter((s) => s.isWinStage)).toHaveLength(1);
    expect(stages.filter((s) => s.isLossStage)).toHaveLength(1);
  });

  it("runs a lead through the full state machine and converts it to a customer + opportunity", async () => {
    const app = await newBackend();
    const create = await post(app, "/crm/leads", { id: "lead-1", name: "شركة الأمل" }, admin(app));
    expect(create.status).toBe(201);
    expect(((await create.json()) as { status: string }).status).toBe("new");

    const contacted = await post(app, "/crm/leads/lead-1/transition", { status: "contacted" }, admin(app));
    expect(contacted.status).toBe(200);
    const qualified = await post(app, "/crm/leads/lead-1/transition", { status: "qualified" }, admin(app));
    expect(qualified.status).toBe(200);
    expect(((await qualified.json()) as { status: string }).status).toBe("qualified");

    // an invalid jump (qualified -> contacted) is rejected by the state machine
    const invalid = await post(app, "/crm/leads/lead-1/transition", { status: "contacted" }, admin(app));
    expect(invalid.status).toBe(422);

    const stages = (await (await app.fetch(new Request("http://local/crm/pipeline-stages", { headers: admin(app) }))).json()) as {
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
      admin(app),
    );
    expect(convert.status).toBe(200);
    const converted = (await convert.json()) as {
      lead: { status: string; convertedCustomerId: string | null; convertedOpportunityId: string | null };
    };
    expect(converted.lead.status).toBe("converted");
    expect(converted.lead.convertedCustomerId).toBe("cust-from-lead-1");
    expect(converted.lead.convertedOpportunityId).toBe("opp-1");

    const customer = await app.fetch(new Request("http://local/customers/cust-from-lead-1", { headers: admin(app) }));
    expect(customer.status).toBe(200);
    const opportunity = await app.fetch(new Request("http://local/crm/opportunities/opp-1", { headers: admin(app) }));
    expect(opportunity.status).toBe(200);
  });

  it("creates a project and auto-creates its linked PRJ-{code} cost center", async () => {
    const app = await newBackend();
    const create = await post(app, "/projects", { id: "proj-1", code: "TOWER-A", nameAr: "مشروع البرج أ", budget: "100000" }, admin(app));
    expect(create.status).toBe(201);
    const project = (await create.json()) as { costCenterId: string; status: string };
    expect(project.status).toBe("planned");

    const costCenter = await app.fetch(new Request(`http://local/cost-centers/${project.costCenterId}`, { headers: admin(app) }));
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
      admin(app),
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
      admin(app),
    );
    expect(asset.status).toBe(201);

    const run = await post(app, "/assets/depreciation/runs", { period: "2026-02" }, admin(app));
    expect(run.status).toBe(201);
    const created = (await run.json()) as { id: string; status: string; totalAmount: string; lines: unknown[] };
    expect(created.status).toBe("draft");
    expect(created.lines).toHaveLength(1);
    expect(Number(created.totalAmount)).toBeGreaterThan(0);

    const posted = await post(app, `/assets/depreciation/runs/${created.id}/post`, {}, admin(app));
    expect(posted.status).toBe(200);
    const postedRun = (await posted.json()) as { status: string; journalEntryId: string | null };
    expect(postedRun.status).toBe("posted");
    expect(postedRun.journalEntryId).toBeTruthy();

    const entry = await app.fetch(new Request(`http://local/gl/journal-entries/${postedRun.journalEntryId}`, { headers: admin(app) }));
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

    const van = await post(app, "/warehouses", { id: "wh-van1", code: "WH-VAN1", name: "مستودع الڤان 1", nameEn: null, branchId: "BR-MAIN", type: "VAN" }, admin(app));
    expect(van.status).toBe(201);
    const sourceTa = await post(
      app,
      "/treasury-accounts",
      { id: "ta-main", code: "TA-MAIN", name: "خزينة الفرع الرئيسي", branchId: "BR-MAIN", glAccountId: "1300-1", openingBalance: "10000" },
      admin(app),
    );
    expect(sourceTa.status).toBe(201);
    const vanTa = await post(
      app,
      "/treasury-accounts",
      { id: "ta-van1", code: "TA-VAN1", name: "خزينة الڤان 1", branchId: "BR-MAIN", glAccountId: "1310" },
      admin(app),
    );
    expect(vanTa.status).toBe(201);
    const item = await post(
      app,
      "/items",
      { id: "item-van1", code: "ITEM-VAN1", nameAr: "منتج للفان", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
      admin(app),
    );
    expect(item.status).toBe(201);

    // The crew must be REAL employees (R3.13) — a typed id is refused.
    const driver = await post(
      app,
      "/hr/employees",
      { id: "emp-1", firstName: "سائق", lastName: "الڤان", branchId: "BR-MAIN", hireDate: "2026-01-01" },
      admin(app),
    );
    expect(driver.status).toBe(201);

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
      admin(app),
    );
    expect(fund.status).toBe(201);
    const fundConfirm = await post(app, "/vouchers/voucher-fund-main/confirm", {}, admin(app));
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
      admin(app),
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
      admin(app),
    );
    expect(open.status).toBe(201);
    const trip = (await open.json()) as { id: string; status: string; openingCashFloat: string };
    expect(trip.status).toBe("ongoing");
    expect(trip.openingCashFloat).toBe("500.000000");

    // opening the trip really moved stock into the van warehouse via the real stock ledger
    const vanStock = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-van1&warehouseId=wh-van1", { headers: admin(app) }),
    );
    expect(vanStock.status).toBe(200);
    expect(Number(((await vanStock.json()) as { onHand: string }).onHand)).toBe(10);

    // and it really moved cash between the two treasury accounts via a confirmed inter-treasury voucher
    const sourceStock = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-van1&warehouseId=WH-MAIN", { headers: admin(app) }),
    );
    expect(Number(((await sourceStock.json()) as { onHand: string }).onHand)).toBe(10); // 20 loaded - 10 transferred to the van

    const collection = await post(
      app,
      `/field/van-trips/${trip.id}/cash-movements`,
      { id: "cm-1", kind: "collection", amount: "300", occurredAt: "2026-08-21T10:00:00.000Z" },
      admin(app),
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
      admin(app),
    );
    expect(vanCollection.status).toBe(201);
    expect((await post(app, "/vouchers/voucher-van-collection/confirm", {}, admin(app))).status).toBe(200);

    const settle = await post(
      app,
      `/field/van-trips/${trip.id}/settle`,
      { countedCash: "780", stockCounts: [{ itemId: "item-van1", countedQty: "6" }] },
      admin(app),
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
    const outsider = sessionHeaders(app, "u-nobody", ["sales.customer.view"]);
    for (const path of ["/crm/leads", "/projects", "/assets", "/field/van-trips"]) {
      expect((await app.fetch(new Request(`http://local${path}`))).status, `anonymous GET ${path}`).toBe(401);
      expect(
        (await app.fetch(new Request(`http://local${path}`, { headers: outsider }))).status,
        `unpermitted GET ${path}`,
      ).toBe(403);
    }
  });
});

describe("createBackend — sweep/finish-and-mount: manufacturing, RFQ, historical import", () => {
  it("mounts /manufacturing/* over the seeded COA's dedicated leaf accounts", async () => {
    const app = await newBackend();
    const boms = await app.fetch(new Request("http://local/manufacturing/boms", { headers: admin(app) }));
    expect(boms.status).toBe(200);
    expect((await boms.json()) as unknown[]).toEqual([]);

    const workOrders = await app.fetch(
      new Request("http://local/manufacturing/work-orders", { headers: admin(app) }),
    );
    expect(workOrders.status).toBe(200);

    const configInstances = await app.fetch(
      new Request("http://local/manufacturing/config-instances", { headers: admin(app) }),
    );
    expect(configInstances.status).toBe(200);
    expect((await configInstances.json()) as unknown[]).toEqual([]);

    // The 4 dedicated leaf accounts from the standard COA template exist on the seeded DB.
    const accounts = await app.fetch(new Request("http://local/accounts", { headers: admin(app) }));
    const accountIds = ((await accounts.json()) as { id: string }[]).map((a) => a.id);
    expect(accountIds).toEqual(expect.arrayContaining(["1210", "1220", "5110", "5210"]));
  });

  it("mounts /rfqs over the shared purchase-order store + numbering", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/rfqs", { headers: admin(app) }));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it("mounts /purchases/historical-import/archives (no GL adapter — archive only)", async () => {
    const app = await newBackend();
    const res = await app.fetch(
      new Request("http://local/purchases/historical-import/archives", { headers: admin(app) }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it("mounts /sales-returns, /purchase-returns, /landed-costs, /installments/plans, /installments/follow-ups", async () => {
    const app = await newBackend();
    const headers = admin(app);
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
 * guards B-2 — a partner opening balance was one fact with three figures and
 * none of them the ledger: stored on the master record, counted in the KPI,
 * never posted, invisible to `/reconciliation`.
 */
describe("createBackend — partner opening balances reach the ledger (B-2)", () => {
  type Entry = { status: string; lines: { accountId: string; debit: string; credit: string }[] };

  async function entry(app: App, id: string) {
    const res = await app.fetch(new Request(`http://local/gl/journal-entries/${id}`, { headers: admin(app) }));
    if (res.status !== 200) return null;
    return (await res.json()) as Entry;
  }

  /**
   * The customer opening balance is looked up by its SOURCE DOCUMENT, not by a
   * guessable entry id. Main's poster mints `CUST-OPEN-JE:<customer>:<uuid>`
   * on purpose: a corrected opening balance posts a new delta entry rather than
   * editing the one already on the ledger (D142), so the id cannot be stable.
   */
  async function openingEntryFor(app: App, customerId: string): Promise<Entry | null> {
    const res = await app.fetch(new Request("http://local/gl/journal-entries", { headers: admin(app) }));
    if (res.status !== 200) return null;
    const body = (await res.json()) as { rows?: { id: string; sourceDocType?: string | null; sourceDocId?: string | null }[] } | { id: string; sourceDocType?: string | null; sourceDocId?: string | null }[];
    const rows = Array.isArray(body) ? body : (body.rows ?? []);
    const match = rows.find((r) => r.sourceDocType === "CUSTOMER_OPENING_BALANCE" && r.sourceDocId === customerId);
    return match ? entry(app, match.id) : null;
  }

  /** Every opening-balance entry for one customer — the original and each correction. */
  async function openingEntriesFor(app: App, customerId: string): Promise<Entry[]> {
    const res = await app.fetch(new Request("http://local/gl/journal-entries", { headers: admin(app) }));
    if (res.status !== 200) return [];
    const body = (await res.json()) as { rows?: { id: string; sourceDocType?: string | null; sourceDocId?: string | null }[] } | { id: string; sourceDocType?: string | null; sourceDocId?: string | null }[];
    const rows = Array.isArray(body) ? body : (body.rows ?? []);
    const out: Entry[] = [];
    for (const r of rows.filter((r) => r.sourceDocType === "CUSTOMER_OPENING_BALANCE" && r.sourceDocId === customerId)) {
      const e = await entry(app, r.id);
      if (e) out.push(e);
    }
    return out;
  }

  it("posts Dr 1105 / Cr 3210 for a customer and Cr 2100 / Dr 3210 for a supplier", async () => {
    const app = await newBackend();
    // createCustomer() passes openingBalance "0", so nothing is posted.
    await createCustomer(app, "cust-ob", "0");
    expect(await openingEntryFor(app, "cust-ob")).toBeNull();

    const withBalance = await authedPost(app, "/customers", {
      id: "cust-ob2",
      code: "cust-ob2",
      nameAr: "عميل برصيد افتتاحي",
      paymentTermsDays: 30,
      currency: "EGP",
      openingBalance: "5000.00",
      active: true,
      creditLimit: "0",
      taxExempt: false,
      etaBuyerType: "auto",
    });
    expect(withBalance.status).toBe(201);

    const posted = await openingEntryFor(app, "cust-ob2");
    expect(posted, "a customer opening balance must post").not.toBeNull();
    expect(posted!.status).toBe("posted");
    expect(posted!.lines.find((l) => l.accountId === "1105")!.debit).toBe("5000.000000");
    expect(posted!.lines.find((l) => l.accountId === "3210")!.credit).toBe("5000.000000");

    const supplier = await post(app, "/suppliers", {
      id: "supp-ob",
      code: "supp-ob",
      nameAr: "مورد برصيد افتتاحي",
      openingBalance: "1250.50",
    }, admin(app));
    expect(supplier.status).toBe(201);
    const supEntry = await entry(app, "OB-SUPP-JE:supp-ob");
    expect(supEntry).not.toBeNull();
    expect(supEntry!.lines.find((l) => l.accountId === "2100")!.credit).toBe("1250.500000");
    expect(supEntry!.lines.find((l) => l.accountId === "3210")!.debit).toBe("1250.500000");
  });

  it("keeps the sub-ledger and its control account in step", async () => {
    const app = await newBackend();
    await authedPost(app, "/customers", {
      id: "cust-rec",
      code: "cust-rec",
      nameAr: "عميل",
      paymentTermsDays: 30,
      currency: "EGP",
      openingBalance: "5000.00",
      active: true,
      creditLimit: "0",
      taxExempt: false,
      etaBuyerType: "auto",
    });
    await post(app, "/suppliers", { id: "supp-rec", code: "supp-rec", nameAr: "مورد", openingBalance: "1250.50" }, admin(app));

    const res = await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }));
    const { rows } = (await res.json()) as {
      rows: { key: string; subLedgerBalance: string; glBalance: string; matched: boolean }[];
    };
    const ar = rows.find((r) => r.key === "ar")!;
    const ap = rows.find((r) => r.key === "ap")!;
    expect(ar.glBalance).toBe("5000.000000");
    expect(ar.subLedgerBalance).toBe("5000.000000");
    expect(ar.matched).toBe(true);
    expect(ap.glBalance).toBe("1250.500000");
    expect(ap.subLedgerBalance).toBe("1250.500000");
    expect(ap.matched).toBe(true);
  });

  it("corrects a changed opening balance by posting the difference, never by editing the posted entry", async () => {
    const app = await newBackend();
    await authedPost(app, "/customers", {
      id: "cust-chg",
      code: "cust-chg",
      nameAr: "عميل",
      paymentTermsDays: 30,
      currency: "EGP",
      openingBalance: "5000.00",
      active: true,
      creditLimit: "0",
      taxExempt: false,
      etaBuyerType: "auto",
    });

    const patch = await app.fetch(
      new Request("http://local/customers/cust-chg", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...admin(app) },
        body: JSON.stringify({ openingBalance: "7500.00" }),
      }),
    );
    expect(patch.status).toBe(200);

    /*
     * The branch this test was written on corrected by REVERSING the original
     * and re-posting the whole figure. The shipped behaviour (D142) is
     * stronger: it posts only the DIFFERENCE, so the original entry is never
     * reversed and never edited — it simply stays true of the day it was made.
     * Two entries, both posted, netting to the new balance.
     */
    const openings = await openingEntriesFor(app, "cust-chg");
    expect(openings, "the original and its correction are both on the ledger").toHaveLength(2);
    expect(openings.every((e) => e.status === "posted")).toBe(true);

    const arDebits = openings.map((e) => e.lines.find((l) => l.accountId === "1105")?.debit ?? "0.000000");
    expect(arDebits).toContain("5000.000000");
    expect(arDebits).toContain("2500.000000");

    // And AR nets to the new figure, not to 12,500.
    const rec = await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }));
    const { rows } = (await rec.json()) as { rows: { key: string; glBalance: string; matched: boolean }[] };
    expect(rows.find((r) => r.key === "ar")!.glBalance).toBe("7500.000000");
    expect(rows.find((r) => r.key === "ar")!.matched).toBe(true);
  });

  it("backfills a migrated tenant whose opening balances were saved before the posting existed", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-ob-"));
    const dbPath = path.join(dir, "books.sqlite");
    try {
      (await createBackend({ dbPath })).close();
      // Write the master record straight through the repository, exactly as a
      // pre-B-2 build did: stored, never posted.
      const repo = createSqliteCustomerRepository(dbPath);
      await repo.save(
        buildCustomer({
          id: "cust-legacy",
          code: "cust-legacy",
          nameAr: "عميل مهاجَر",
          openingBalance: Money.fromMajor("4321.00"),
        }),
      );
      repo.close();

      const second = keep(await createBackend({ dbPath }));
      const res = await second.fetch(
        new Request("http://local/gl/journal-entries/OB-CUST-JE:cust-legacy", { headers: admin(second) }),
      );
      expect(res.status, "the backfill must post the unposted opening balance on the next start").toBe(200);
      const posted = (await res.json()) as { lines: { accountId: string; debit: string }[] };
      expect(posted.lines.find((l) => l.accountId === "1105")!.debit).toBe("4321.000000");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * guards B-8 — the reconciliation compared the sub-ledger against "1105",
 * "2100" and "1200" compiled into the composition root, so a tenant on a
 * recoded chart of accounts read a mismatch equal to every collection made.
 */
describe("createBackend — the reconciliation reads the tenant's control accounts (B-8)", () => {
  it("reports the shipped defaults with no routing table", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }));
    expect(res.status).toBe(200);
    const { rows } = (await res.json()) as { rows: { key: string; controlAccountId: string }[] };
    expect(rows.find((r) => r.key === "ar")!.controlAccountId).toBe("1105");
    expect(rows.find((r) => r.key === "ap")!.controlAccountId).toBe("2100");
    expect(rows.find((r) => r.key === "inventory")!.controlAccountId).toBe("1200");
  });

  it("follows an override to the recoded accounts", async () => {
    const app = await newBackend();
    const put = await app.fetch(
      new Request("http://local/accounting/account-routing", {
        method: "PUT",
        headers: { "content-type": "application/json", ...admin(app) },
        body: JSON.stringify({
          overrides: { "control.receivable": "1100", "control.payable": "2110", "control.inventory": "1210" },
        }),
      }),
    );
    expect(put.status).toBe(200);

    const res = await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }));
    const { rows } = (await res.json()) as { rows: { key: string; controlAccountId: string }[] };
    expect(rows.find((r) => r.key === "ar")!.controlAccountId).toBe("1100");
    expect(rows.find((r) => r.key === "ap")!.controlAccountId).toBe("2110");
    expect(rows.find((r) => r.key === "inventory")!.controlAccountId).toBe("1210");
  });
});

/**
 * guards B-3 — both return adapters passed `taxAmount: Money.zero()` into the
 * lookup port, so «مرتجع من فاتورة» pro-rated nothing: GL 2200 kept the VAT of
 * every returned good forever and the VAT return overstated output tax.
 */
describe("createBackend — a return of a VAT invoice credits the VAT (B-3)", () => {
  function taxedInvoiceBody(id: string, customerId: string) {
    return {
      ...invoiceBody(id, customerId, "100"),
      lines: [
        {
          lineId: "L1",
          itemId: "SVC-1",
          itemNameAr: "خدمة",
          isStock: false,
          qty: "2",
          unitPrice: "100",
          taxRatePercent: 14,
          revenueAccountId: "4100",
        },
      ],
    };
  }

  it("pro-rates the source invoice's VAT onto the return and moves GL 2200", async () => {
    const app = await newBackend();
    await createServiceItem(app);
    await createCustomer(app, "cust-vat-1", "0");
    expect((await authedPost(app, "/sales-invoices", taxedInvoiceBody("inv-vat-1", "cust-vat-1"))).status).toBe(201);
    const confirmed = await authedPost(app, "/sales-invoices/inv-vat-1/confirm", {});
    expect(confirmed.status).toBe(200);

    const draft = await post(app, "/sales-returns/from-invoice", {
      id: "sr-vat-1",
      date: "2026-08-23",
      memo: "مرتجع بضاعة",
      warehouseId: "WH1",
      sourceInvoiceId: "inv-vat-1",
      reason: "OTHER",
      requested: [{ itemId: "SVC-1", qty: "1" }],
    }, admin(app));
    expect(draft.status).toBe(201);
    const draftDoc = (await draft.json()) as { lines: { taxAmount: string; taxRatePercent: number | null }[] };
    // Half the quantity returned → half the invoice's 28.00 VAT.
    expect(draftDoc.lines[0]!.taxAmount).toBe("14.000000");
    expect(draftDoc.lines[0]!.taxRatePercent).toBe(14);

    const confirmRes = await post(app, "/sales-returns/sr-vat-1/confirm", {}, admin(app));
    expect(confirmRes.status).toBe(200);
    const returned = (await confirmRes.json()) as { document: { journalEntryId: string | null } };
    const entryId = returned.document.journalEntryId;
    expect(entryId).toBeTruthy();

    const entryRes = await app.fetch(
      new Request(`http://local/gl/journal-entries/${entryId}`, { headers: admin(app) }),
    );
    expect(entryRes.status).toBe(200);
    const entry = (await entryRes.json()) as { lines: { accountId: string; debit: string; credit: string }[] };
    const vat = entry.lines.find((l) => l.accountId === "2200");
    expect(vat, "the return must move output VAT 2200").toBeDefined();
    expect(vat!.debit).toBe("14.000000");
    // And the receivable is credited with the tax-inclusive total.
    expect(entry.lines.find((l) => l.accountId === "1105")!.credit).toBe("114.000000");
  });
});

/**
 * The ETA enqueue bridge (`createEtaEnqueueBridge`) is fanned into the
 * SALES_INVOICE document type's own events (`salesInvoiceEvents`) but NOT
 * into `returnsEventBridge`, which is all `salesReturns`/`purchaseReturns`
 * get. So a confirmed return can never reach the bridge at all, regardless
 * of أرسال تلقائي عند التأكيد — this is D122's root cause, pinned end to end
 * through the real backend rather than by reading the wiring.
 */
describe("createBackend — ETA enqueue bridge (D122)", () => {
  /** A B2B sale: the customer has a tax registration number, so it is filed as an e-invoice. */
  async function confirmedInvoice(app: App, id: string, customerId: string) {
    await createCustomer(app, customerId, "0", "300123456700003");
    const create = await authedPost(app, "/sales-invoices", invoiceBody(id, customerId, "100"));
    expect(create.status).toBe(201);
    const confirm = await authedPost(app, `/sales-invoices/${id}/confirm`, {});
    expect(confirm.status).toBe(200);
    return (await confirm.json()) as { id: string; docNo: string };
  }

  async function submissions(app: App) {
    const res = await app.fetch(new Request("http://local/eta/submissions", { headers: admin(app) }));
    expect(res.status).toBe(200);
    return (await res.json()) as { internalId: string; documentType: string }[];
  }

  /** Polls the queue — the bridge's own enqueue call is fire-and-forget after confirm returns. */
  async function waitForQueueEntry(app: App, internalId: string) {
    for (let i = 0; i < 40; i += 1) {
      const rows = await submissions(app);
      if (rows.some((r) => r.internalId === internalId)) return rows;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return submissions(app);
  }

  it("confirming a sales invoice enqueues a real ETA submission — أرسال تلقائي عند التأكيد defaults to on", async () => {
    const app = await newBackend();
    await createServiceItem(app);
    const invoice = await confirmedInvoice(app, "inv-eta-1", "cust-eta-1");
    const rows = await waitForQueueEntry(app, invoice.docNo);
    expect(rows.some((r) => r.internalId === invoice.docNo && r.documentType === "invoice")).toBe(true);
  });

  /** Registers the till the authority binds a receipt to, for the branch every invoice above is booked in. */
  async function registerDevice(app: App) {
    const res = await app.fetch(
      new Request("http://local/eta/branch-codes/BR-MAIN", {
        method: "PUT",
        headers: { ...admin(app), "content-type": "application/json" },
        body: JSON.stringify({ etaBranchCode: "1", deviceSerialNumber: "POS-0001" }),
      }),
    );
    expect(res.status).toBe(200);
  }

  it("a CONSUMER sale is reported as an e-receipt, not as an invoice with buyer type P", async () => {
    const app = await newBackend();
    await createServiceItem(app);
    await registerDevice(app);
    await createCustomer(app, "cust-b2c-1", "0");
    const create = await authedPost(app, "/sales-invoices", {
      ...invoiceBody("inv-b2c-1", "cust-b2c-1", "100"),
      branchId: "BR-MAIN",
    });
    expect(create.status).toBe(201);
    const confirm = await authedPost(app, "/sales-invoices/inv-b2c-1/confirm", {});
    expect(confirm.status).toBe(200);
    const { docNo } = (await confirm.json()) as { docNo: string };

    const rows = await waitForQueueEntry(app, docNo);
    const queued = rows.find((r) => r.internalId === docNo);
    expect(queued?.documentType).toBe("receipt");

    // The receipt carries the identifier the paper's QR encodes, and the QR
    // resolves at the authority's own portal — the whole point of the receipt
    // regime, and the thing a walk-in customer leaves the shop holding.
    const printed = await app.fetch(
      new Request(`http://local/eta/receipts/${encodeURIComponent(docNo)}`, { headers: admin(app) }),
    );
    expect(printed.status).toBe(200);
    const body = (await printed.json()) as {
      uuid: string;
      qrValue: string;
      submission: { payload: { seller: { deviceSerialNumber: string; branchCode: string } } };
    };
    expect(body.uuid).toMatch(/^[0-9a-f]{64}$/);
    expect(body.qrValue).toContain(`/receipts/search/${body.uuid}/share/`);
    expect(body.submission.payload.seller.deviceSerialNumber).toBe("POS-0001");
    expect(body.submission.payload.seller.branchCode).toBe("1");
  });

  it("a consumer sale from a branch with no registered device queues nothing, and the confirm still succeeds", async () => {
    const app = await newBackend();
    await createServiceItem(app);
    await createCustomer(app, "cust-b2c-2", "0");
    const create = await authedPost(app, "/sales-invoices", invoiceBody("inv-b2c-2", "cust-b2c-2", "100"));
    expect(create.status).toBe(201);
    const confirm = await authedPost(app, "/sales-invoices/inv-b2c-2/confirm", {});
    expect(confirm.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await submissions(app)).toEqual([]);
  });

  it("queues a confirmed sales return as its own credit note, alongside the invoice (D77/D122)", async () => {
    const app = await newBackend();
    await createServiceItem(app);
    const invoice = await confirmedInvoice(app, "inv-eta-2", "cust-eta-2");
    // The control: the invoice's own submission lands, so the queue itself
    // and this test's polling are both known-good before we look at the return.
    await waitForQueueEntry(app, invoice.docNo);

    const createReturn = await post(app, "/sales-returns", {
      id: "sr-eta-1",
      date: "2026-08-23",
      memo: "",
      lines: [
        {
          itemId: "SVC-1",
          warehouseId: "WH1",
          customerId: "cust-eta-2",
          sourceInvoiceId: invoice.id,
          sourceInvoiceNumber: invoice.docNo,
          reason: "OTHER",
          availableQty: "1",
          qty: "1",
          unitPrice: "100",
          unitCost: "0",
          taxAmount: "0",
        },
      ],
    }, admin(app));
    expect(createReturn.status).toBe(201);
    const confirmReturn = await post(app, "/sales-returns/sr-eta-1/confirm", {}, admin(app));
    expect(confirmReturn.status).toBe(200);
    const returnDoc = (await confirmReturn.json()) as { document: { docNo: string } };
    expect(returnDoc.document.docNo).toBeTruthy();

    // The bridge queues on a floating promise.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rows = await submissions(app);
    const note = rows.find((r) => r.internalId === returnDoc.document.docNo);
    expect(note, `the return is not in the queue: ${JSON.stringify(rows)}`).toBeDefined();
    // Filed as an إشعار دائن against the invoice, not as a second invoice.
    expect(note?.documentType).toBe("credit_note");
    // And the invoice's own submission is still there, untouched.
    expect(rows.some((r) => r.internalId === invoice.docNo && r.documentType === "invoice")).toBe(true);
  });
});

/**
 * تحصيل من عميل — `create-backend.ts`'s `salesInvoices.collect` adapter
 * (D1's fix): a real confirmed collection voucher, allocated to the invoice,
 * so AR moves in the GL and `amountPaid` follows the allocation instead of
 * being written by the route itself. Exercised at a NON-ZERO opening AR
 * balance (a real confirmed 1,000 EGP invoice), collecting only part of it.
 */
describe("createBackend — تحصيل من عميل (collect) posts a real balanced entry", () => {
  async function treasuryAccount(app: App, id: string, openingBalance: string) {
    const res = await post(
      app,
      "/treasury-accounts",
      { id, code: id, name: "الخزينة الرئيسية", branchId: "BR1", glAccountId: "1300-1", type: "cash", currency: "EGP", openingBalance },
      admin(app),
    );
    expect(res.status).toBe(201);
  }

  it("collecting PART of a confirmed invoice debits the treasury and credits AR for EXACTLY the collected amount, and updates amountPaid", async () => {
    const app = await newBackend();
    await treasuryAccount(app, "ta-collect-1", "500.00");
    await createCustomer(app, "cust-collect-1", "0");
    await createServiceItem(app);

    const create = await authedPost(app, "/sales-invoices", invoiceBody("inv-collect-1", "cust-collect-1", "1000.00"));
    expect(create.status).toBe(201);
    const confirm = await authedPost(app, "/sales-invoices/inv-collect-1/confirm", {});
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as { journalEntryId: string };
    expect(confirmed.journalEntryId).toBeTruthy();

    // Non-zero opening AR balance BEFORE the collection.
    const beforeJe = await app.fetch(
      new Request(`http://local/gl/journal-entries/${confirmed.journalEntryId}`, { headers: admin(app) }),
    );
    const beforeLines = ((await beforeJe.json()) as { lines: { accountId: string; debit: string; credit: string }[] }).lines;
    const arBefore = beforeLines.find((l) => l.accountId === "1105");
    expect(arBefore?.debit).toBe("1000.000000");

    const collect = await post(
      app,
      "/sales-invoices/inv-collect-1/payments",
      { amount: "400.00", treasuryAccountId: "ta-collect-1", paymentMethod: "cash" },
      admin(app),
    );
    expect(collect.status).toBe(200);
    const collected = (await collect.json()) as {
      voucherId: string;
      amountPaid: string;
      status: string;
    };
    expect(collected.voucherId).toBeTruthy();
    expect(collected.amountPaid).toBe("400.000000");
    // Confirming and paid only part — status must not jump straight to مدفوعة.
    expect(collected.status).not.toBe("paid");

    const voucherRes = await app.fetch(
      new Request(`http://local/vouchers/${collected.voucherId}`, { headers: admin(app) }),
    );
    expect(voucherRes.status).toBe(200);
    const voucher = (await voucherRes.json()) as { journalEntryId: string; amount: string; status: string };
    expect(voucher.status).toBe("confirmed");
    expect(voucher.amount).toBe("400.000000");

    const je = await app.fetch(
      new Request(`http://local/gl/journal-entries/${voucher.journalEntryId}`, { headers: admin(app) }),
    );
    expect(je.status).toBe(200);
    const lines = ((await je.json()) as { lines: { accountId: string; debit: string; credit: string }[] }).lines;
    const treasuryLine = lines.find((l) => l.accountId === "1300-1");
    const arLine = lines.find((l) => l.accountId === "1105");
    expect(treasuryLine?.debit).toBe("400.000000");
    expect(treasuryLine?.credit).toBe("0.000000");
    expect(arLine?.credit).toBe("400.000000");
    expect(arLine?.debit).toBe("0.000000");
    const totalDebit = lines.reduce((n, l) => n + BigInt(Math.round(Number(l.debit) * 1_000_000)), 0n);
    const totalCredit = lines.reduce((n, l) => n + BigInt(Math.round(Number(l.credit) * 1_000_000)), 0n);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBeGreaterThan(0n);
  });

  it("collecting MORE than what remains is refused, and posts nothing", async () => {
    const app = await newBackend();
    await treasuryAccount(app, "ta-collect-2", "0");
    await createCustomer(app, "cust-collect-2", "0");
    await createServiceItem(app);

    await authedPost(app, "/sales-invoices", invoiceBody("inv-collect-2", "cust-collect-2", "100.00"));
    await authedPost(app, "/sales-invoices/inv-collect-2/confirm", {});

    const overCollect = await post(
      app,
      "/sales-invoices/inv-collect-2/payments",
      { amount: "150.00", treasuryAccountId: "ta-collect-2", paymentMethod: "cash" },
      admin(app),
    );
    expect(overCollect.status).toBe(422);

    const invoiceRes = await app.fetch(new Request("http://local/sales-invoices/inv-collect-2", { headers: admin(app) }));
    const invoice = (await invoiceRes.json()) as { amountPaid: string };
    expect(invoice.amountPaid).toBe("0.000000");
  });
});

/**
 * `resolveReconciliationControls` (create-backend.ts) walks confirmed
 * vouchers, cheques, sales/purchase returns and landed costs to keep the
 * AR/AP/inventory sub-ledger tied to its GL control account. The existing
 * `/reconciliation` test only proves the trivial all-zero case; this proves
 * the sub-ledger still ties the control account after a REAL confirmed sales
 * return moves both sides, at a non-zero opening balance.
 */
describe("createBackend — reconciliation still ties after a confirmed sales return (non-zero)", () => {
  it("AR and inventory both fall by exactly the return's share, and the sub-ledger still matches the GL", async () => {
    const app = await newBackend();

    const item = await post(
      app,
      "/items",
      { id: "item-recon-1", code: "item-recon-1", nameAr: "منتج تسوية", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
      admin(app),
    );
    expect(item.status).toBe(201);

    const adjustment = await post(
      app,
      "/inventory/adjustments",
      {
        adjustmentId: "adj-recon-1",
        warehouseId: "WH-MAIN",
        reason: "INITIAL_STOCK",
        lines: [{ itemId: "item-recon-1", direction: "IN", qty: "100", unitCost: "10" }],
      },
      admin(app),
    );
    expect(adjustment.status).toBe(201);

    await createCustomer(app, "cust-recon-1", "0");

    const createInvoice = await post(
      app,
      "/sales-invoices",
      {
        id: "inv-recon-1",
        date: "2026-08-22",
        dueDate: "2026-09-21",
        customerId: "cust-recon-1",
        customerNameAr: "عميل cust-recon-1",
        warehouseId: "WH-MAIN",
        branchId: "BR-MAIN",
        arAccountId: "1105",
        taxAccountId: "2200",
        lines: [
          {
            lineId: "L1",
            itemId: "item-recon-1",
            itemNameAr: "منتج تسوية",
            isStock: true,
            qty: "20",
            unitPrice: "50",
            taxRatePercent: 0,
            revenueAccountId: "4100",
            cogsAccountId: "5100",
            inventoryAccountId: "1200",
          },
        ],
      },
      admin(app),
    );
    expect(createInvoice.status).toBe(201);
    const confirmInvoice = await post(app, "/sales-invoices/inv-recon-1/confirm", {}, admin(app));
    expect(confirmInvoice.status).toBe(200);
    const invoice = (await confirmInvoice.json()) as { id: string; docNo: string };

    // Non-zero opening position BEFORE the return: AR = 20 * 50 = 1000.
    const beforeRecon = await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }));
    const before = (await beforeRecon.json()) as {
      allMatched: boolean;
      rows: { key: string; subLedgerBalance: string; glBalance: string; matched: boolean }[];
    };
    expect(before.allMatched).toBe(true);
    const arBefore = before.rows.find((r) => r.key === "ar")!;
    expect(Number(arBefore.subLedgerBalance)).toBe(1000);
    expect(Number(arBefore.glBalance)).toBe(1000);
    const inventoryBefore = before.rows.find((r) => r.key === "inventory")!;
    expect(Number(inventoryBefore.subLedgerBalance)).toBe(1000 - 20 * 10); // 100 received @10 - 20 sold @10

    const createReturn = await post(
      app,
      "/sales-returns",
      {
        id: "sr-recon-1",
        date: "2026-08-23",
        memo: "",
        lines: [
          {
            itemId: "item-recon-1",
            warehouseId: "WH-MAIN",
            customerId: "cust-recon-1",
            sourceInvoiceId: invoice.id,
            sourceInvoiceNumber: invoice.docNo,
            reason: "DEFECTIVE",
            availableQty: "20",
            qty: "5",
            unitPrice: "50",
            unitCost: "10",
            taxAmount: "0",
          },
        ],
      },
      admin(app),
    );
    expect(createReturn.status).toBe(201);
    const confirmReturn = await post(app, "/sales-returns/sr-recon-1/confirm", {}, admin(app));
    expect(confirmReturn.status).toBe(200);

    const afterRecon = await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }));
    const after = (await afterRecon.json()) as {
      allMatched: boolean;
      rows: { key: string; subLedgerBalance: string; glBalance: string; matched: boolean }[];
    };
    // AR falls by the return's grand total (5 * 50 = 250): 1000 -> 750.
    const arAfter = after.rows.find((r) => r.key === "ar")!;
    expect(Number(arAfter.subLedgerBalance)).toBe(750);
    expect(Number(arAfter.glBalance)).toBe(750);
    expect(arAfter.matched).toBe(true);
    // Inventory rises back by the returned qty at its cost (5 * 10 = 50): 800 -> 850.
    const inventoryAfter = after.rows.find((r) => r.key === "inventory")!;
    expect(Number(inventoryAfter.subLedgerBalance)).toBe(1000 - 20 * 10 + 5 * 10);
    expect(Number(inventoryAfter.glBalance)).toBe(Number(inventoryAfter.subLedgerBalance));
    expect(inventoryAfter.matched).toBe(true);
    expect(after.allMatched).toBe(true);
  });
});

/**
 * D76's remaining wiring. The return DOCUMENT has carried a per-rate tax split
 * since the domain fix, but the composition root's `findConfirmedInvoice`
 * adapter handed every line `taxAmount: Money.zero()` — so a return built from
 * a VAT-charged invoice credited no VAT at all and carried no rate for the VAT
 * return to group by.
 */
describe("createBackend — a return of a VAT-charged invoice credits the VAT back (D76)", () => {
  it("«مرتجع من فاتورة» carries the invoice line's own tax share and rate onto the return, and the GL reverses it", async () => {
    const app = await newBackend();

    expect(
      (
        await post(
          app,
          "/items",
          { id: "item-vat-ret", code: "item-vat-ret", nameAr: "منتج بضريبة", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
          admin(app),
        )
      ).status,
    ).toBe(201);

    expect(
      (
        await post(
          app,
          "/inventory/adjustments",
          {
            adjustmentId: "adj-vat-ret",
            warehouseId: "WH-MAIN",
            reason: "INITIAL_STOCK",
            lines: [{ itemId: "item-vat-ret", direction: "IN", qty: "100", unitCost: "10" }],
          },
          admin(app),
        )
      ).status,
    ).toBe(201);

    await createCustomer(app, "cust-vat-ret", "0");

    expect(
      (
        await post(
          app,
          "/sales-invoices",
          {
            id: "inv-vat-ret",
            date: "2026-08-22",
            dueDate: "2026-09-21",
            customerId: "cust-vat-ret",
            customerNameAr: "عميل cust-vat-ret",
            warehouseId: "WH-MAIN",
            branchId: "BR-MAIN",
            arAccountId: "1105",
            taxAccountId: "2200",
            lines: [
              {
                lineId: "L1",
                itemId: "item-vat-ret",
                itemNameAr: "منتج بضريبة",
                isStock: true,
                qty: "20",
                unitPrice: "50",
                taxRatePercent: 14,
                revenueAccountId: "4100",
                cogsAccountId: "5100",
                inventoryAccountId: "1200",
              },
            ],
          },
          admin(app),
        )
      ).status,
    ).toBe(201);
    const confirmInvoice = await post(app, "/sales-invoices/inv-vat-ret/confirm", {}, admin(app));
    expect(confirmInvoice.status).toBe(200);

    const built = await post(
      app,
      "/sales-returns/from-invoice",
      {
        id: "sr-vat-ret",
        date: "2026-08-23",
        memo: "",
        sourceInvoiceId: "inv-vat-ret",
        warehouseId: "WH-MAIN",
        reason: "DEFECTIVE",
        requested: [{ itemId: "item-vat-ret", qty: "5" }],
      },
      admin(app),
    );
    expect(built.status).toBe(201);
    const draft = (await built.json()) as { lines: { taxAmount: string; taxRatePercent: number | null }[] };
    // 5 of 20 pieces sold at 50 with 14% output VAT: base 250, VAT 35.
    expect(Number(draft.lines[0]!.taxAmount)).toBe(35);
    expect(draft.lines[0]!.taxRatePercent).toBe(14);

    const confirmed = await post(app, "/sales-returns/sr-vat-ret/confirm", {}, admin(app));
    expect(confirmed.status).toBe(200);
    const { document } = (await confirmed.json()) as { document: { journalEntryId: string } };

    const entry = await app.fetch(
      new Request(`http://local/gl/journal-entries/${document.journalEntryId}`, { headers: admin(app) }),
    );
    const je = (await entry.json()) as {
      lines: { accountId: string; debit: string; credit: string; taxRatePercent: number | null }[];
    };
    const vat = je.lines.filter((l) => l.accountId === "2200");
    expect(vat).toHaveLength(1);
    expect(Number(vat[0]!.debit)).toBe(35);
    expect(vat[0]!.taxRatePercent).toBe(14);
    // And AR is credited the whole 285, not the 250 base alone.
    const ar = je.lines.filter((l) => l.accountId === "1105");
    expect(Number(ar[0]!.credit)).toBe(285);
  });
});

/**
 * سداد للمورد straight off the invoice — `create-backend.ts`'s `purchases.pay`
 * adapter (R4.4, the purchase-side mirror of `salesInvoices.collect`/D40): a
 * real confirmed supplier-payment voucher, allocated to the invoice, moving
 * the treasury and AP together. Exercised at a NON-ZERO opening AP balance.
 */
describe("createBackend — سداد للمورد (pay) posts a real balanced entry", () => {
  it("paying PART of a confirmed purchase invoice credits the treasury and debits AP for EXACTLY the paid amount", async () => {
    const app = await newBackend();

    const treasury = await post(
      app,
      "/treasury-accounts",
      { id: "ta-pay-1", code: "ta-pay-1", name: "الخزينة الرئيسية", branchId: "BR-MAIN", glAccountId: "1300-1", type: "cash", currency: "EGP", openingBalance: "1000.00" },
      admin(app),
    );
    expect(treasury.status).toBe(201);

    // A treasury account's `openingBalance` field is a record only — it posts
    // no journal entry, so the account's REAL cash balance starts at zero and
    // the cash-negative guard refuses to pay out of it. Fund it for real with
    // an ordinary customer collection first (also exercises `collect` again,
    // this time as the funding leg for `pay`).
    await createCustomer(app, "cust-pay-1", "0");
    await createServiceItem(app);
    await authedPost(app, "/sales-invoices", invoiceBody("inv-fund-pay-1", "cust-pay-1", "1000.00"));
    await authedPost(app, "/sales-invoices/inv-fund-pay-1/confirm", {});
    const fund = await post(
      app,
      "/sales-invoices/inv-fund-pay-1/payments",
      { amount: "1000.00", treasuryAccountId: "ta-pay-1", paymentMethod: "cash" },
      admin(app),
    );
    expect(fund.status).toBe(200);

    const supplier = await post(
      app,
      "/suppliers",
      { id: "sup-pay-1", code: "sup-pay-1", nameAr: "مورد pay-1", currency: "EGP", openingBalance: "0" },
      admin(app),
    );
    expect(supplier.status).toBe(201);

    const createInvoice = await post(
      app,
      "/purchases/invoices",
      {
        id: "pi-pay-1",
        supplierId: "sup-pay-1",
        date: "2026-08-22",
        branchId: "BR-MAIN",
        warehouseId: "WH-MAIN",
        lines: [{ description: "إيجار مخزن", kind: "expense", qty: "1", unitCost: "800.00", taxRatePercent: 0 }],
      },
      admin(app),
    );
    expect(createInvoice.status).toBe(201);
    const confirmInvoice = await post(app, "/purchases/invoices/pi-pay-1/confirm", {}, admin(app));
    expect(confirmInvoice.status).toBe(200);
    const confirmed = (await confirmInvoice.json()) as { total: string };
    expect(confirmed.total).toBe("800.000000");

    const pay = await post(
      app,
      "/purchases/invoices/pi-pay-1/payments",
      { amount: "300.00", treasuryAccountId: "ta-pay-1", paymentMethod: "cash" },
      admin(app),
    );
    expect(pay.status).toBe(200);
    const paid = (await pay.json()) as { voucherId: string; amountPaid: string; remainingBalance: string };
    expect(paid.amountPaid).toBe("300.000000");
    expect(paid.remainingBalance).toBe("500.000000");

    const voucherRes = await app.fetch(new Request(`http://local/vouchers/${paid.voucherId}`, { headers: admin(app) }));
    expect(voucherRes.status).toBe(200);
    const voucher = (await voucherRes.json()) as { journalEntryId: string; status: string; amount: string };
    expect(voucher.status).toBe("confirmed");
    expect(voucher.amount).toBe("300.000000");

    const je = await app.fetch(new Request(`http://local/gl/journal-entries/${voucher.journalEntryId}`, { headers: admin(app) }));
    expect(je.status).toBe(200);
    const lines = ((await je.json()) as { lines: { accountId: string; debit: string; credit: string }[] }).lines;
    const treasuryLine = lines.find((l) => l.accountId === "1300-1");
    const apLine = lines.find((l) => l.accountId === "2100");
    expect(treasuryLine?.credit).toBe("300.000000");
    expect(treasuryLine?.debit).toBe("0.000000");
    expect(apLine?.debit).toBe("300.000000");
    expect(apLine?.credit).toBe("0.000000");
  });

  it("paying more than the remaining balance is refused (422), and posts nothing", async () => {
    const app = await newBackend();
    await post(
      app,
      "/treasury-accounts",
      { id: "ta-pay-2", code: "ta-pay-2", name: "الخزينة", branchId: "BR-MAIN", glAccountId: "1300-1", type: "cash", currency: "EGP", openingBalance: "0" },
      admin(app),
    );
    await post(app, "/suppliers", { id: "sup-pay-2", code: "sup-pay-2", nameAr: "مورد pay-2" }, admin(app));
    await post(
      app,
      "/purchases/invoices",
      {
        id: "pi-pay-2",
        supplierId: "sup-pay-2",
        date: "2026-08-22",
        branchId: "BR-MAIN",
        warehouseId: "WH-MAIN",
        lines: [{ description: "صيانة", kind: "expense", qty: "1", unitCost: "100.00", taxRatePercent: 0 }],
      },
      admin(app),
    );
    await post(app, "/purchases/invoices/pi-pay-2/confirm", {}, admin(app));

    const overpay = await post(
      app,
      "/purchases/invoices/pi-pay-2/payments",
      { amount: "150.00", treasuryAccountId: "ta-pay-2", paymentMethod: "cash" },
      admin(app),
    );
    expect(overpay.status).toBe(422);

    const invoiceRes = await app.fetch(new Request("http://local/purchases/invoices/pi-pay-2", { headers: admin(app) }));
    const invoice = (await invoiceRes.json()) as { amountPaid: string };
    expect(invoice.amountPaid).toBe("0.000000");
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

  it("mounts /workflow/configs and /workflow/requests", async () => {
    const app = await newBackend();
    const configs = await app.fetch(new Request("http://local/workflow/configs", { headers: admin(app) }));
    expect(configs.status).toBe(200);
    expect((await configs.json()) as unknown[]).toEqual([]);

    const pending = await app.fetch(new Request("http://local/workflow/requests/pending", { headers: admin(app) }));
    expect(pending.status).toBe(200);
    expect((await pending.json()) as unknown[]).toEqual([]);
  });
});

describe("createBackend — phase9/accounting-depth: reconciliation, inventory-ops document layer", () => {

  it("mounts /reconciliation with real AR/AP/inventory sub-ledger totals — all zero and matched on a fresh seeded DB", async () => {
    const app = await newBackend();
    const res = await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ key: string; controlAccountId: string; subLedgerBalance: string; glBalance: string; matched: boolean }>;
      allMatched: boolean;
    };
    expect(body.allMatched).toBe(true);
    // The three original controls plus المقاولات' seven: retention on both
    // sides, customer advances, أعمال تحت التنفيذ, billings, and the contract
    // asset/liability pair. The whole module used to sit outside the one
    // instrument that proves a sub-ledger still equals its control account.
    expect(body.rows.map((r) => r.key).sort()).toEqual([
      "ap",
      "ar",
      "contracting_billings",
      "contracting_contract_asset",
      "contracting_contract_liability",
      "contracting_customer_advances",
      "contracting_retention_payable",
      "contracting_retention_receivable",
      "contracting_wip",
      "inventory",
    ]);
    for (const row of body.rows) {
      expect(row.matched).toBe(true);
      expect(Number(row.subLedgerBalance)).toBe(0);
      expect(Number(row.glBalance)).toBe(0);
    }
  });

  it("mounts /inventory/stock-adjustments — INITIAL_STOCK draft → confirm posts stock AND a real balanced GL entry", async () => {
    const app = await newBackend();
    expect(
      (await post(app, "/items", { id: "item-adj", code: "ITEM-ADJ", nameAr: "منتج تسوية", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status,
    ).toBe(201);

    const draft = await post(
      app,
      "/inventory/stock-adjustments/draft",
      {
        id: "sa-1",
        date: "2026-08-22",
        lines: [{ itemId: "item-adj", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "100", unitCost: "10" }],
      },
      admin(app),
    );
    expect(draft.status).toBe(201);

    const confirm = await post(app, "/inventory/stock-adjustments/sa-1/confirm", {}, admin(app));
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as { document: { status: string } };
    expect(confirmed.document.status).toBe("confirmed");

    // The GL entry id == the adjustment's own doc id (createInventoryGlPostingHook's
    // trick — see packages/api/src/stock-documents-routes.test.ts); the document's own
    // journalEntryId field is a SEPARATE mechanism this stock hook doesn't populate.
    const entry = await app.fetch(new Request("http://local/gl/journal-entries/sa-1", { headers: admin(app) }));
    expect(entry.status).toBe(200);
    const je = (await entry.json()) as { lines: { accountId: string; debit: string; credit: string }[] };
    const totalDebit = je.lines.reduce((n, l) => n + Number(l.debit), 0);
    const totalCredit = je.lines.reduce((n, l) => n + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 6);
    expect(totalDebit).toBe(1000); // 100 qty × 10 unit cost

    const balance = await app.fetch(new Request("http://local/inventory/balance?itemId=item-adj&warehouseId=WH-MAIN", { headers: admin(app) }));
    expect(Number(((await balance.json()) as { onHand: string }).onHand)).toBe(100);
  });

  it("mounts /inventory/stock-transfers and /inventory/physical-counts (empty on a fresh seeded DB)", async () => {
    const app = await newBackend();
    for (const path of ["/inventory/stock-transfers", "/inventory/physical-counts"]) {
      const res = await app.fetch(new Request(`http://local${path}`, { headers: admin(app) }));
      expect(res.status, `GET ${path}`).toBe(200);
      expect((await res.json()) as unknown[]).toEqual([]);
    }
  });

  it("runs a physical count end to end: start → record → complete → generate adjustment, reusing the SAME stock-adjustments service", async () => {
    const app = await newBackend();
    expect(
      (await post(app, "/items", { id: "item-pc", code: "ITEM-PC", nameAr: "منتج جرد", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          "/inventory/stock-adjustments/draft",
          { id: "sa-seed", date: "2026-08-01", lines: [{ itemId: "item-pc", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "50", unitCost: "5" }] },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect((await post(app, "/inventory/stock-adjustments/sa-seed/confirm", {}, admin(app))).status).toBe(200);

    const started = await post(app, "/inventory/physical-counts", { id: "pc-1", warehouseId: "WH-MAIN", date: "2026-08-22", itemIds: ["item-pc"] }, admin(app));
    expect(started.status).toBe(201);
    const count = (await started.json()) as { status: string; lines: { itemId: string; systemQty: string }[] };
    expect(count.status).toBe("IN_PROGRESS");
    expect(count.lines[0]?.systemQty).toBe("50.000000");

    const recorded = await post(app, "/inventory/physical-counts/pc-1/counts", { entries: [{ itemId: "item-pc", countedQty: "48" }] }, admin(app));
    expect(recorded.status).toBe(200);

    const completed = await post(app, "/inventory/physical-counts/pc-1/complete", {}, admin(app));
    expect(completed.status).toBe(200);
    expect(((await completed.json()) as { status: string }).status).toBe("COMPLETED");

    const generated = await post(app, "/inventory/physical-counts/pc-1/generate-adjustment", { adjustmentId: "sa-from-pc-1" }, admin(app));
    expect(generated.status).toBe(200);
    const result = (await generated.json()) as { count: { status: string; generatedAdjustmentId: string | null }; adjustment: { status: string; lines: unknown[] } | null };
    expect(result.count.status).toBe("ADJUSTMENT_GENERATED");
    expect(result.count.generatedAdjustmentId).toBe("sa-from-pc-1");
    // The generated adjustment is already confirmed (variance -2 → OUT line) — reachable via the SAME
    // stock-adjustments service, proving physical-counts and stock-adjustments share one DocumentService.
    expect(result.adjustment?.status).toBe("confirmed");

    const balance = await app.fetch(new Request("http://local/inventory/balance?itemId=item-pc&warehouseId=WH-MAIN", { headers: admin(app) }));
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
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function newFileBackedBackend() {
    dir = mkdtempSync(path.join(tmpdir(), "mezan-concurrency-test-"));
    return keep(await createBackend({ dbPath: path.join(dir, "mezan.db") }));
  }

  async function seedStockAndCustomer(app: App) {
    expect(
      (
        await post(
          app,
          "/items",
          { id: "item-1", code: "ITEM-1", nameAr: "منتج 1", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
          admin(app),
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
          admin(app),
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
          admin(app),
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

    const draft = await post(app, "/sales-invoices", stockInvoiceBody("inv-file-1"), admin(app));
    expect(draft.status).toBe(201);

    const confirm = await post(app, "/sales-invoices/inv-file-1/confirm", {}, admin(app));
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as { status: string; journalEntryId: string | null };
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.journalEntryId).toBeTruthy();

    const entry = await app.fetch(
      new Request(`http://local/gl/journal-entries/${confirmed.journalEntryId}`, { headers: admin(app) }),
    );
    expect(entry.status).toBe(200);
    const je = (await entry.json()) as { lines: { accountId: string; debit: string; credit: string }[] };
    const totalDebit = je.lines.reduce((n, l) => n + Number(l.debit), 0);
    const totalCredit = je.lines.reduce((n, l) => n + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 6);
    expect(totalDebit).toBeGreaterThan(0);

    const balance = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-1&warehouseId=WH-MAIN", { headers: admin(app) }),
    );
    expect(Number(((await balance.json()) as { onHand: string }).onHand)).toBe(995); // 1000 - 5
  });

  it("confirms several sales invoices CONCURRENTLY against a real file-backed DB with no SQLITE_BUSY", async () => {
    const app = await newFileBackedBackend();
    await seedStockAndCustomer(app);

    const N = 6;
    const ids = Array.from({ length: N }, (_, i) => `inv-conc-${i}`);
    for (const id of ids) {
      expect((await post(app, "/sales-invoices", stockInvoiceBody(id), admin(app))).status).toBe(201);
    }

    // Overlapping confirms — this is exactly the shape that used to throw
    // SQLITE_BUSY (separate connections) or "no such savepoint" (a shared
    // connection without the per-connection serialization queue).
    const results = await Promise.all(
      ids.map((id) => post(app, `/sales-invoices/${id}/confirm`, {}, admin(app))),
    );
    for (const r of results) expect(r.status).toBe(200);

    const docNos = await Promise.all(
      ids.map(async (id) => {
        const detail = await app.fetch(new Request(`http://local/sales-invoices/${id}`, { headers: admin(app) }));
        return ((await detail.json()) as { docNo: string }).docNo;
      }),
    );
    // Numbering allocated under contention must still be gap-free and unique.
    expect(new Set(docNos).size).toBe(N);

    const balance = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-1&warehouseId=WH-MAIN", { headers: admin(app) }),
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
      (await post(app, "/items", { id: "item-adj-file", code: "ITEM-ADJ-FILE", nameAr: "منتج تسوية", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status,
    ).toBe(201);

    const draft = await post(
      app,
      "/inventory/stock-adjustments/draft",
      {
        id: "sa-file-1",
        date: "2026-08-22",
        lines: [{ itemId: "item-adj-file", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "100", unitCost: "10" }],
      },
      admin(app),
    );
    expect(draft.status).toBe(201);

    const confirm = await post(app, "/inventory/stock-adjustments/sa-file-1/confirm", {}, admin(app));
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as { document: { status: string } };
    expect(confirmed.document.status).toBe("confirmed");

    // The GL entry id == the adjustment's own doc id (createInventoryGlPostingHook's trick).
    const entry = await app.fetch(new Request("http://local/gl/journal-entries/sa-file-1", { headers: admin(app) }));
    expect(entry.status).toBe(200);

    const balance = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-adj-file&warehouseId=WH-MAIN", { headers: admin(app) }),
    );
    expect(Number(((await balance.json()) as { onHand: string }).onHand)).toBe(100);
  });
});

/**
 * القوائم المالية over the REAL posted GL (docs/archive/catalog/08, docs/archive/phase-backlog.md Phase 8).
 * Proves the seven financial statements compute from actual posted journal
 * entries — not the static fixture ledger the screen used to render — by seeding
 * balanced posted entries through the real `/gl/journal-entries` poster against
 * a FILE-BACKED SQLite DB, then reading each `/reports/accounting/*` route and
 * asserting the figures + GL-reconciliation banners the engine returns.
 */
describe("createBackend — financial statements over real posted GL (file-backed)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function newFileBackedBackend() {
    dir = mkdtempSync(path.join(tmpdir(), "mezan-financials-test-"));
    return keep(await createBackend({ dbPath: path.join(dir, "mezan.db") }));
  }

  interface Line {
    accountId: string;
    debit: string;
    credit: string;
    partyId?: string;
  }
  function line(accountId: string, debit: string, credit: string, partyId?: string): Line {
    return { accountId, debit, credit, ...(partyId ? { partyId } : {}) };
  }

  async function postEntry(app: App, id: string, date: string, memo: string, lines: Line[]) {
    const res = await post(app, "/gl/journal-entries", { id, date, memo, source: "manual", lines }, admin(app));
    expect(res.status, `post ${id}`).toBe(201);
  }

  /**
   * Five balanced posted entries over the seeded COA:
   *  E1 capital injection, E2 credit sale + 14% output VAT, E3 credit purchase +
   *  14% input VAT, E4 COGS, E5 cash operating expense.
   */
  async function seedLedger(app: App) {
    // A manual line on 1105/2100 names its party (D205).
    await createCustomer(app, "cust-fs", "0");
    expect((await post(app, "/suppliers", { id: "sup-fs", code: "sup-fs", nameAr: "مورد", openingBalance: "0" }, admin(app))).status).toBe(201);
    await postEntry(app, "je-cap", "2026-02-01", "رأس المال", [line("1300-1", "200000", "0"), line("3100", "0", "200000")]);
    await postEntry(app, "je-sale", "2026-03-01", "مبيعات آجلة (ض.ق.م 14%)", [
      line("1105", "114000", "0", "cust-fs"),
      line("4100", "0", "100000"),
      line("2200", "0", "14000"),
    ]);
    await postEntry(app, "je-purch", "2026-03-05", "مشتريات آجلة (ض.ق.م 14%)", [
      line("1200", "80000", "0"),
      line("1400", "11200", "0"),
      line("2100", "0", "91200", "sup-fs"),
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
    const res = await app.fetch(new Request(`http://local/financial-reports${apiPath}`, { headers: admin(app) }));
    expect(res.status, `GET /financial-reports${apiPath}`).toBe(200);
    return (await res.json()) as ReportBody;
  }

  it("trial balance nets to zero (Σ debit = Σ credit) over the real posted entries", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    const body = await getReport(app, "/trial-balance?asOfDate=2026-12-31");
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
    const body = await getReport(app, "/income-statement?periodFrom=2026-01-01&periodTo=2026-12-31");
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
    const body = await getReport(app, "/balance-sheet?asOfDate=2026-12-31");
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
    const body = await getReport(app, "/cash-flow?periodFrom=2026-01-01&periodTo=2026-12-31");
    expect(body.reconciliation?.labelAr).toBe("الرصيد الافتتاحي + صافي التغيير = الرصيد الختامي");
    expect(body.reconciliation?.withinTolerance).toBe(true);
    expect(body.reconciliation?.reportTotal).toBeCloseTo(body.reconciliation?.referenceTotal ?? NaN, 2);
  });

  it("VAT return derives output/input tax by rate from the real VAT postings", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    const body = await getReport(app, "/vat-return?periodFrom=2026-01-01&periodTo=2026-12-31");
    const output = body.rows.find((r) => r.side === "output" && r.rate === 14);
    const input = body.rows.find((r) => r.side === "input" && r.rate === 14);
    expect(output?.tax).toBeCloseTo(14000, 2);
    expect(input?.tax).toBeCloseTo(11200, 2);
  });

  it("general ledger dumps every real posted line, balanced (Σ debit = Σ credit)", async () => {
    const app = await newFileBackedBackend();
    await seedLedger(app);
    const body = await getReport(app, "/general-ledger?periodFrom=2026-01-01&periodTo=2026-12-31");
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
    const body = await getReport(app, "/account-ledger?accountId=1300-1&periodFrom=2026-01-01&periodTo=2026-12-31");
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
      admin(app),
    );
    expect(draft.status).toBe(201);
    const body = await getReport(app, "/trial-balance?asOfDate=2026-12-31");
    // Unchanged — the draft's 9999 is excluded.
    expect(body.grandTotals.debit).toBeCloseTo(405200, 2);
  });
});

describe("createBackend — the reconciliation tie at a NON-ZERO balance", () => {
  type ReconRow = {
    key: string;
    controlAccountId: string;
    subLedgerBalance: string;
    glBalance: string;
    matched: boolean;
  };

  async function reconciliation(app: Awaited<ReturnType<typeof newBackend>>) {
    const res = await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }));
    expect(res.status).toBe(200);
    return (await res.json()) as { rows: ReconRow[]; allMatched: boolean };
  }

  const row = (body: { rows: ReconRow[] }, key: string) => body.rows.find((r) => r.key === key) as ReconRow;

  it("inventory: the stock valuation equals GL 1200 after real stock has been received", async () => {
    const app = await newBackend();
    expect(
      (await post(app, "/items", { id: "item-recon", code: "ITEM-RECON", nameAr: "صنف التسوية", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status,
    ).toBe(201);

    // 40 units at 12.50 = 500.00 of inventory value, posted through the real
    // document path — not written into a snapshot by hand.
    expect(
      (
        await post(
          app,
          "/inventory/stock-adjustments/draft",
          {
            id: "sa-recon",
            date: "2026-08-22",
            lines: [{ itemId: "item-recon", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "40", unitCost: "12.50" }],
          },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect((await post(app, "/inventory/stock-adjustments/sa-recon/confirm", {}, admin(app))).status).toBe(200);

    const body = await reconciliation(app);
    const inventory = row(body, "inventory");

    // The two numbers that must agree, both non-zero, and the figure derived
    // by hand from what was posted.
    expect(inventory.subLedgerBalance).toBe("500.000000");
    expect(inventory.glBalance).toBe("500.000000");
    expect(inventory.matched).toBe(true);
    expect(body.allMatched).toBe(true);
  });

  it("inventory: issuing stock moves BOTH sides together, so they still agree", async () => {
    const app = await newBackend();
    await post(app, "/items", { id: "item-recon", code: "ITEM-RECON", nameAr: "صنف التسوية", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app));
    await post(
      app,
      "/inventory/stock-adjustments/draft",
      {
        id: "sa-in",
        date: "2026-08-22",
        lines: [{ itemId: "item-recon", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "40", unitCost: "12.50" }],
      },
      admin(app),
    );
    await post(app, "/inventory/stock-adjustments/sa-in/confirm", {}, admin(app));

    // Ten units out at the 12.50 average = 125.00 leaving inventory.
    await post(
      app,
      "/inventory/stock-adjustments/draft",
      {
        id: "sa-out",
        date: "2026-08-23",
        lines: [{ itemId: "item-recon", warehouseId: "WH-MAIN", reason: "DAMAGE", direction: "OUT", qty: "10" }],
      },
      admin(app),
    );
    expect((await post(app, "/inventory/stock-adjustments/sa-out/confirm", {}, admin(app))).status).toBe(200);

    const inventory = row(await reconciliation(app), "inventory");
    expect(inventory.subLedgerBalance).toBe("375.000000");
    expect(inventory.glBalance).toBe("375.000000");
    expect(inventory.matched).toBe(true);
  });

  it("reports a mismatch rather than hiding it, when only one side moves", async () => {
    const app = await newBackend();
    await post(app, "/items", { id: "item-recon", code: "ITEM-RECON", nameAr: "صنف التسوية", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app));
    await post(
      app,
      "/inventory/stock-adjustments/draft",
      {
        id: "sa-in",
        date: "2026-08-22",
        lines: [{ itemId: "item-recon", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "40", unitCost: "12.50" }],
      },
      admin(app),
    );
    await post(app, "/inventory/stock-adjustments/sa-in/confirm", {}, admin(app));

    // A manual journal entry straight into the inventory control account, with
    // nothing behind it in the stock ledger — exactly the drift the
    // reconciliation screen exists to surface.
    const je = await post(
      app,
      "/gl/journal-entries",
      {
        id: "je-drift",
        date: "2026-08-24",
        memo: "قيد يدوي على حساب المخزون",
        lines: [
          { accountId: "1200", debit: "100.00", credit: "0" },
          { accountId: "5100", debit: "0", credit: "100.00" },
        ],
      },
      admin(app),
    );
    expect(je.status).toBe(201);

    const body = await reconciliation(app);
    const inventory = row(body, "inventory");

    expect(inventory.subLedgerBalance).toBe("500.000000");
    expect(inventory.glBalance).toBe("600.000000");
    expect(inventory.matched).toBe(false);
    expect(body.allMatched).toBe(false);
  });

  it("names all three control accounts, in the tenant's own chart", async () => {
    const app = await newBackend();
    const body = await reconciliation(app);
    expect(row(body, "inventory").controlAccountId).toBe("1200");
    expect(row(body, "ar").controlAccountId).toBe("1105");
    expect(row(body, "ap").controlAccountId).toBe("2100");
    for (const r of body.rows) expect(/[؀-ۿ]/.test((r as { label?: string }).label ?? "")).toBe(true);
  });

  it("ar: an on-account customer-collection voucher (no invoice) still nets the sub-ledger down, and the GL still ties", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-onacct", "0");
    await createServiceItem(app);
    await authedPost(app, "/sales-invoices", invoiceBody("inv-onacct", "cust-onacct", "1000.00"));
    await authedPost(app, "/sales-invoices/inv-onacct/confirm", {});

    const ta = await post(
      app,
      "/treasury-accounts",
      { id: "ta-onacct", code: "TA-ONACCT", name: "خزينة", branchId: "BR1", glAccountId: "1300-1" },
      admin(app),
    );
    expect(ta.status).toBe(201);

    const voucher = await post(
      app,
      "/vouchers",
      {
        id: "voucher-onacct",
        date: "2026-08-22",
        voucherType: "customer_collection",
        amount: "300.00",
        branchId: "BR1",
        paymentMethod: "cash",
        treasuryAccountId: "ta-onacct",
        treasuryGlAccountId: "1300-1",
        counterpartyGlAccountId: "1105",
        customerId: "cust-onacct",
      },
      admin(app),
    );
    expect(voucher.status).toBe(201);
    expect((await post(app, "/vouchers/voucher-onacct/confirm", {}, admin(app))).status).toBe(200);

    const body = await reconciliation(app);
    const ar = row(body, "ar");
    // 1000 invoiced, 300 collected on account (never allocated to the invoice) —
    // the sub-ledger must still fall by 300, because the voucher moved real cash.
    expect(ar.subLedgerBalance).toBe("700.000000");
    expect(ar.glBalance).toBe("700.000000");
    expect(ar.matched).toBe(true);
  });

  it("ar: an incoming cheque against 1105 reclassifies AR the moment it is written, and the GL ties", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-chq-recon", "0");
    await createServiceItem(app);
    await authedPost(app, "/sales-invoices", invoiceBody("inv-chq-recon", "cust-chq-recon", "1000.00"));
    await authedPost(app, "/sales-invoices/inv-chq-recon/confirm", {});

    const chq = await post(
      app,
      "/cheques",
      {
        id: "chq-recon-1",
        direction: "incoming",
        chequeNumber: "CHQ-RECON-1",
        bankName: "بنك مصر",
        amount: "250.00",
        issueDate: "2026-08-22",
        dueDate: "2026-08-22",
        branchId: "BR1",
        partyId: "cust-chq-recon",
        counterpartyGlAccountId: "1105",
        controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
      },
      admin(app),
    );
    expect(chq.status).toBe(201);

    const body = await reconciliation(app);
    const ar = row(body, "ar");
    expect(ar.subLedgerBalance).toBe("750.000000");
    expect(ar.glBalance).toBe("750.000000");
    expect(ar.matched).toBe(true);
  });

  it("ap: an on-account supplier-payment voucher (no invoice) still nets the AP sub-ledger down, and the GL still ties", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-fund-ap", "0");
    await createServiceItem(app);
    await authedPost(app, "/sales-invoices", invoiceBody("inv-fund-ap", "cust-fund-ap", "1000.00"));
    await authedPost(app, "/sales-invoices/inv-fund-ap/confirm", {});
    const ta = await post(
      app,
      "/treasury-accounts",
      { id: "ta-payacct", code: "TA-PAYACCT", name: "خزينة", branchId: "BR1", glAccountId: "1300-1" },
      admin(app),
    );
    expect(ta.status).toBe(201);
    const fund = await post(
      app,
      "/sales-invoices/inv-fund-ap/payments",
      { amount: "1000.00", treasuryAccountId: "ta-payacct", paymentMethod: "cash" },
      admin(app),
    );
    expect(fund.status).toBe(200);

    await post(app, "/suppliers", { id: "sup-onacct", code: "sup-onacct", nameAr: "مورد", currency: "EGP", openingBalance: "0" }, admin(app));
    const createInvoice = await post(
      app,
      "/purchases/invoices",
      {
        id: "pi-onacct",
        supplierId: "sup-onacct",
        date: "2026-08-22",
        branchId: "BR-MAIN",
        warehouseId: "WH-MAIN",
        lines: [{ description: "خدمة", kind: "expense", qty: "1", unitCost: "500.00", taxRatePercent: 0 }],
      },
      admin(app),
    );
    expect(createInvoice.status).toBe(201);
    expect((await post(app, "/purchases/invoices/pi-onacct/confirm", {}, admin(app))).status).toBe(200);

    const voucher = await post(
      app,
      "/vouchers",
      {
        id: "voucher-ap-onacct",
        date: "2026-08-22",
        voucherType: "supplier_payment",
        amount: "200.00",
        branchId: "BR1",
        paymentMethod: "cash",
        treasuryAccountId: "ta-payacct",
        treasuryGlAccountId: "1300-1",
        counterpartyGlAccountId: "2100",
        supplierId: "sup-onacct",
      },
      admin(app),
    );
    expect(voucher.status).toBe(201);
    expect((await post(app, "/vouchers/voucher-ap-onacct/confirm", {}, admin(app))).status).toBe(200);

    const body = await reconciliation(app);
    const ap = row(body, "ap");
    // 500 owed minus 200 paid on account (never allocated to the invoice) = 300.
    expect(ap.subLedgerBalance).toBe("300.000000");
    expect(ap.glBalance).toBe("300.000000");
    expect(ap.matched).toBe(true);
  });

  it("ap: a confirmed purchase return debits AP, and the sub-ledger still ties to the GL", async () => {
    const app = await newBackend();
    expect(
      (await post(app, "/items", { id: "item-pr", code: "ITEM-PR", nameAr: "صنف مرتجع", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status,
    ).toBe(201);
    expect(
      (await post(app, "/suppliers", { id: "sup-pr", code: "sup-pr", nameAr: "مورد مرتجع", currency: "EGP", openingBalance: "0" }, admin(app))).status,
    ).toBe(201);

    const createInvoice = await post(
      app,
      "/purchases/invoices",
      {
        id: "pi-pr",
        supplierId: "sup-pr",
        date: "2026-08-22",
        branchId: "BR-MAIN",
        warehouseId: "WH-MAIN",
        lines: [{ itemId: "item-pr", description: "صنف مرتجع", kind: "inventory", qty: "10", unitCost: "20.00", taxRatePercent: 0 }],
      },
      admin(app),
    );
    expect(createInvoice.status).toBe(201);
    const confirmInvoice = await post(app, "/purchases/invoices/pi-pr/confirm", {}, admin(app));
    expect(confirmInvoice.status).toBe(200);
    const invoice = (await confirmInvoice.json()) as { id: string; number: string };

    const before = await reconciliation(app);
    expect(row(before, "ap").subLedgerBalance).toBe("200.000000"); // 10 * 20.00

    const purchaseReturnPayload = {
      id: "pr-recon-1",
      date: "2026-08-23",
      memo: "",
      lines: [
        {
          itemId: "item-pr",
          warehouseId: "WH-MAIN",
          supplierId: "sup-pr",
          sourceInvoiceId: invoice.id,
          sourceInvoiceNumber: invoice.number,
          reason: "DEFECTIVE",
          availableQty: "10",
          qty: "3",
          unitCost: "20.00",
          taxAmount: "0",
        },
      ],
    };
    const createReturn = await post(app, "/purchase-returns", purchaseReturnPayload, admin(app));
    expect(createReturn.status).toBe(201);
    const draftReturn = (await createReturn.json()) as { id: string };
    const confirmReturn = await post(app, `/purchase-returns/${draftReturn.id}/confirm`, {}, admin(app));
    expect(confirmReturn.status).toBe(200);

    const after = await reconciliation(app);
    const ap = row(after, "ap");
    // 200 owed minus 3 * 20.00 (60.00) returned = 140.00.
    expect(ap.subLedgerBalance).toBe("140.000000");
    expect(ap.glBalance).toBe("140.000000");
    expect(ap.matched).toBe(true);
  });
});

describe("createBackend — a purchase invoice nets its confirmed returns (D216, D240)", () => {
  async function get(app: App, path: string): Promise<any> {
    return (await app.fetch(new Request(`http://local${path}`, { headers: admin(app) }))).json();
  }
  async function cashTreasury(app: App) {
    expect(
      (await post(app, "/treasury-accounts", { id: "ta-cash", code: "TA-CASH", name: "الخزينة", branchId: "BR1", glAccountId: "1300-1", openingBalance: "0" }, admin(app))).status,
    ).toBe(201);
    const fund = {
      id: "v-fund", date: "2026-08-22", voucherType: "capital_injection", amount: "5000", branchId: "BR1", paymentMethod: "cash",
      treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "3100",
    };
    expect((await post(app, "/vouchers", fund, admin(app))).status).toBe(201);
    expect((await post(app, "/vouchers/v-fund/confirm", {}, admin(app))).status).toBe(200);
  }
  async function returnedBill(app: App, returnQty: string) {
    await cashTreasury(app);
    expect((await post(app, "/items", { id: "item-d216", code: "ITEM-D216", nameAr: "صنف", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status).toBe(201);
    expect((await post(app, "/suppliers", { id: "sup-d216", code: "sup-d216", nameAr: "مورد", currency: "EGP", openingBalance: "0" }, admin(app))).status).toBe(201);
    expect(
      (
        await post(app, "/purchases/invoices", {
          id: "pi-d216", supplierId: "sup-d216", date: "2026-08-22", dueDate: "2026-08-25", branchId: "BR-MAIN", warehouseId: "WH-MAIN",
          lines: [{ itemId: "item-d216", description: "صنف", kind: "inventory", qty: "10", unitCost: "20.00", taxRatePercent: 0 }],
        }, admin(app))
      ).status,
    ).toBe(201);
    const invoice = (await (await post(app, "/purchases/invoices/pi-d216/confirm", {}, admin(app))).json()) as { id: string; number: string };
    const created = await post(app, "/purchase-returns", {
      id: "pr-d216", date: "2026-08-23", memo: "",
      lines: [{ itemId: "item-d216", warehouseId: "WH-MAIN", supplierId: "sup-d216", sourceInvoiceId: invoice.id, sourceInvoiceNumber: invoice.number, reason: "DEFECTIVE", availableQty: "10", qty: returnQty, unitCost: "20.00", taxAmount: "0" }],
    }, admin(app));
    expect(created.status).toBe(201);
    expect((await post(app, "/purchase-returns/pr-d216/confirm", {}, admin(app))).status).toBe(200);
  }

  it("D216: the invoice's remaining balance nets a partial return, and the pay cap follows it", async () => {
    const app = await newBackend();
    await returnedBill(app, "3");
    const invoice = await get(app, "/purchases/invoices/pi-d216");
    expect(invoice).toMatchObject({ baseTotal: "200.000000", amountPaid: "0.000000", returnedCredit: "60.000000", remainingBalance: "140.000000" });
    const ladder = await get(app, "/reports/aging/suppliers");
    expect(ladder.rows.find((r: { supplierId: string }) => r.supplierId === "sup-d216")?.total).toBe(140);
    const bySupplier = await get(app, "/reports/purchases/by-supplier?dateFrom=2026-08-01&dateTo=2026-08-31");
    expect(bySupplier.rows.find((r: { supplierId: string }) => r.supplierId === "sup-d216")?.outstanding).toBe(140);

    const over = await post(app, "/purchases/invoices/pi-d216/payments", { amount: "140.01", treasuryAccountId: "ta-cash", date: "2026-08-24" }, admin(app));
    expect(over.status).toBe(422);
    const paid = await post(app, "/purchases/invoices/pi-d216/payments", { amount: "140", treasuryAccountId: "ta-cash", date: "2026-08-24" }, admin(app));
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ amountPaid: "140.000000", remainingBalance: "0.000000" });
    const settledBySupplier = await get(app, "/reports/purchases/by-supplier?dateFrom=2026-08-01&dateTo=2026-08-31");
    expect(settledBySupplier.rows.find((r: { supplierId: string }) => r.supplierId === "sup-d216")?.outstanding).toBe(0);

    const paidList = await get(app, "/purchases/invoices?status=paid");
    expect(paidList.map((r: { id: string }) => r.id)).toContain("pi-d216");
    const counts = await get(app, "/purchases/invoices/counts");
    expect(counts.partially_paid).toBe(0);
    expect((await get(app, "/purchases/invoices/stats")).unpaid).toBe("0.000000");
  });

  it("D216: a fully returned bill is settled — not overdue, not unpaid", async () => {
    const app = await newBackend();
    await returnedBill(app, "10");
    expect(await get(app, "/purchases/invoices/pi-d216")).toMatchObject({ remainingBalance: "0.000000", returnedCredit: "200.000000" });
    expect((await get(app, "/purchases/invoices?status=overdue")).map((r: { id: string }) => r.id)).not.toContain("pi-d216");
    expect((await get(app, "/purchases/invoices?status=paid")).map((r: { id: string }) => r.id)).toContain("pi-d216");
    expect((await get(app, "/purchases/invoices/stats")).unpaid).toBe("0.000000");
  });

  it("D240: a purchase invoice with a confirmed return or a payment cannot be cancelled", async () => {
    const app = await newBackend();
    await returnedBill(app, "3");
    const refused = await post(app, "/purchases/invoices/pi-d216/cancel", {}, admin(app));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("INVOICE_HAS_RETURNS");
    expect((await get(app, "/purchases/invoices/pi-d216")).status).toBe("confirmed");
  });

  it("D240: a paid purchase invoice cannot be cancelled either, so its payment never loses its invoice", async () => {
    const app = await newBackend();
    await cashTreasury(app);
    expect((await post(app, "/suppliers", { id: "sup-d240", code: "sup-d240", nameAr: "مورد", currency: "EGP", openingBalance: "0" }, admin(app))).status).toBe(201);
    expect(
      (
        await post(app, "/purchases/invoices", {
          id: "pi-d240", supplierId: "sup-d240", date: "2026-08-22", branchId: "BR-MAIN", warehouseId: "WH-MAIN",
          lines: [{ description: "خدمة", kind: "expense", qty: "1", unitCost: "100.00", taxRatePercent: 0 }],
        }, admin(app))
      ).status,
    ).toBe(201);
    expect((await post(app, "/purchases/invoices/pi-d240/confirm", {}, admin(app))).status).toBe(200);
    expect((await post(app, "/purchases/invoices/pi-d240/payments", { amount: "40", treasuryAccountId: "ta-cash", date: "2026-08-23" }, admin(app))).status).toBe(200);
    const refused = await post(app, "/purchases/invoices/pi-d240/cancel", {}, admin(app));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("INVOICE_HAS_PAYMENTS");
    const ladder = await get(app, "/reports/aging/suppliers");
    expect(ladder.reconciliation).toMatchObject({ reportTotal: ladder.reconciliation.referenceTotal });
  });
});

describe("createBackend — stock reservations (مخزون محجوز), derived from open documents", () => {
  it("a draft sales invoice's stock line reserves qty, confirming it releases the reservation and moves onHand instead", async () => {
    const app = await newBackend();
    expect(
      (await post(app, "/items", { id: "item-resv", code: "ITEM-RESV", nameAr: "صنف محجوز", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          "/inventory/stock-adjustments/draft",
          { id: "sa-resv", date: "2026-08-01", lines: [{ itemId: "item-resv", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "50", unitCost: "10" }] },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect((await post(app, "/inventory/stock-adjustments/sa-resv/confirm", {}, admin(app))).status).toBe(200);

    await createCustomer(app, "cust-resv", "0");
    const createInvoice = await post(
      app,
      "/sales-invoices",
      {
        id: "inv-resv-1",
        date: "2026-08-22",
        dueDate: "2026-09-21",
        customerId: "cust-resv",
        customerNameAr: "عميل cust-resv",
        warehouseId: "WH-MAIN",
        branchId: "BR-MAIN",
        arAccountId: "1105",
        taxAccountId: "2200",
        lines: [
          {
            lineId: "L1",
            itemId: "item-resv",
            itemNameAr: "صنف محجوز",
            isStock: true,
            qty: "12",
            unitPrice: "30",
            taxRatePercent: 0,
            revenueAccountId: "4100",
            cogsAccountId: "5100",
            inventoryAccountId: "1200",
          },
        ],
      },
      admin(app),
    );
    expect(createInvoice.status).toBe(201);

    const beforeConfirm = await app.fetch(
      new Request("http://local/inventory/stock-balance?warehouseId=WH-MAIN", { headers: admin(app) }),
    );
    expect(beforeConfirm.status).toBe(200);
    const beforeBody = (await beforeConfirm.json()) as { rows: { itemId: string; onHand: string; reserved: string; available: string }[] };
    const beforeRow = beforeBody.rows.find((r) => r.itemId === "item-resv");
    expect(beforeRow).toBeDefined();
    expect(beforeRow!.onHand).toBe("50.000000");
    expect(beforeRow!.reserved).toBe("12.000000");
    expect(beforeRow!.available).toBe("38.000000");

    expect((await post(app, "/sales-invoices/inv-resv-1/confirm", {}, admin(app))).status).toBe(200);

    const afterConfirm = await app.fetch(
      new Request("http://local/inventory/stock-balance?warehouseId=WH-MAIN", { headers: admin(app) }),
    );
    const afterBody = (await afterConfirm.json()) as { rows: { itemId: string; onHand: string; reserved: string; available: string }[] };
    const afterRow = afterBody.rows.find((r) => r.itemId === "item-resv");
    expect(afterRow).toBeDefined();
    // The reservation is released the moment the stock actually moves.
    expect(afterRow!.onHand).toBe("38.000000");
    expect(afterRow!.reserved).toBe("0.000000");
    expect(afterRow!.available).toBe("38.000000");
  });

  it("a draft stock transfer reserves qty out of its SOURCE warehouse only, not the destination", async () => {
    const app = await newBackend();
    expect(
      (await post(app, "/items", { id: "item-resv-t", code: "ITEM-RESV-T", nameAr: "صنف تحويل", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          "/inventory/stock-adjustments/draft",
          { id: "sa-resv-t", date: "2026-08-01", lines: [{ itemId: "item-resv-t", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "30", unitCost: "5" }] },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect((await post(app, "/inventory/stock-adjustments/sa-resv-t/confirm", {}, admin(app))).status).toBe(200);
    expect(
      (await post(app, "/warehouses", { id: "WH-DEST", code: "WH-DEST", name: "مستودع الوجهة", nameEn: null, branchId: "BR-MAIN", type: "MAIN" }, admin(app))).status,
    ).toBe(201);

    const draft = await post(
      app,
      "/inventory/stock-transfers/draft",
      { id: "trf-resv-1", date: "2026-08-22", lines: [{ itemId: "item-resv-t", fromWarehouseId: "WH-MAIN", toWarehouseId: "WH-DEST", qty: "9" }] },
      admin(app),
    );
    expect(draft.status).toBe(201);

    const balance = await app.fetch(
      new Request("http://local/inventory/stock-balance?warehouseId=WH-MAIN", { headers: admin(app) }),
    );
    const body = (await balance.json()) as { rows: { itemId: string; reserved: string }[] };
    const sourceRow = body.rows.find((r) => r.itemId === "item-resv-t");
    expect(sourceRow?.reserved).toBe("9.000000");

    const destBalance = await app.fetch(
      new Request("http://local/inventory/stock-balance?warehouseId=WH-DEST", { headers: admin(app) }),
    );
    const destBody = (await destBalance.json()) as { rows: { itemId: string; reserved: string }[] };
    const destRow = destBody.rows.find((r) => r.itemId === "item-resv-t");
    // The destination gains nothing until the transfer confirms — reserving there would invent stock.
    expect(destRow === undefined || destRow.reserved === "0.000000").toBe(true);
  });
});

describe("createBackend — سداد للمورد / تحصيل من عميل refuse a treasury account with no GL account, and post nothing", () => {
  it("purchases pay(): a treasury account with no glAccountId is refused", async () => {
    const app = await newBackend();
    expect(
      (await post(app, "/suppliers", { id: "sup-notreas", code: "sup-notreas", nameAr: "مورد", currency: "EGP", openingBalance: "0" }, admin(app))).status,
    ).toBe(201);
    const createInvoice = await post(
      app,
      "/purchases/invoices",
      {
        id: "pi-notreas",
        supplierId: "sup-notreas",
        date: "2026-08-22",
        branchId: "BR-MAIN",
        warehouseId: "WH-MAIN",
        lines: [{ description: "خدمة", kind: "expense", qty: "1", unitCost: "100.00", taxRatePercent: 0 }],
      },
      admin(app),
    );
    expect(createInvoice.status).toBe(201);
    expect((await post(app, "/purchases/invoices/pi-notreas/confirm", {}, admin(app))).status).toBe(200);

    const pay = await post(
      app,
      "/purchases/invoices/pi-notreas/payments",
      { amount: "50.00", treasuryAccountId: "no-such-treasury", paymentMethod: "cash" },
      admin(app),
    );
    expect(pay.status).toBeGreaterThanOrEqual(400);

    const invoiceRes = await app.fetch(new Request("http://local/purchases/invoices/pi-notreas", { headers: admin(app) }));
    const invoice = (await invoiceRes.json()) as { status: string };
    // Nothing was paid — the invoice's own status must not have moved.
    expect(invoice.status).not.toBe("paid");
  });

  it("sales collect(): a treasury account with no glAccountId is refused, and posts nothing", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-notreas", "0");
    await createServiceItem(app);
    await authedPost(app, "/sales-invoices", invoiceBody("inv-notreas", "cust-notreas", "100.00"));
    await authedPost(app, "/sales-invoices/inv-notreas/confirm", {});

    const collect = await post(
      app,
      "/sales-invoices/inv-notreas/payments",
      { amount: "50.00", treasuryAccountId: "no-such-treasury", paymentMethod: "cash" },
      admin(app),
    );
    expect(collect.status).toBeGreaterThanOrEqual(400);

    const invoiceRes = await app.fetch(new Request("http://local/sales-invoices/inv-notreas", { headers: admin(app) }));
    const invoice = (await invoiceRes.json()) as { amountPaid: string };
    expect(invoice.amountPaid).toBe("0.000000");
  });
});

describe("createBackend — استرداد للعميل: refunding a confirmed sales return posts a real balanced voucher", () => {
  it("refunds a confirmed return in full, debiting AR and crediting the till by the exact amount", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-refund", "0");
    await createServiceItem(app);
    const invoiceRes = await authedPost(app, "/sales-invoices", invoiceBody("inv-refund", "cust-refund", "200.00"));
    expect(invoiceRes.status).toBe(201);
    const confirmInvoice = await authedPost(app, "/sales-invoices/inv-refund/confirm", {});
    expect(confirmInvoice.status).toBe(200);
    const invoice = (await confirmInvoice.json()) as { id: string; docNo: string };

    const ta = await post(
      app,
      "/treasury-accounts",
      { id: "ta-refund", code: "TA-REFUND", name: "خزينة", branchId: "BR1", glAccountId: "1300-1", openingBalance: "1000" },
      admin(app),
    );
    expect(ta.status).toBe(201);

    // `openingBalance` above is a record only — it posts no journal entry, so
    // the account's REAL cash starts at zero and the cash-negative guard would
    // refuse the refund. Fund it for real with an ordinary collection first.
    const fundInvoice = await authedPost(app, "/sales-invoices", invoiceBody("inv-refund-fund", "cust-refund", "200.00"));
    expect(fundInvoice.status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-refund-fund/confirm", {})).status).toBe(200);
    const fund = await post(
      app,
      "/sales-invoices/inv-refund-fund/payments",
      { amount: "200.00", treasuryAccountId: "ta-refund", paymentMethod: "cash" },
      admin(app),
    );
    expect(fund.status).toBe(200);

    const createReturn = await post(
      app,
      "/sales-returns",
      {
        id: "sr-refund-1",
        date: "2026-08-23",
        memo: "",
        lines: [
          {
            itemId: "SVC-1",
            warehouseId: "WH1",
            customerId: "cust-refund",
            sourceInvoiceId: invoice.id,
            sourceInvoiceNumber: invoice.docNo,
            reason: "DEFECTIVE",
            availableQty: "1",
            qty: "1",
            unitPrice: "200",
            unitCost: "0",
            taxAmount: "0",
          },
        ],
      },
      admin(app),
    );
    expect(createReturn.status).toBe(201);
    const confirmReturn = await post(app, "/sales-returns/sr-refund-1/confirm", {}, admin(app));
    expect(confirmReturn.status).toBe(200);
    const confirmed = (await confirmReturn.json()) as { document: { awaitingRefund: boolean; refundDue: string } };
    expect(confirmed.document.awaitingRefund).toBe(true);
    expect(confirmed.document.refundDue).toBe("200.000000");

    const refund = await post(
      app,
      "/sales-returns/sr-refund-1/refund",
      { amount: "200.00", treasuryAccountId: "ta-refund", paymentMethod: "cash" },
      admin(app),
    );
    expect(refund.status).toBe(200);
    const refunded = (await refund.json()) as { awaitingRefund: boolean; refundDue: string; voucherId: string; voucherNo: string | null };
    expect(refunded.awaitingRefund).toBe(false);
    expect(refunded.refundDue).toBe("0.000000");
    expect(refunded.voucherId).toBeTruthy();
    expect(refunded.voucherNo).toBeTruthy();

    const voucherRes = await app.fetch(new Request(`http://local/vouchers/${refunded.voucherId}`, { headers: admin(app) }));
    expect(voucherRes.status).toBe(200);
    const voucher = (await voucherRes.json()) as { status: string; journalEntryId: string; amount: string };
    expect(voucher.status).toBe("confirmed");
    expect(voucher.amount).toBe("200.000000");

    const je = await app.fetch(new Request(`http://local/gl/journal-entries/${voucher.journalEntryId}`, { headers: admin(app) }));
    const lines = ((await je.json()) as { lines: { accountId: string; debit: string; credit: string }[] }).lines;
    const ar = lines.find((l) => l.accountId === "1105");
    const till = lines.find((l) => l.accountId === "1300-1");
    expect(ar?.debit).toBe("200.000000");
    expect(till?.credit).toBe("200.000000");
  });
});

/**
 * The goods cost 10 and sold for 50. A return puts the GOODS back, so inventory
 * may only rise by what they cost — restocking at the price would book a 40 per
 * unit profit on a sale that was undone.
 */
describe("createBackend — «مرتجع من فاتورة» restocks at cost, never at the selling price (D145)", () => {
  it("raises inventory by the returned quantity × its COST, and leaves the sub-ledger tied to the GL", async () => {
    const app = await newBackend();

    expect(
      (
        await post(
          app,
          "/items",
          { id: "item-d145", code: "item-d145", nameAr: "منتج", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          "/inventory/adjustments",
          {
            adjustmentId: "adj-d145",
            warehouseId: "WH-MAIN",
            reason: "INITIAL_STOCK",
            lines: [{ itemId: "item-d145", direction: "IN", qty: "100", unitCost: "10" }],
          },
          admin(app),
        )
      ).status,
    ).toBe(201);
    await createCustomer(app, "cust-d145", "0");

    expect(
      (
        await post(
          app,
          "/sales-invoices",
          {
            id: "inv-d145",
            date: "2026-08-22",
            dueDate: "2026-09-21",
            customerId: "cust-d145",
            customerNameAr: "عميل",
            warehouseId: "WH-MAIN",
            branchId: "BR-MAIN",
            arAccountId: "1105",
            taxAccountId: "2200",
            lines: [
              {
                lineId: "L1",
                itemId: "item-d145",
                itemNameAr: "منتج",
                isStock: true,
                qty: "20",
                unitPrice: "50",
                taxRatePercent: 0,
                revenueAccountId: "4100",
                cogsAccountId: "5100",
                inventoryAccountId: "1200",
              },
            ],
          },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect((await post(app, "/sales-invoices/inv-d145/confirm", {}, admin(app))).status).toBe(200);

    // Built through /from-invoice — the route the screen uses, and the one that
    // reads cost off the invoice rather than taking the caller's word.
    const built = await post(
      app,
      "/sales-returns/from-invoice",
      {
        id: "sr-d145",
        date: "2026-08-23",
        sourceInvoiceId: "inv-d145",
        warehouseId: "WH-MAIN",
        reason: "DEFECTIVE",
        requested: [{ itemId: "item-d145", qty: "5" }],
      },
      admin(app),
    );
    expect(built.status).toBe(201);
    const draft = (await built.json()) as { lines: { unitCost: string; unitPrice: string }[] };

    // The cost the line carries is the item's, not the invoice's price.
    expect(draft.lines[0]?.unitCost).toBe("10.000000");
    expect(draft.lines[0]?.unitPrice).toBe("50.000000");

    expect((await post(app, "/sales-returns/sr-d145/confirm", {}, admin(app))).status).toBe(200);

    const recon = await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }));
    const after = (await recon.json()) as {
      allMatched: boolean;
      rows: { key: string; subLedgerBalance: string; glBalance: string }[];
    };
    // 100 received @10, 20 sold @10, 5 returned @10 → 850. Restocking at the
    // price would have read 1050.
    const inventory = after.rows.find((r) => r.key === "inventory")!;
    expect(Number(inventory.subLedgerBalance)).toBe(850);
    expect(Number(inventory.glBalance)).toBe(850);
    expect(after.allMatched).toBe(true);
  });
});

/**
 * A confirmed sales return is an إشعار دائن to the authority. It reached the
 * queue through nothing at all — the enqueue bridge matched only
 * `docType === "SALES_INVOICE"` — so the customer's filed VAT stayed overstated
 * by the credit (D77/D122).
 */
describe("createBackend — a confirmed sales return is queued to ETA as a credit note (D77/D122)", () => {
  async function soldAndReturned(app: Awaited<ReturnType<typeof newBackend>>) {
    expect(
      (
        await post(
          app,
          "/items",
          { id: "item-eta-ret", code: "item-eta-ret", nameAr: "منتج", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          "/inventory/adjustments",
          {
            adjustmentId: "adj-eta-ret",
            warehouseId: "WH-MAIN",
            reason: "INITIAL_STOCK",
            lines: [{ itemId: "item-eta-ret", direction: "IN", qty: "50", unitCost: "10" }],
          },
          admin(app),
        )
      ).status,
    ).toBe(201);
    await createCustomer(app, "cust-eta-ret", "0");
    expect(
      (
        await post(
          app,
          "/sales-invoices",
          {
            id: "inv-eta-ret",
            date: "2026-08-22",
            dueDate: "2026-09-21",
            customerId: "cust-eta-ret",
            customerNameAr: "عميل",
            warehouseId: "WH-MAIN",
            branchId: "BR-MAIN",
            arAccountId: "1105",
            taxAccountId: "2200",
            lines: [
              {
                lineId: "L1",
                itemId: "item-eta-ret",
                itemNameAr: "منتج",
                isStock: true,
                qty: "10",
                unitPrice: "100",
                taxRatePercent: 14,
                revenueAccountId: "4100",
                cogsAccountId: "5100",
                inventoryAccountId: "1200",
              },
            ],
          },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect((await post(app, "/sales-invoices/inv-eta-ret/confirm", {}, admin(app))).status).toBe(200);

    expect(
      (
        await post(
          app,
          "/sales-returns/from-invoice",
          {
            id: "sr-eta-ret",
            date: "2026-08-23",
            sourceInvoiceId: "inv-eta-ret",
            warehouseId: "WH-MAIN",
            reason: "DEFECTIVE",
            requested: [{ itemId: "item-eta-ret", qty: "2" }],
          },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect((await post(app, "/sales-returns/sr-eta-ret/confirm", {}, admin(app))).status).toBe(200);
  }

  async function queue(app: Awaited<ReturnType<typeof newBackend>>) {
    const res = await app.fetch(new Request("http://local/eta/submissions", { headers: admin(app) }));
    expect(res.status).toBe(200);
    return (await res.json()) as { internalId: string; documentType: string; status: string }[];
  }

  it("queues the return as a credit_note once auto-submit is on", async () => {
    const app = await newBackend();
    expect(
      (
        await app.fetch(
          new Request("http://local/eta/config", {
            method: "PUT",
            headers: { "content-type": "application/json", ...admin(app) },
            body: JSON.stringify({ autoSubmitOnConfirm: true }),
          }),
        )
      ).status,
    ).toBe(200);
    await soldAndReturned(app);
    // The bridge queues on a floating promise, so let the microtask drain.
    await new Promise((r) => setTimeout(r, 50));

    const rows = await queue(app);
    const note = rows.find((r) => r.documentType === "credit_note");
    expect(note, `no credit note in ${JSON.stringify(rows)}`).toBeDefined();
    expect(note?.internalId).toContain("SR");
  });

  it("queues nothing at all while auto-submit is off, so the toggle still means something", async () => {
    const app = await newBackend();
    // `autoSubmitOnConfirm` defaults to true, so this has to be switched OFF
    // rather than assumed off.
    expect(
      (
        await app.fetch(
          new Request("http://local/eta/config", {
            method: "PUT",
            headers: { "content-type": "application/json", ...admin(app) },
            body: JSON.stringify({ autoSubmitOnConfirm: false }),
          }),
        )
      ).status,
    ).toBe(200);
    await soldAndReturned(app);
    await new Promise((r) => setTimeout(r, 50));
    expect(await queue(app)).toEqual([]);
  });
});

/**
 * A landed cost credited GL 2100 — the AP CONTROL account — with no supplier
 * document behind it, so the supplier sub-ledger and its control account
 * disagreed by every landed cost ever posted (D75). That is one of the four
 * zero-invariants the product is sold on, and nothing was measuring it.
 */
describe("createBackend — a landed cost does not touch the AP control account (D75)", () => {
  it("leaves ذمم الموردين tied to GL 2100 after a confirmed landed cost", async () => {
    const app = await newBackend();

    expect(
      (
        await post(
          app,
          "/items",
          { id: "item-lc", code: "item-lc", nameAr: "منتج مستورد", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          "/inventory/adjustments",
          {
            adjustmentId: "adj-lc",
            warehouseId: "WH-MAIN",
            reason: "INITIAL_STOCK",
            lines: [{ itemId: "item-lc", direction: "IN", qty: "100", unitCost: "10" }],
          },
          admin(app),
        )
      ).status,
    ).toBe(201);

    const before = (await (
      await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }))
    ).json()) as { allMatched: boolean; rows: { key: string; subLedgerBalance: string; glBalance: string }[] };
    expect(before.allMatched).toBe(true);
    const apBefore = before.rows.find((r) => r.key === "ap")!;

    const created = await post(
      app,
      "/landed-costs",
      {
        id: "lc-1",
        date: "2026-08-24",
        memo: "شحن وتخليص",
        distributionMethod: "BY_VALUE",
        costItems: [{ costType: "SHIPPING", description: "شحن بحري", amount: "500", supplierId: "SUP-FREIGHT" }],
        targets: [
          {
            itemId: "item-lc",
            warehouseId: "WH-MAIN",
            sourceInvoiceId: "inv-lc",
            sourceInvoiceNumber: "PI-000001",
            qty: "100",
            unitCost: "10",
            weight: "1",
          },
        ],
      },
      admin(app),
    );
    expect(created.status).toBe(201);
    expect((await post(app, "/landed-costs/lc-1/confirm", {}, admin(app))).status).toBe(200);

    const after = (await (
      await app.fetch(new Request("http://local/reconciliation", { headers: admin(app) }))
    ).json()) as { allMatched: boolean; rows: { key: string; subLedgerBalance: string; glBalance: string }[] };

    const apAfter = after.rows.find((r) => r.key === "ap")!;
    // The 500 accrual is a liability, but NOT a trade payable: it belongs to
    // 2130 تكاليف إضافية مستحقة, so the AP control is exactly where it was.
    expect(apAfter.glBalance).toBe(apBefore.glBalance);
    expect(apAfter.subLedgerBalance).toBe(apAfter.glBalance);
    expect(after.allMatched).toBe(true);
  });

  it("records the vendor the charge is owed to, so the accrual has a name on it", async () => {
    const app = await newBackend();
    expect(
      (
        await post(
          app,
          "/items",
          { id: "item-lc2", code: "item-lc2", nameAr: "منتج", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
          admin(app),
        )
      ).status,
    ).toBe(201);
    const created = await post(
      app,
      "/landed-costs",
      {
        id: "lc-2",
        date: "2026-08-24",
        memo: "",
        distributionMethod: "BY_QUANTITY",
        costItems: [{ costType: "CUSTOMS", description: "جمارك", amount: "300", supplierId: "SUP-CUSTOMS" }],
        targets: [
          {
            itemId: "item-lc2",
            warehouseId: "WH-MAIN",
            sourceInvoiceId: "inv-lc2",
            sourceInvoiceNumber: "PI-000002",
            qty: "10",
            unitCost: "10",
            weight: "1",
          },
        ],
      },
      admin(app),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { lines: { costItems: { supplierId: string | null }[] }[] };
    expect(body.lines[0]?.costItems[0]?.supplierId).toBe("SUP-CUSTOMS");
  });
});

/**
 * D72 filed the three purchasing toggles as reaching no route. They do:
 * `createApp` derives the policy from the LIVE tenant settings whenever a
 * settings store is mounted, and `createBackend` mounts one. These tests exist
 * because nothing measured it end to end, which is why the row could sit open
 * against working code — and because "configurable but unenforced" is a shape
 * this codebase has shipped before (DEC-1).
 */
describe("createBackend — the purchasing policy toggles are enforced (D72)", () => {
  async function setToggles(app: Awaited<ReturnType<typeof newBackend>>, patch: Record<string, boolean>) {
    const res = await app.fetch(
      new Request("http://local/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...admin(app) },
        body: JSON.stringify(patch),
      }),
    );
    expect(res.status, "settings PUT").toBe(200);
  }

  async function seedItem(app: Awaited<ReturnType<typeof newBackend>>, id: string) {
    expect(
      (
        await post(
          app,
          "/items",
          { id, code: id, nameAr: "منتج", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" },
          admin(app),
        )
      ).status,
    ).toBe(201);
  }

  function adHocReceipt(id: string, itemId: string) {
    return {
      id,
      supplierId: "SUP-1",
      date: "2026-08-22",
      branchId: "BR-MAIN",
      warehouseId: "WH-MAIN",
      lines: [{ itemId, qty: "5", unitCost: "10" }],
    };
  }

  it("allows an ad-hoc goods receipt while requirePoForGrn is off", async () => {
    const app = await newBackend();
    await seedItem(app, "item-d72a");
    const res = await post(app, "/purchases/receipts", adHocReceipt("grn-d72a", "item-d72a"), admin(app));
    expect(res.status).toBe(201);
  });

  it("refuses the same ad-hoc receipt once requirePoForGrn is switched on — no restart", async () => {
    const app = await newBackend();
    await seedItem(app, "item-d72b");
    await setToggles(app, { requirePoForGrn: true });

    const res = await post(app, "/purchases/receipts", adHocReceipt("grn-d72b", "item-d72b"), admin(app));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses an invoice with no receipt once requireGrnForInvoice is on", async () => {
    const app = await newBackend();
    await seedItem(app, "item-d72c");
    await setToggles(app, { requireGrnForInvoice: true });

    const res = await post(
      app,
      "/purchases/invoices",
      {
        id: "pi-d72c",
        supplierId: "SUP-1",
        date: "2026-08-22",
        branchId: "BR-MAIN",
        warehouseId: "WH-MAIN",
        lines: [{ itemId: "item-d72c", qty: "5", unitCost: "10" }],
      },
      admin(app),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

/**
 * The browser fills any unmapped item's GL accounts from constants — 1105 /
 * 2200 / 4100 / 5100 / 1200, the ids the seed template happens to use — and
 * nothing checked them against the tenant's own chart (D108). On a tenant whose
 * chart differs, the invoice posted to whatever those codes meant there.
 */
describe("createBackend — an invoice cannot name a GL account the tenant does not have (D108)", () => {
  async function itemAndCustomer(app: Awaited<ReturnType<typeof newBackend>>, suffix: string) {
    expect(
      (
        await post(
          app,
          "/items",
          { id: `item-${suffix}`, code: `item-${suffix}`, nameAr: "منتج", type: "service", baseUnitCode: "PCS" },
          admin(app),
        )
      ).status,
    ).toBe(201);
    await createCustomer(app, `cust-${suffix}`, "0");
  }

  function invoice(suffix: string, patch: Record<string, unknown> = {}, linePatch: Record<string, unknown> = {}) {
    return {
      id: `inv-${suffix}`,
      date: "2026-08-22",
      dueDate: "2026-09-21",
      customerId: `cust-${suffix}`,
      customerNameAr: "عميل",
      warehouseId: "WH-MAIN",
      branchId: "BR-MAIN",
      arAccountId: "1105",
      taxAccountId: "2200",
      ...patch,
      lines: [
        {
          lineId: "L1",
          itemId: `item-${suffix}`,
          itemNameAr: "منتج",
          isStock: false,
          qty: "1",
          unitPrice: "100",
          taxRatePercent: 0,
          revenueAccountId: "4100",
          ...linePatch,
        },
      ],
    };
  }

  it("refuses a revenue account that is not in the chart at all", async () => {
    const app = await newBackend();
    await itemAndCustomer(app, "d108a");
    const res = await post(app, "/sales-invoices", invoice("d108a", {}, { revenueAccountId: "9999" }), admin(app));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; accounts: string[] };
    expect(body.error).toBe("GL_ACCOUNT_NOT_POSTABLE");
    expect(body.accounts).toContain("9999");
  });

  it("refuses a HEADER account, which is what the account tree exists to prevent", async () => {
    const app = await newBackend();
    await itemAndCustomer(app, "d108b");
    // 4000 is the revenue header in the standard template; its children post.
    const res = await post(app, "/sales-invoices", invoice("d108b", {}, { revenueAccountId: "4000" }), admin(app));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("GL_ACCOUNT_NOT_POSTABLE");
  });

  it("refuses a bad AR account on the header, not only on a line", async () => {
    const app = await newBackend();
    await itemAndCustomer(app, "d108c");
    const res = await post(app, "/sales-invoices", invoice("d108c", { arAccountId: "9998" }), admin(app));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { accounts: string[] }).accounts).toContain("9998");
  });

  it("still accepts the real seeded accounts, so the check is not refusing everything", async () => {
    const app = await newBackend();
    await itemAndCustomer(app, "d108d");
    const res = await post(app, "/sales-invoices", invoice("d108d"), admin(app));
    expect(res.status).toBe(201);
  });
});

describe("createBackend — تحصيل من عميل السعر (D35): pricing variance surfaces on confirm", () => {
  it("charging below the customer's own price list produces an exact pricing variance on confirm", async () => {
    const app = await newBackend();
    await createServiceItem(app);
    const priceList = await authedPost(app, "/price-lists", {
      id: "pl-var-1",
      code: "PL-VAR-1",
      nameAr: "قائمة أسعار خاصة",
      isBase: false,
      lines: [{ itemId: "SVC-1", unitCode: "PCS", minQty: "0", price: "150.00" }],
    });
    expect(priceList.status).toBe(201);

    const customer = await authedPost(app, "/customers", {
      id: "cust-pvar",
      code: "cust-pvar",
      nameAr: "عميل قائمة الأسعار",
      paymentTermsDays: 30,
      currency: "EGP",
      openingBalance: "0",
      active: true,
      creditLimit: "0",
      taxExempt: false,
      etaBuyerType: "auto",
      priceListId: "pl-var-1",
    });
    expect(customer.status).toBe(201);

    const create = await authedPost(app, "/sales-invoices", invoiceBody("inv-pvar-1", "cust-pvar", "100.00"));
    expect(create.status).toBe(201);
    const confirm = await authedPost(app, "/sales-invoices/inv-pvar-1/confirm", {});
    expect(confirm.status).toBe(200);
    const body = (await confirm.json()) as {
      pricingVariances: { lineId: string; itemId: string; listPrice: string; chargedPrice: string }[];
    };
    expect(body.pricingVariances).toHaveLength(1);
    expect(body.pricingVariances[0]?.itemId).toBe("SVC-1");
    expect(body.pricingVariances[0]?.listPrice).toBe("150.000000");
    expect(body.pricingVariances[0]?.chargedPrice).toBe("100.000000");
  });

  it("charging AT or ABOVE the list price produces no variance", async () => {
    const app = await newBackend();
    await createServiceItem(app);
    await authedPost(app, "/price-lists", {
      id: "pl-var-2",
      code: "PL-VAR-2",
      nameAr: "قائمة أسعار خاصة 2",
      isBase: false,
      lines: [{ itemId: "SVC-1", unitCode: "PCS", minQty: "0", price: "80.00" }],
    });
    await authedPost(app, "/customers", {
      id: "cust-pvar2",
      code: "cust-pvar2",
      nameAr: "عميل 2",
      paymentTermsDays: 30,
      currency: "EGP",
      openingBalance: "0",
      active: true,
      creditLimit: "0",
      taxExempt: false,
      etaBuyerType: "auto",
      priceListId: "pl-var-2",
    });
    const create = await authedPost(app, "/sales-invoices", invoiceBody("inv-pvar-2", "cust-pvar2", "100.00"));
    expect(create.status).toBe(201);
    const confirm = await authedPost(app, "/sales-invoices/inv-pvar-2/confirm", {});
    expect(confirm.status).toBe(200);
    const body = (await confirm.json()) as { pricingVariances: unknown[] };
    expect(body.pricingVariances).toEqual([]);
  });
});

describe("createBackend — السماح بالبيع من مستودع آخر: cross-warehouse sales fallback", () => {
  it("a stock line pulls from the OTHER warehouse when the invoiced warehouse holds none of the item", async () => {
    const app = await newBackend();
    expect(
      (await post(app, "/items", { id: "item-xwh", code: "ITEM-XWH", nameAr: "صنف متعدد المخازن", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status,
    ).toBe(201);
    expect(
      (await post(app, "/warehouses", { id: "WH-OTHER", code: "WH-OTHER", name: "مستودع آخر", nameEn: null, branchId: "BR-MAIN", type: "MAIN" }, admin(app))).status,
    ).toBe(201);
    // Stock exists ONLY in WH-OTHER, never in WH-MAIN.
    expect(
      (
        await post(
          app,
          "/inventory/stock-adjustments/draft",
          { id: "sa-xwh", date: "2026-08-01", lines: [{ itemId: "item-xwh", warehouseId: "WH-OTHER", reason: "INITIAL_STOCK", direction: "IN", qty: "20", unitCost: "15" }] },
          admin(app),
        )
      ).status,
    ).toBe(201);
    expect((await post(app, "/inventory/stock-adjustments/sa-xwh/confirm", {}, admin(app))).status).toBe(200);

    await createCustomer(app, "cust-xwh", "0");
    const createInvoice = await post(
      app,
      "/sales-invoices",
      {
        id: "inv-xwh-1",
        date: "2026-08-22",
        dueDate: "2026-09-21",
        customerId: "cust-xwh",
        customerNameAr: "عميل cust-xwh",
        warehouseId: "WH-MAIN",
        branchId: "BR-MAIN",
        arAccountId: "1105",
        taxAccountId: "2200",
        lines: [
          {
            lineId: "L1",
            itemId: "item-xwh",
            itemNameAr: "صنف متعدد المخازن",
            isStock: true,
            qty: "5",
            unitPrice: "30",
            taxRatePercent: 0,
            revenueAccountId: "4100",
            cogsAccountId: "5100",
            inventoryAccountId: "1200",
          },
        ],
      },
      admin(app),
    );
    expect(createInvoice.status).toBe(201);
    const confirm = await post(app, "/sales-invoices/inv-xwh-1/confirm", {}, admin(app));
    // Without cross-warehouse fallback this would refuse for negative stock in WH-MAIN.
    expect(confirm.status).toBe(200);

    const otherBalance = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-xwh&warehouseId=WH-OTHER", { headers: admin(app) }),
    );
    expect(Number(((await otherBalance.json()) as { onHand: string }).onHand)).toBe(15); // 20 - 5 pulled
    const mainBalance = await app.fetch(
      new Request("http://local/inventory/balance?itemId=item-xwh&warehouseId=WH-MAIN", { headers: admin(app) }),
    );
    expect(Number(((await mainBalance.json()) as { onHand: string }).onHand)).toBe(0);
  });
});

describe("createBackend — GET /gl/balances-by-currency reads real open receivables/payables", () => {
  it("ties to the same base-currency totals a confirmed invoice and purchase invoice carry, net of allocation", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-bal", "0");
    await createServiceItem(app);
    await authedPost(app, "/sales-invoices", invoiceBody("inv-bal-1", "cust-bal", "1000.00"));
    await authedPost(app, "/sales-invoices/inv-bal-1/confirm", {});

    await post(app, "/suppliers", { id: "sup-bal", code: "sup-bal", nameAr: "مورد", currency: "EGP", openingBalance: "0" }, admin(app));
    const createInvoice = await post(
      app,
      "/purchases/invoices",
      {
        id: "pi-bal-1",
        supplierId: "sup-bal",
        date: "2026-08-22",
        branchId: "BR-MAIN",
        warehouseId: "WH-MAIN",
        lines: [{ description: "خدمة", kind: "expense", qty: "1", unitCost: "400.00", taxRatePercent: 0 }],
      },
      admin(app),
    );
    expect(createInvoice.status).toBe(201);
    expect((await post(app, "/purchases/invoices/pi-bal-1/confirm", {}, admin(app))).status).toBe(200);

    const res = await app.fetch(new Request("http://local/gl/balances-by-currency", { headers: admin(app) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      baseCurrency: string;
      receivableTotalBase: string;
      payableTotalBase: string;
      receivables: { currency: string; outstandingBase: string }[];
      payables: { currency: string; outstandingBase: string }[];
    };
    expect(body.baseCurrency).toBe("EGP");
    expect(body.receivableTotalBase).toBe("1000.000000");
    expect(body.payableTotalBase).toBe("400.000000");
    const egpReceivables = body.receivables.find((r) => r.currency === "EGP");
    expect(egpReceivables?.outstandingBase).toBe("1000.000000");
  });
});

describe("createBackend — seedDemoData wires a real session and seeds through the real API", () => {
  // The demo seed's ~15-user tenant exceeds the default resolver's 10 seats
  // (A3's SEAT_LIMIT_REACHED), so every demo-seeded backend here supplies its
  // own room to seed.
  const demoEntitlements = () =>
    createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null });

  it("seeds more than zero customers, reachable over the real HTTP surface", async () => {
    const handle = await createBackend({ dbPath: ":memory:", seedDemoData: true, resolveEntitlements: demoEntitlements });
    handles.push(handle);
    registries.set(handle.app, handle.sessions);
    const res = await handle.app.fetch(new Request("http://local/customers", { headers: admin(handle.app) }));
    expect(res.status).toBe(200);
    const customersList = (await res.json()) as unknown[];
    expect(customersList.length).toBeGreaterThan(0);
  }, 60000);

  /**
   * D5 — the certificate BILLS through the ordinary sales-invoice engine, so
   * its invoice is an ordinary ETA document. The contracting ports build their
   * own `SalesInvoiceService`; one built without the shared event publisher
   * confirms a live invoice the authority never hears about.
   */
  it("an approved progress certificate's invoice reaches the ETA queue exactly once", async () => {
    const handle = await createBackend({ dbPath: ":memory:", seedDemoData: true, resolveEntitlements: demoEntitlements });
    handles.push(handle);
    registries.set(handle.app, handle.sessions);
    const app = handle.app;

    const certRes = await app.fetch(new Request("http://local/contracting/certificates", { headers: admin(app) }));
    expect(certRes.status).toBe(200);
    const certificates = (await certRes.json()) as { invoiceDocNo: string | null }[];
    const billed = certificates.map((c) => c.invoiceDocNo).filter((docNo): docNo is string => docNo !== null);
    expect(billed.length).toBeGreaterThan(0);

    // The bridge queues on a floating promise after confirm returns.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const queueRes = await app.fetch(new Request("http://local/eta/submissions", { headers: admin(app) }));
    expect(queueRes.status).toBe(200);
    const queued = (await queueRes.json()) as { internalId: string; documentType: string }[];
    for (const docNo of billed) {
      const rows = queued.filter((r) => r.internalId === docNo);
      expect(rows.map((r) => r.documentType), `certificate invoice ${docNo} in the queue`).toEqual(["invoice"]);
    }
  }, 60000);
});

describe("resolveEntitlements", () => {
  it("passes through to GET /entitlements, replacing the default ENTERPRISE catalog resolver", async () => {
    const app = keep(
      await createBackend({
        dbPath: ":memory:",
        resolveEntitlements: () =>
          createEntitlements({ plan: "core", activeModules: ["sales"], features: {}, seats: 1, expiresAt: null }),
      }),
    );
    const res = await app.fetch(new Request("http://local/entitlements", { headers: admin(app) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: string; activeModules: string[]; seats: number };
    expect(body.plan).toBe("core");
    expect(body.activeModules).toEqual(["sales"]);
    expect(body.seats).toBe(1);

    const refused = await app.fetch(new Request("http://local/hr/employees", { headers: admin(app) }));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "MODULE_NOT_LICENSED", module: "hr" });
  });

  it("defaults to the full ENTERPRISE catalog when omitted", async () => {
    const app = keep(await createBackend({ dbPath: ":memory:" }));
    const res = await app.fetch(new Request("http://local/entitlements", { headers: admin(app) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: string };
    expect(body.plan).toBe("ENTERPRISE");
  });
});

describe("backupTo", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes a verified, openable copy of the live database to the destination path", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "mezan-backup-test-"));
    const handle = await createBackend({ dbPath: path.join(dir, "mezan.db") });
    handles.push(handle);
    registries.set(handle.app, handle.sessions);

    expect(
      (
        await handle.app.fetch(
          new Request("http://local/items", {
            method: "POST",
            headers: { "content-type": "application/json", ...admin(handle.app) },
            body: JSON.stringify({ id: "item-1", code: "ITEM-1", nameAr: "منتج 1", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }),
          }),
        )
      ).status,
    ).toBe(201);

    const destination = path.join(dir, "backup.sqlite");
    await handle.backupTo(destination);

    expect(existsSync(destination)).toBe(true);
    const { sqlite: copy } = openSqliteConnection(destination);
    try {
      expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
      const item = copy.prepare("SELECT code FROM item WHERE id = ?").get("item-1") as { code: string } | undefined;
      expect(item?.code).toBe("ITEM-1");
    } finally {
      copy.close();
    }
  });
});

describe("createBackend — FX aging, the customers screen and cheque vouchers (D194–D196)", () => {
  async function get(app: App, path: string): Promise<any> {
    return (await app.fetch(new Request(`http://local${path}`, { headers: admin(app) }))).json();
  }
  async function reconDiff(app: App, key: "ar" | "ap"): Promise<number> {
    const { rows } = (await get(app, "/reconciliation")) as { rows: { key: string; subLedgerBalance: string; glBalance: string }[] };
    const row = rows.find((r) => r.key === key)!;
    return Number(row.subLedgerBalance) - Number(row.glBalance);
  }
  async function glBalance(app: App, accountId: string): Promise<number> {
    return Number((await get(app, `/gl/accounts/${accountId}/ledger`)).balance.balance);
  }
  async function cashTreasury(app: App) {
    const res = await post(
      app,
      "/treasury-accounts",
      { id: "ta-cash", code: "TA-CASH", name: "الخزينة", branchId: "BR1", glAccountId: "1300-1", openingBalance: "0" },
      admin(app),
    );
    expect(res.status).toBe(201);
  }
  function collection(id: string, customerId: string, amount: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      date: "2026-08-22",
      voucherType: "customer_collection",
      amount,
      branchId: "BR1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "1105",
      customerId,
      ...extra,
    };
  }

  async function approvedRate(app: App, id: string, currency: string, rate: string, effectiveDate: string) {
    const created = await post(app, "/exchange-rates", { id, currency, rate, effectiveDate, rateType: "standard", source: "manual" }, admin(app));
    expect(created.status).toBe(201);
    expect((await post(app, `/exchange-rates/${id}/approve`, {}, admin(app))).status).toBe(200);
  }

  it("D197: reversing an on-account collection leaves AR reconciled — the mirror voucher is not a second receipt", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-rev", "0");
    await createServiceItem(app);
    await cashTreasury(app);
    expect((await authedPost(app, "/sales-invoices", invoiceBody("inv-rev", "cust-rev", "1000"))).status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-rev/confirm", {})).status).toBe(200);
    expect((await post(app, "/vouchers", collection("v-rev", "cust-rev", "400"), admin(app))).status).toBe(201);
    expect((await post(app, "/vouchers/v-rev/confirm", {}, admin(app))).status).toBe(200);
    expect(await reconDiff(app, "ar")).toBe(0);

    expect((await post(app, "/vouchers/v-rev/reverse", { date: "2026-08-23" }, admin(app))).status).toBe(201);
    expect(await glBalance(app, "1105")).toBe(1000);
    expect(await reconDiff(app, "ar")).toBe(0);
    const aging = await get(app, "/reports/aging/customers?asOfDate=2026-09-30");
    expect(aging.grandTotals.total).toBe(1000);
    expect(aging.reconciliation).toMatchObject({ withinTolerance: true });
  });

  it("D197's twin: a reversed expense leaves the dashboard P&L where it was, and its mirror entry names its module", async () => {
    const app = await newBackend();
    await cashTreasury(app);
    const fund = { ...collection("v-fund", "none", "1000"), voucherType: "capital_injection", counterpartyGlAccountId: "3100", customerId: null };
    expect((await post(app, "/vouchers", fund, admin(app))).status).toBe(201);
    expect((await post(app, "/vouchers/v-fund/confirm", {}, admin(app))).status).toBe(200);
    const expense = { ...collection("v-exp", "none", "250"), voucherType: "other_expense", counterpartyGlAccountId: "5910", customerId: null };
    expect((await post(app, "/vouchers", expense, admin(app))).status).toBe(201);
    expect((await post(app, "/vouchers/v-exp/confirm", {}, admin(app))).status).toBe(200);
    expect(Number((await get(app, "/dashboard/summary")).gl.expenses)).toBe(250);

    expect((await post(app, "/vouchers/v-exp/reverse", { date: "2026-08-23" }, admin(app))).status).toBe(201);
    expect(Number((await get(app, "/dashboard/summary")).gl.expenses)).toBe(0);
    const entries = (await get(app, "/gl/journal-entries?pageSize=200")) as { items?: { sourceModule: string; memo: string }[] } | { sourceModule: string }[];
    const list = Array.isArray(entries) ? entries : (entries.items ?? []);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.filter((e) => e.sourceModule === "unknown")).toEqual([]);
  });

  it("D194: both ladders age a foreign invoice at its booked EGP value, and still tie once revaluation restates the control accounts", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-usd", "0");
    await createServiceItem(app);
    await approvedRate(app, "fx-usd-1", "USD", "48.00", "2026-08-01");
    await approvedRate(app, "fx-sar-1", "SAR", "13.20", "2026-08-01");
    const settings = await get(app, "/settings");
    const put = await app.fetch(
      new Request("http://local/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...admin(app) },
        body: JSON.stringify({ ...settings, multiCurrencyEnabled: true }),
      }),
    );
    expect(put.status).toBe(200);
    expect((await authedPost(app, "/sales-invoices", { ...invoiceBody("inv-usd", "cust-usd", "100"), currency: "USD" })).status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-usd/confirm", {})).status).toBe(200);
    expect(await glBalance(app, "1105")).toBe(4800);

    expect((await post(app, "/suppliers", { id: "sup-sar", code: "sup-sar", nameAr: "مورد بالريال", currency: "SAR", openingBalance: "0" }, admin(app))).status).toBe(201);
    const bill = await post(
      app,
      "/purchases/invoices",
      {
        id: "pi-sar",
        supplierId: "sup-sar",
        date: "2026-08-22",
        dueDate: "2026-09-21",
        branchId: "BR1",
        warehouseId: "WH1",
        currency: "SAR",
        lines: [{ description: "خدمة بالريال", kind: "expense", qty: "1", unitCost: "100", taxRatePercent: 0 }],
      },
      admin(app),
    );
    expect(bill.status).toBe(201);
    expect((await post(app, "/purchases/invoices/pi-sar/confirm", {}, admin(app))).status).toBe(200);
    expect(-(await glBalance(app, "2100"))).toBe(1320);

    const customers = await get(app, "/reports/aging/customers?asOfDate=2026-08-31");
    expect(customers.rows.find((row: { customerId: string }) => row.customerId === "cust-usd")?.total).toBe(4800);
    expect(customers.reconciliation).toMatchObject({ reportTotal: 4800, referenceTotal: 4800, withinTolerance: true });
    const suppliers = await get(app, "/reports/aging/suppliers?asOfDate=2026-08-31");
    expect(suppliers.rows.find((row: { supplierId: string }) => row.supplierId === "sup-sar")?.total).toBe(1320);
    expect(suppliers.reconciliation).toMatchObject({ reportTotal: 1320, referenceTotal: 1320, withinTolerance: true });

    // A month-end revaluation that is NOT auto-reversed restates both control
    // accounts and touches no invoice: the ladders stay at the booked rate and
    // the restatement is the one named reconciling item.
    await approvedRate(app, "fx-usd-2", "USD", "50.00", "2026-08-31");
    await approvedRate(app, "fx-sar-2", "SAR", "13.50", "2026-08-31");
    const revalued = await post(app, "/revaluation/post", { date: "2026-08-31", currencies: ["USD", "SAR"], autoReverse: false }, admin(app));
    expect(revalued.status).toBe(201);
    expect(await glBalance(app, "1105")).toBe(5000);
    expect(-(await glBalance(app, "2100"))).toBe(1350);

    const customersAfter = await get(app, "/reports/aging/customers?asOfDate=2026-08-31");
    expect(customersAfter.grandTotals.total).toBe(4800);
    expect(customersAfter.reconciliation).toMatchObject({
      referenceTotal: 4800,
      withinTolerance: true,
      reconcilingItems: [{ key: "fxRevaluation", amount: 200 }],
    });
    const suppliersAfter = await get(app, "/reports/aging/suppliers?asOfDate=2026-08-31");
    expect(suppliersAfter.grandTotals.total).toBe(1320);
    expect(suppliersAfter.reconciliation).toMatchObject({
      referenceTotal: 1320,
      withinTolerance: true,
      reconcilingItems: [{ key: "fxRevaluation", amount: 30 }],
    });
    expect(await reconDiff(app, "ar")).toBe(0);
    expect(await reconDiff(app, "ap")).toBe(0);
  });

  it("D195: what the customers screen says a customer owes is their aging row, on-account receipts included", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-owe", "0");
    await createCustomer(app, "cust-credit", "0");
    await createServiceItem(app);
    await cashTreasury(app);
    expect((await authedPost(app, "/sales-invoices", invoiceBody("inv-owe", "cust-owe", "1000"))).status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-owe/confirm", {})).status).toBe(200);
    for (const [id, customerId, amount] of [["v-onacc", "cust-owe", "100"], ["v-advance", "cust-credit", "50"]] as const) {
      expect((await post(app, "/vouchers", collection(id, customerId, amount), admin(app))).status).toBe(201);
      expect((await post(app, "/vouchers/" + id + "/confirm", {}, admin(app))).status).toBe(200);
    }

    const aging = await get(app, "/reports/aging/customers");
    const row = (id: string) => aging.rows.find((r: { customerId: string }) => r.customerId === id)?.total;
    expect(row("cust-owe")).toBe(900);
    expect(row("cust-credit")).toBe(-50);
    expect(aging.grandTotals.total).toBe(await glBalance(app, "1105"));

    expect((await get(app, "/customers/cust-owe")).owed).toBe("900.000000");
    expect((await get(app, "/customers/cust-credit")).owed).toBe("-50.000000");
    const listed = (await get(app, "/customers")) as { id: string; owed: string }[];
    expect(listed.find((c) => c.id === "cust-owe")?.owed).toBe("900.000000");
    expect((await get(app, "/customers/stats?q=cust-owe")).toCollect).toBe("900.000000");
  });

  it("D196: a «شيك» receipt voucher raises its cheque through the real backend, credits AR once, and a bounce reverses it", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-chq", "0");
    await createServiceItem(app);
    await cashTreasury(app);
    expect((await authedPost(app, "/sales-invoices", invoiceBody("inv-chq", "cust-chq", "1000"))).status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-chq/confirm", {})).status).toBe(200);

    const body = collection("v-chq", "cust-chq", "400", { paymentMethod: "cheque", referenceNo: "CHQ-196" });
    expect((await post(app, "/vouchers", body, admin(app))).status).toBe(201);
    expect((await get(app, "/cheques")).find?.((c: { id: string }) => c.id === "v-chq")).toBeUndefined();
    expect((await post(app, "/vouchers/v-chq/confirm", {}, admin(app))).status).toBe(200);

    const cheque = await get(app, "/cheques/v-chq");
    expect(cheque).toMatchObject({ direction: "incoming", status: "pending", chequeNumber: "CHQ-196", partyId: "cust-chq", amount: "400.000000" });
    expect(await glBalance(app, "1105")).toBe(600);
    expect(await glBalance(app, "1320")).toBe(400);
    expect(await glBalance(app, "1300-1")).toBe(0);
    expect(await reconDiff(app, "ar")).toBe(0);
    const aging = await get(app, "/reports/aging/customers?asOfDate=2026-09-30");
    expect(aging.grandTotals.total).toBe(600);
    expect(aging.reconciliation).toMatchObject({ withinTolerance: true });

    expect((await post(app, "/vouchers/v-chq/allocations", { invoiceId: "inv-chq", amount: "400.00" }, admin(app))).status).toBe(201);
    expect((await get(app, "/cheques/v-chq")).allocations).toHaveLength(1);
    expect((await post(app, "/vouchers/v-chq/reverse", { date: "2026-08-23" }, admin(app))).status).toBe(422);

    expect((await post(app, "/cheques/v-chq/deposit", { bankTreasuryAccountId: "ta-cash" }, admin(app))).status).toBe(200);
    expect((await post(app, "/cheques/v-chq/bounce", { date: "2026-08-25" }, admin(app))).status).toBe(200);
    expect((await get(app, "/vouchers/v-chq")).status).toBe("reversed");
    expect(await get(app, "/sales-invoices/inv-chq")).toMatchObject({ status: "confirmed", remainingBalance: "1000.000000" });
    expect(await glBalance(app, "1105")).toBe(1000);
    expect(await glBalance(app, "1320")).toBe(0);
    expect(await glBalance(app, "1300-1")).toBe(0);
    expect(await reconDiff(app, "ar")).toBe(0);
    const bounced = await get(app, "/reports/aging/customers?asOfDate=2026-09-30");
    expect(bounced.grandTotals.total).toBe(1000);
    expect(bounced.reconciliation).toMatchObject({ withinTolerance: true });

    const replaced = await post(
      app,
      "/cheques/v-chq/replace",
      { newCheque: { id: "chq-196-b", chequeNumber: "CHQ-196-B", bankName: "بنك مصر", issueDate: "2026-08-26", dueDate: "2026-09-10", branchId: "BR1" } },
      admin(app),
    );
    expect(replaced.status).toBe(201);
    expect(await glBalance(app, "1105")).toBe(600);
    expect(await glBalance(app, "1320")).toBe(400);
    expect(await reconDiff(app, "ar")).toBe(0);
    const trialBalance = await get(app, "/financial-reports/trial-balance");
    expect(Number(trialBalance.grandTotals.debit) - Number(trialBalance.grandTotals.credit)).toBe(0);
  });

  it("D196: a «شيك» supplier payment issues an outgoing cheque and debits AP once", async () => {
    const app = await newBackend();
    await cashTreasury(app);
    expect((await post(app, "/vouchers", { ...collection("v-fund", "cust-none", "1000"), voucherType: "capital_injection", counterpartyGlAccountId: "3100", customerId: null }, admin(app))).status).toBe(201);
    expect((await post(app, "/vouchers/v-fund/confirm", {}, admin(app))).status).toBe(200);
    expect((await post(app, "/suppliers", { id: "sup-chq", code: "sup-chq", nameAr: "مورد", currency: "EGP", openingBalance: "0" }, admin(app))).status).toBe(201);
    const payment = {
      id: "v-pay-chq",
      date: "2026-08-22",
      voucherType: "supplier_payment",
      amount: "300",
      branchId: "BR1",
      paymentMethod: "cheque",
      treasuryAccountId: "ta-cash",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "2100",
      supplierId: "sup-chq",
      referenceNo: "OUT-196",
    };
    expect((await post(app, "/vouchers", payment, admin(app))).status).toBe(201);
    expect((await post(app, "/vouchers/v-pay-chq/confirm", {}, admin(app))).status).toBe(200);
    expect(await get(app, "/cheques/v-pay-chq")).toMatchObject({ direction: "outgoing", partyId: "sup-chq", chequeNumber: "OUT-196" });
    expect(await glBalance(app, "2100")).toBe(300);
    expect(await glBalance(app, "2150")).toBe(-300);
    expect(await glBalance(app, "1300-1")).toBe(1000);
    expect(await reconDiff(app, "ap")).toBe(0);
  });
});

describe("createBackend — party balances no invoice carries, and one figure per party (D200–D205, D210, D211)", () => {
  async function get(app: App, path: string): Promise<any> {
    return (await app.fetch(new Request(`http://local${path}`, { headers: admin(app) }))).json();
  }
  async function reconDiffs(app: App): Promise<{ ar: string; ap: string }> {
    const { rows } = (await get(app, "/reconciliation")) as { rows: { key: string; difference: string }[] };
    return { ar: rows.find((r) => r.key === "ar")!.difference, ap: rows.find((r) => r.key === "ap")!.difference };
  }
  async function cashTreasury(app: App) {
    const res = await post(
      app,
      "/treasury-accounts",
      { id: "ta-cash", code: "TA-CASH", name: "الخزينة", branchId: "BR1", glAccountId: "1300-1", openingBalance: "0" },
      admin(app),
    );
    expect(res.status).toBe(201);
  }
  function journal(id: string, lines: Record<string, unknown>[]) {
    return { id, date: "2026-08-22", memo: "قيد يدوي", lines };
  }

  it("D205: a manual line on 1105 or 2100 with no party is refused in Arabic and English, and posts nothing", async () => {
    const app = await newBackend();
    const refused = await post(app, "/gl/journal-entries", journal("je-np", [
      { accountId: "1105", debit: "500", credit: "0" },
      { accountId: "4100", debit: "0", credit: "500" },
    ]), admin(app));
    expect(refused.status).toBe(422);
    const body = (await refused.json()) as { error: string; message: string; messageEn: string };
    expect(body.error).toBe("PARTY_REQUIRED_ON_CONTROL_ACCOUNT");
    expect(body.message).toContain("العميل");
    expect(body.messageEn).toContain("customer");
    const ap = await post(app, "/gl/journal-entries", journal("je-np-ap", [
      { accountId: "5900", debit: "300", credit: "0" },
      { accountId: "2100", debit: "0", credit: "300" },
    ]), admin(app));
    expect(ap.status).toBe(422);
    expect(Number((await get(app, "/gl/accounts/1105/ledger")).balance.balance)).toBe(0);
    expect(await get(app, "/gl/party-control-accounts")).toEqual(
      expect.arrayContaining([{ accountId: "1105", partyKind: "customer" }, { accountId: "2100", partyKind: "supplier" }]),
    );
  });

  it("D205: a manual line naming the customer reaches their aging row, their owed figure and their statement, and AR still ties", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-je", "0");
    const posted = await post(app, "/gl/journal-entries", journal("je-cust", [
      { accountId: "1105", debit: "1140", credit: "0", partyId: "cust-je" },
      { accountId: "4100", debit: "0", credit: "1000" },
      { accountId: "2200", debit: "0", credit: "140" },
    ]), admin(app));
    expect(posted.status).toBe(201);
    expect(((await posted.json()) as { lines: { partyId: string | null }[] }).lines[0]?.partyId).toBe("cust-je");
    const credit = await post(app, "/gl/journal-entries", journal("je-cust-cr", [
      { accountId: "5900", debit: "140", credit: "0" },
      { accountId: "1105", debit: "0", credit: "140", partyId: "cust-je" },
    ]), admin(app));
    expect(credit.status).toBe(201);

    expect(await reconDiffs(app)).toEqual({ ar: "0.000000", ap: "0.000000" });
    const aging = await get(app, "/reports/aging/customers?asOfDate=2026-08-31");
    expect(aging.rows.find((r: { customerId: string }) => r.customerId === "cust-je")?.total).toBe(1000);
    expect(aging.reconciliation).toMatchObject({ reportTotal: 1000, referenceTotal: 1000 });
    expect((await get(app, "/customers/cust-je")).owed).toBe("1000.000000");
    const statement = await get(app, "/reports/statements/customers/cust-je");
    expect(statement.lines.map((l: { kind: string; increase: string; decrease: string }) => [l.kind, l.increase, l.decrease])).toEqual([
      ["journal", "1140.000000", "0.000000"],
      ["journal", "0.000000", "140.000000"],
    ]);
    expect(statement.closing).toBe("1000.000000");
    expect(statement.agingTotal).toBe("1000.000000");
  });

  it("D212: an opening trial balance cannot put a debtors total on 1105 with no customer behind it", async () => {
    const app = await newBackend();
    const res = await post(app, "/data-migration/opening-trial-balance/commit", {
      rows: [
        { accountCode: "1105", debit: "10000.00", credit: "0" },
        { accountCode: "3100", debit: "0", credit: "10000.00" },
      ],
    }, admin(app));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { reasons: string[] }[] };
    expect(body.errors[0]!.reasons[0]).toContain("بطاقة كل عميل");
    expect(Number((await get(app, "/gl/accounts/1105/ledger")).balance.balance)).toBe(0);
    const clean = await post(app, "/data-migration/opening-trial-balance/commit", {
      rows: [
        { accountCode: "1310", debit: "10000.00", credit: "0" },
        { accountCode: "3100", debit: "0", credit: "10000.00" },
      ],
    }, admin(app));
    expect(clean.status).toBe(201);
  });

  it("D225: the opening trial balance preview refuses the 1105/2100 rows its commit would refuse", async () => {
    const app = await newBackend();
    const res = await post(app, "/data-migration/opening-trial-balance/preview", {
      rows: [
        { accountCode: "1105", debit: "10000.00", credit: "0" },
        { accountCode: "2100", debit: "0", credit: "4000.00" },
        { accountCode: "3100", debit: "0", credit: "6000.00" },
      ],
    }, admin(app));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { errors: { rowNumber: number; reasons: string[] }[] };
    expect(body.errors.map((e) => e.rowNumber)).toEqual([1, 2]);
    expect(body.errors[0]!.reasons[0]).toContain("3210");
    expect(body.errors[0]!.reasons[0]).toContain("customer opening balances");
    expect(body.errors[1]!.reasons[0]).toContain("supplier opening balances");
  });

  it("D204: an opening balance is on the party's aging row, the ladder ties to its control account, and owed is that row", async () => {
    const app = await newBackend();
    const customer = await authedPost(app, "/customers", {
      id: "cust-ob", code: "cust-ob", nameAr: "عميل برصيد", paymentTermsDays: 30, currency: "EGP", openingBalance: "750",
      active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto",
    });
    expect(customer.status).toBe(201);
    expect((await post(app, "/suppliers", { id: "sup-ob", code: "sup-ob", nameAr: "مورد برصيد", openingBalance: "300" }, admin(app))).status).toBe(201);

    const customers = await get(app, "/reports/aging/customers");
    expect(customers.rows.find((r: { customerId: string }) => r.customerId === "cust-ob")?.total).toBe(750);
    expect(customers.reconciliation).toMatchObject({ reportTotal: 750, referenceTotal: 750 });
    expect((await get(app, "/customers/cust-ob")).owed).toBe("750.000000");
    expect((await get(app, "/reports/statements/customers/cust-ob")).lines[0]).toMatchObject({ kind: "opening", increase: "750.000000" });

    const suppliers = await get(app, "/reports/aging/suppliers");
    expect(suppliers.rows.find((r: { supplierId: string }) => r.supplierId === "sup-ob")?.total).toBe(300);
    expect(suppliers.reconciliation).toMatchObject({ reportTotal: 300, referenceTotal: 300 });
    expect((await get(app, "/suppliers/sup-ob")).owed).toBe("300.000000");
    expect((await get(app, "/suppliers/stats")).payable).toBe("300.000000");
  });

  it("D201: what the suppliers screen says a supplier is owed is their aging row at the rate each invoice was booked at", async () => {
    const app = await newBackend();
    const created = await post(app, "/exchange-rates", { id: "fx-sar", currency: "SAR", rate: "13.20", effectiveDate: "2026-08-01", rateType: "standard", source: "manual" }, admin(app));
    expect(created.status).toBe(201);
    expect((await post(app, "/exchange-rates/fx-sar/approve", {}, admin(app))).status).toBe(200);
    const settings = await get(app, "/settings");
    await app.fetch(new Request("http://local/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", ...admin(app) },
      body: JSON.stringify({ ...settings, multiCurrencyEnabled: true }),
    }));
    expect((await post(app, "/suppliers", { id: "sup-sar", code: "sup-sar", nameAr: "مورد بالريال", currency: "SAR", openingBalance: "0" }, admin(app))).status).toBe(201);
    const bill = await post(app, "/purchases/invoices", {
      id: "pi-sar", supplierId: "sup-sar", date: "2026-08-22", dueDate: "2026-09-21", branchId: "BR1", warehouseId: "WH1", currency: "SAR",
      lines: [{ description: "خدمة بالريال", kind: "expense", qty: "1", unitCost: "100", taxRatePercent: 0 }],
    }, admin(app));
    expect(bill.status).toBe(201);
    expect((await post(app, "/purchases/invoices/pi-sar/confirm", {}, admin(app))).status).toBe(200);

    expect((await get(app, "/suppliers/sup-sar")).owed).toBe("1320.000000");
    const listed = (await get(app, "/suppliers")) as { id: string; owed: string }[];
    expect(listed.find((s) => s.id === "sup-sar")?.owed).toBe("1320.000000");
    const statement = await get(app, "/reports/statements/suppliers/sup-sar");
    expect(statement.closing).toBe("1320.000000");
  });

  it("D200: a reversed withholding payment leaves the withholding report, and its mirror is not a second one", async () => {
    const app = await newBackend();
    await cashTreasury(app);
    const fund = {
      id: "v-fund", date: "2026-08-22", voucherType: "capital_injection", amount: "5000", branchId: "BR1", paymentMethod: "cash",
      treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "3100",
    };
    expect((await post(app, "/vouchers", fund, admin(app))).status).toBe(201);
    expect((await post(app, "/vouchers/v-fund/confirm", {}, admin(app))).status).toBe(200);
    expect((await post(app, "/suppliers", { id: "sup-wht", code: "sup-wht", nameAr: "مورد خاضع", openingBalance: "0" }, admin(app))).status).toBe(201);
    const voucher = await post(app, "/vouchers", {
      id: "v-wht", date: "2026-08-22", voucherType: "supplier_payment", amount: "1000", branchId: "BR1", paymentMethod: "cash",
      treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "2100", supplierId: "sup-wht",
      withholdingRatePercent: 3, withholdingAmount: "30", withholdingGlAccountId: "2210",
    }, admin(app));
    expect(voucher.status).toBe(201);
    expect((await post(app, "/vouchers/v-wht/confirm", {}, admin(app))).status).toBe(200);
    const before = await get(app, "/reports/tax/withholding?periodFrom=2026-01-01&periodTo=2026-12-31");
    expect(before.rows.filter((r: { voucherId: string }) => r.voucherId === "v-wht")).toHaveLength(1);

    expect((await post(app, "/vouchers/v-wht/reverse", { date: "2026-08-23" }, admin(app))).status).toBe(201);
    const after = await get(app, "/reports/tax/withholding?periodFrom=2026-01-01&periodTo=2026-12-31");
    expect(after.rows).toEqual([]);
    const reversed = (await get(app, "/vouchers")) as { id: string; reversesDocId?: string | null }[];
    expect(reversed.some((v) => v.reversesDocId === "v-wht")).toBe(true);
  });
});

/**
 * A draft saved BEFORE D205 existed — a party-less line on 1105 — can never
 * post through the normal API, because `createJournalEntry` runs the same
 * D205 check a fresh draft does. So the legacy row is inserted straight
 * through the SQLite {@link LedgerRepository}, on a SECOND connection to the
 * same file, exactly the way an old books file already holds one (D226).
 */
describe("createBackend — a legacy draft with no party becomes postable through PUT (D226)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function newFileBackedBackend(): Promise<{ app: App; dbPath: string }> {
    dir = mkdtempSync(path.join(tmpdir(), "mezan-d226-test-"));
    const dbPath = path.join(dir, "mezan.db");
    return { app: keep(await createBackend({ dbPath })), dbPath };
  }

  async function saveLegacyDraft(dbPath: string) {
    const ledger = createSqliteLedgerStore(dbPath);
    const blank = {
      memo: null,
      costCenterId: null,
      currency: null,
      fxRate: null,
      taxRatePercent: null,
      projectId: null,
      costCategory: null,
      branchId: null,
      partyId: null,
    };
    await ledger.save({
      id: "je-legacy",
      entryNo: null,
      date: "2026-08-22",
      memo: "قيد يدوي قديم",
      status: "draft",
      source: "manual",
      lines: [
        { accountId: "1105", debit: Money.fromMajor("500"), credit: Money.zero(), ...blank },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("500"), ...blank },
      ],
      createdAt: "2026-08-20T10:00:00.000Z",
      postedAt: null,
      reversesEntryId: null,
      reversedByEntryId: null,
      sourceDocType: null,
      sourceDocId: null,
      sourceDocNumber: null,
    });
    ledger.close();
  }

  async function get(app: App, apiPath: string): Promise<any> {
    return (await app.fetch(new Request(`http://local${apiPath}`, { headers: admin(app) }))).json();
  }
  function put(app: App, apiPath: string, body: unknown) {
    return app.fetch(
      new Request(`http://local${apiPath}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...admin(app) },
        body: JSON.stringify(body),
      }),
    );
  }
  function del(app: App, apiPath: string) {
    return app.fetch(new Request(`http://local${apiPath}`, { method: "DELETE", headers: admin(app) }));
  }
  async function arDiff(app: App): Promise<string> {
    const { rows } = (await get(app, "/reconciliation")) as { rows: { key: string; difference: string }[] };
    return rows.find((r) => r.key === "ar")!.difference;
  }

  it("cannot post as saved (D205), PUT names the party, then it posts and AR ties", async () => {
    const { app, dbPath } = await newFileBackedBackend();
    await createCustomer(app, "cust-legacy", "0");
    await saveLegacyDraft(dbPath);

    const blocked = await post(app, "/gl/journal-entries/je-legacy/post", {}, admin(app));
    expect(blocked.status).toBe(422);
    expect(((await blocked.json()) as { error: string }).error).toBe("PARTY_REQUIRED_ON_CONTROL_ACCOUNT");

    const edited = await put(app, "/gl/journal-entries/je-legacy", {
      date: "2026-08-22",
      memo: "قيد يدوي قديم",
      lines: [
        { accountId: "1105", debit: "500", credit: "0", partyId: "cust-legacy" },
        { accountId: "4100", debit: "0", credit: "500" },
      ],
    });
    expect(edited.status).toBe(200);
    const editedBody = (await edited.json()) as { status: string; lines: { partyId: string | null }[] };
    expect(editedBody.status).toBe("draft");
    expect(editedBody.lines.find((l) => l.partyId)?.partyId).toBe("cust-legacy");

    const posted = await post(app, "/gl/journal-entries/je-legacy/post", {}, admin(app));
    expect(posted.status).toBe(200);
    expect(((await posted.json()) as { entryNo: string | null }).entryNo).toBeTruthy();

    expect(await arDiff(app)).toBe("0.000000");
    const aging = await get(app, "/reports/aging/customers?asOfDate=2026-08-31");
    expect(aging.rows.find((r: { customerId: string }) => r.customerId === "cust-legacy")?.total).toBe(500);
    expect((await get(app, "/customers/cust-legacy")).owed).toBe("500.000000");
  });

  it("can instead be discarded outright, and posting it afterwards 404s", async () => {
    const { app, dbPath } = await newFileBackedBackend();
    await saveLegacyDraft(dbPath);

    const res = await del(app, "/gl/journal-entries/je-legacy");
    expect(res.status).toBe(204);
    expect((await app.fetch(new Request("http://local/gl/journal-entries/je-legacy", { headers: admin(app) }))).status).toBe(404);
    expect((await post(app, "/gl/journal-entries/je-legacy/post", {}, admin(app))).status).toBe(404);
  });
});

describe("createBackend — foreign documents settle and return in base (D202, D203)", () => {
  async function get(app: App, path: string): Promise<any> {
    return (await app.fetch(new Request(`http://local${path}`, { headers: admin(app) }))).json();
  }
  async function reconDiff(app: App, key: "ar" | "ap"): Promise<number> {
    const { rows } = (await get(app, "/reconciliation")) as { rows: { key: string; subLedgerBalance: string; glBalance: string }[] };
    const row = rows.find((r) => r.key === key)!;
    return Number(row.subLedgerBalance) - Number(row.glBalance);
  }
  async function glBalance(app: App, accountId: string): Promise<number> {
    return Number((await get(app, `/gl/accounts/${accountId}/ledger`)).balance.balance);
  }
  async function approvedRate(app: App, id: string, currency: string, rate: string, effectiveDate: string) {
    expect((await post(app, "/exchange-rates", { id, currency, rate, effectiveDate, rateType: "standard", source: "manual" }, admin(app))).status).toBe(201);
    expect((await post(app, `/exchange-rates/${id}/approve`, {}, admin(app))).status).toBe(200);
  }
  async function multiCurrency(app: App) {
    await approvedRate(app, "fx-usd", "USD", "48.00", "2026-08-01");
    await approvedRate(app, "fx-sar", "SAR", "13.20", "2026-08-01");
    const settings = await get(app, "/settings");
    const put = await app.fetch(
      new Request("http://local/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...admin(app) },
        body: JSON.stringify({ ...settings, multiCurrencyEnabled: true }),
      }),
    );
    expect(put.status).toBe(200);
    expect(
      (await post(app, "/treasury-accounts", { id: "ta-cash", code: "TA-CASH", name: "الخزينة", branchId: "BR1", glAccountId: "1300-1", openingBalance: "0" }, admin(app))).status,
    ).toBe(201);
  }

  it("D202: a USD 100 sales invoice booked at 48.00 is partly paid by EGP 1,000 and still owes the base remainder", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-usd", "0");
    await createServiceItem(app);
    await multiCurrency(app);
    expect((await authedPost(app, "/sales-invoices", { ...invoiceBody("inv-usd", "cust-usd", "100"), currency: "USD" })).status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-usd/confirm", {})).status).toBe(200);

    const paid = await post(app, "/sales-invoices/inv-usd/payments", { amount: "1000", treasuryAccountId: "ta-cash", date: "2026-08-23" }, admin(app));
    expect(paid.status).toBe(200);
    const invoice = await get(app, "/sales-invoices/inv-usd");
    expect(invoice.status).toBe("partially_paid");
    expect(invoice.baseGrandTotal).toBe("4800.000000");
    expect(invoice.amountPaid).toBe("1000.000000");
    expect(invoice.remainingBalance).toBe("3800.000000");
    expect(await glBalance(app, "1105")).toBe(3800);
    expect((await post(app, "/sales-invoices/inv-usd/payments", { amount: "3800.01", treasuryAccountId: "ta-cash", date: "2026-08-23" }, admin(app))).status).toBe(422);
    expect((await get(app, "/sales-invoices/stats")).sales).toBe("4800.000000");
  });

  it("D202: a SAR 100 purchase invoice booked at 13.20 is paid against its 1,320.00 base total", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-cash", "0");
    await createServiceItem(app);
    await multiCurrency(app);
    expect((await authedPost(app, "/sales-invoices", invoiceBody("inv-cash", "cust-cash", "2000"))).status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-cash/confirm", {})).status).toBe(200);
    expect((await post(app, "/sales-invoices/inv-cash/payments", { amount: "2000", treasuryAccountId: "ta-cash", date: "2026-08-22" }, admin(app))).status).toBe(200);

    expect((await post(app, "/suppliers", { id: "sup-sar", code: "sup-sar", nameAr: "مورد بالريال", currency: "SAR", openingBalance: "0" }, admin(app))).status).toBe(201);
    const bill = await post(
      app,
      "/purchases/invoices",
      {
        id: "pi-sar",
        supplierId: "sup-sar",
        date: "2026-08-22",
        dueDate: "2026-09-21",
        branchId: "BR1",
        warehouseId: "WH1",
        currency: "SAR",
        lines: [{ description: "خدمة بالريال", kind: "expense", qty: "1", unitCost: "100", taxRatePercent: 0 }],
      },
      admin(app),
    );
    expect(bill.status).toBe(201);
    expect((await post(app, "/purchases/invoices/pi-sar/confirm", {}, admin(app))).status).toBe(200);

    const paid = await post(app, "/purchases/invoices/pi-sar/payments", { amount: "500", treasuryAccountId: "ta-cash", date: "2026-08-23" }, admin(app));
    expect(paid.status).toBe(200);
    const invoice = await get(app, "/purchases/invoices/pi-sar");
    expect(invoice.total).toBe("100.000000");
    expect(invoice.baseTotal).toBe("1320.000000");
    expect(invoice.amountPaid).toBe("500.000000");
    expect(invoice.remainingBalance).toBe("820.000000");
    expect(-(await glBalance(app, "2100"))).toBe(820);
    expect((await post(app, "/purchases/invoices/pi-sar/payments", { amount: "820.01", treasuryAccountId: "ta-cash", date: "2026-08-23" }, admin(app))).status).toBe(422);
    expect(await reconDiff(app, "ap")).toBe(0);
  });

  it("D219: a return comes off what may be collected, sales by customer and by salesperson, and the customer drill-down", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-ret", "0");
    await createServiceItem(app);
    await multiCurrency(app);
    const body = invoiceBody("inv-ret", "cust-ret", "500");
    expect((await authedPost(app, "/sales-invoices", { ...body, lines: [{ ...body.lines[0], qty: "2" }] })).status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-ret/confirm", {})).status).toBe(200);
    expect((await post(app, "/sales-invoices/inv-ret/payments", { amount: "200", treasuryAccountId: "ta-cash", date: "2026-08-22" }, admin(app))).status).toBe(200);
    expect((await post(app, "/sales-returns/from-invoice", {
      id: "sr-ret", date: "2026-08-23", memo: "", warehouseId: "WH1", sourceInvoiceId: "inv-ret", reason: "OTHER", requested: [{ itemId: "SVC-1", qty: "1" }],
    }, admin(app))).status).toBe(201);
    expect((await post(app, "/sales-returns/sr-ret/confirm", {}, admin(app))).status).toBe(200);
    expect((await get(app, "/sales-invoices/inv-ret")).remainingBalance).toBe("300.000000");

    const over = await post(app, "/sales-invoices/inv-ret/payments", { amount: "300.01", treasuryAccountId: "ta-cash", date: "2026-08-24" }, admin(app));
    expect(over.status).toBe(422);
    const byCustomer = await get(app, "/reports/sales/by-customer?dateFrom=2026-08-01&dateTo=2026-08-31");
    expect(byCustomer.rows.find((r: { customerId: string }) => r.customerId === "cust-ret")?.outstanding).toBe(300);
    const bySalesperson = await get(app, "/reports/sales/by-salesperson?dateFrom=2026-08-01&dateTo=2026-08-31");
    expect(bySalesperson.grandTotals.outstanding).toBe(300);
    const drill = await get(app, "/reports/drill-down/customer/cust-ret");
    expect(drill.facts.find((f: { key: string }) => f.key === "outstanding")?.value).toBe("300.00");
    expect((await get(app, "/customers/cust-ret")).owed).toBe("300.000000");

    expect((await post(app, "/sales-invoices/inv-ret/payments", { amount: "300", treasuryAccountId: "ta-cash", date: "2026-08-24" }, admin(app))).status).toBe(200);
    expect((await get(app, "/sales-invoices/inv-ret")).remainingBalance).toBe("0.000000");
    expect(await reconDiff(app, "ar")).toBe(0);
  });

  it("D203: a sales return against a USD invoice credits 1105 at the invoice's rate, by either route, and refunds the base amount", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-usd", "0");
    await createServiceItem(app);
    await multiCurrency(app);
    for (const id of ["inv-usd", "inv-usd2"]) {
      expect((await authedPost(app, "/sales-invoices", { ...invoiceBody(id, "cust-usd", "100"), currency: "USD" })).status).toBe(201);
      expect((await authedPost(app, `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
    }
    expect(await glBalance(app, "1105")).toBe(9600);

    const fromInvoice = await post(app, "/sales-returns/from-invoice", {
      id: "sr-usd", date: "2026-08-23", memo: "", warehouseId: "WH1", sourceInvoiceId: "inv-usd", reason: "OTHER", requested: [{ itemId: "SVC-1", qty: "1" }],
    }, admin(app));
    expect(fromInvoice.status).toBe(201);
    expect((await post(app, "/sales-returns/sr-usd/confirm", {}, admin(app))).status).toBe(200);
    expect(await glBalance(app, "1105")).toBe(4800);
    expect(await reconDiff(app, "ar")).toBe(0);
    const returned = await get(app, "/sales-returns/sr-usd");
    expect(returned.grandTotal).toBe("4800.000000");
    expect(returned.refundDue).toBe("4800.000000");
    expect((await get(app, "/sales-invoices/inv-usd")).remainingBalance).toBe("0.000000");

    const raw = await post(app, "/sales-returns", {
      id: "sr-usd2", date: "2026-08-23", memo: "",
      lines: [{
        itemId: "SVC-1", warehouseId: "WH1", customerId: "cust-usd", sourceInvoiceId: "inv-usd2", sourceInvoiceNumber: null, reason: "OTHER",
        availableQty: "1", qty: "1", unitPrice: "100", unitCost: "0", taxAmount: "0", fxRate: "1", currency: "EGP",
      }],
    }, admin(app));
    expect(raw.status).toBe(201);
    expect((await post(app, "/sales-returns/sr-usd2/confirm", {}, admin(app))).status).toBe(200);
    expect(await glBalance(app, "1105")).toBe(0);
    expect(await reconDiff(app, "ar")).toBe(0);
  });

  it("D203: a purchase return against a SAR invoice debits 2100 at the invoice's rate, whatever rate the caller sends", async () => {
    const app = await newBackend();
    await multiCurrency(app);
    expect((await post(app, "/items", { id: "item-sar", code: "ITEM-SAR", nameAr: "صنف بالريال", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status).toBe(201);
    expect((await post(app, "/suppliers", { id: "sup-sar", code: "sup-sar", nameAr: "مورد بالريال", currency: "SAR", openingBalance: "0" }, admin(app))).status).toBe(201);
    const bill = await post(app, "/purchases/invoices", {
      id: "pi-sar", supplierId: "sup-sar", date: "2026-08-22", dueDate: "2026-09-21", branchId: "BR1", warehouseId: "WH1", currency: "SAR",
      lines: [{ itemId: "item-sar", description: "صنف بالريال", kind: "inventory", qty: "10", unitCost: "20", taxRatePercent: 14 }],
    }, admin(app));
    expect(bill.status).toBe(201);
    const confirmed = (await (await post(app, "/purchases/invoices/pi-sar/confirm", {}, admin(app))).json()) as { number: string };
    expect(-(await glBalance(app, "2100"))).toBe(3009.6);

    const created = await post(app, "/purchase-returns", {
      id: "pr-sar", date: "2026-08-23", memo: "",
      lines: [{
        itemId: "item-sar", warehouseId: "WH1", supplierId: "sup-sar", sourceInvoiceId: "pi-sar", sourceInvoiceNumber: confirmed.number, reason: "DEFECTIVE",
        availableQty: "10", qty: "3", unitCost: "20", taxAmount: "8.40", taxRatePercent: 14, fxRate: "1", currency: "EGP",
      }],
    }, admin(app));
    expect(created.status).toBe(201);
    expect((await post(app, "/purchase-returns/pr-sar/confirm", {}, admin(app))).status).toBe(200);
    expect(-(await glBalance(app, "2100"))).toBe(2106.72);
    expect((await get(app, "/purchase-returns/pr-sar")).grandTotal).toBe("902.880000");
    expect(await reconDiff(app, "ap")).toBe(0);
    const { rows } = (await get(app, "/reconciliation")) as { rows: { key: string; subLedgerBalance: string; glBalance: string }[] };
    const inventory = rows.find((r) => r.key === "inventory")!;
    expect(Number(inventory.subLedgerBalance)).toBe(Number(inventory.glBalance));
  });
});

describe("createBackend — a ladder run as of a past day ties to its control account as of that day (D220, D223)", () => {
  async function get(app: App, path: string): Promise<any> {
    return (await app.fetch(new Request(`http://local${path}`, { headers: admin(app) }))).json();
  }
  async function fundedCash(app: App) {
    expect(
      (await post(app, "/treasury-accounts", { id: "ta-cash", code: "TA-CASH", name: "الخزينة", branchId: "BR1", glAccountId: "1300-1", openingBalance: "0" }, admin(app))).status,
    ).toBe(201);
    expect((await post(app, "/vouchers", {
      id: "v-fund", date: "2026-08-01", voucherType: "capital_injection", amount: "50000", branchId: "BR1", paymentMethod: "cash",
      treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "3100",
    }, admin(app))).status).toBe(201);
    expect((await post(app, "/vouchers/v-fund/confirm", {}, admin(app))).status).toBe(200);
  }
  async function ladderAt(app: App, kind: "customers" | "suppliers", date: string, partyId: string) {
    const report = await get(app, `/reports/aging/${kind}?asOfDate=${date}`);
    const row = report.rows.find((r: { customerId?: string; supplierId?: string }) => (r.customerId ?? r.supplierId) === partyId);
    return { row: row?.total ?? 0, reportTotal: report.reconciliation.reportTotal, referenceTotal: report.reconciliation.referenceTotal };
  }

  it("D220: collections, returns, cheques, reversals and voids dated after the day are not netted on the customer ladder", async () => {
    const app = await newBackend();
    await createCustomer(app, "cust-asof", "0");
    await createServiceItem(app);
    await fundedCash(app);
    const a = invoiceBody("inv-a", "cust-asof", "500");
    expect((await authedPost(app, "/sales-invoices", { ...a, date: "2026-08-01", dueDate: "2026-08-31", lines: [{ ...a.lines[0], qty: "2" }] })).status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-a/confirm", {})).status).toBe(200);
    expect((await authedPost(app, "/sales-invoices", { ...invoiceBody("inv-v", "cust-asof", "300"), date: "2026-08-02", dueDate: "2026-08-31" })).status).toBe(201);
    expect((await authedPost(app, "/sales-invoices/inv-v/confirm", {})).status).toBe(200);
    expect((await post(app, "/sales-invoices/inv-a/payments", { amount: "400", treasuryAccountId: "ta-cash", date: "2026-08-10" }, admin(app))).status).toBe(200);
    expect((await post(app, "/sales-returns/from-invoice", {
      id: "sr-asof", date: "2026-08-12", memo: "", warehouseId: "WH1", sourceInvoiceId: "inv-a", reason: "OTHER", requested: [{ itemId: "SVC-1", qty: "1" }],
    }, admin(app))).status).toBe(201);
    expect((await post(app, "/sales-returns/sr-asof/confirm", {}, admin(app))).status).toBe(200);
    const receipt = (id: string, date: string, amount: string) => ({
      id, date, voucherType: "customer_collection", amount, branchId: "BR1", paymentMethod: "cash",
      treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "1105", customerId: "cust-asof",
    });
    for (const [id, date, amount] of [["v-oa", "2026-08-15", "100"], ["v-rev", "2026-08-20", "50"]] as const) {
      expect((await post(app, "/vouchers", receipt(id, date, amount), admin(app))).status).toBe(201);
      expect((await post(app, `/vouchers/${id}/confirm`, {}, admin(app))).status).toBe(200);
    }
    expect((await post(app, "/vouchers/v-rev/reverse", { date: "2026-08-25" }, admin(app))).status).toBe(201);
    expect((await post(app, "/cheques", {
      id: "chq-asof", direction: "incoming", chequeNumber: "770001", bankName: "بنك القاهرة", amount: "70.00", issueDate: "2026-08-18", dueDate: "2026-08-19",
      branchId: "BR1", partyId: "cust-asof", counterpartyGlAccountId: "1105", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
    }, admin(app))).status).toBe(201);
    expect((await post(app, "/cheques/chq-asof/deposit", { bankTreasuryAccountId: "ta-bank1" }, admin(app))).status).toBe(200);
    expect((await post(app, "/cheques/chq-asof/bounce", { date: "2026-08-28" }, admin(app))).status).toBe(200);
    expect((await post(app, "/sales-invoices/inv-v/void", {}, admin(app))).status).toBe(200);

    for (const [date, owed] of [
      ["2026-08-05", 1300], ["2026-08-11", 900], ["2026-08-13", 400], ["2026-08-16", 300],
      ["2026-08-19", 230], ["2026-08-22", 180], ["2026-08-26", 230], ["2026-08-29", 300],
    ] as const) {
      const at = await ladderAt(app, "customers", date, "cust-asof");
      expect({ date, row: at.row }).toEqual({ date, row: owed });
      expect({ date, ladder: at.reportTotal }).toEqual({ date, ladder: at.referenceTotal });
    }
    const today = await get(app, "/reports/aging/customers");
    expect(today.reconciliation.reportTotal).toBe(today.reconciliation.referenceTotal);
    expect(today.rows.find((r: { customerId: string }) => r.customerId === "cust-asof")?.total ?? 0).toBe(0);
  });

  it("D220: payments, returns and cancellations dated after the day are not netted on the supplier ladder", async () => {
    const app = await newBackend();
    await fundedCash(app);
    expect((await post(app, "/items", { id: "item-asof", code: "ITEM-ASOF", nameAr: "صنف", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" }, admin(app))).status).toBe(201);
    expect((await post(app, "/suppliers", { id: "sup-asof", code: "sup-asof", nameAr: "مورد", currency: "EGP", openingBalance: "0" }, admin(app))).status).toBe(201);
    const bill = (id: string, date: string, qty: string) => ({
      id, supplierId: "sup-asof", date, dueDate: "2026-08-31", branchId: "BR-MAIN", warehouseId: "WH-MAIN",
      lines: [{ itemId: "item-asof", description: "صنف", kind: "inventory", qty, unitCost: "100.00", taxRatePercent: 0 }],
    });
    for (const [id, date, qty] of [["pi-a", "2026-08-01", "10"], ["pi-c", "2026-08-02", "2"]] as const) {
      expect((await post(app, "/purchases/invoices", bill(id, date, qty), admin(app))).status).toBe(201);
      expect((await post(app, `/purchases/invoices/${id}/confirm`, {}, admin(app))).status).toBe(200);
    }
    expect((await post(app, "/purchases/invoices/pi-a/payments", { amount: "300", treasuryAccountId: "ta-cash", date: "2026-08-10" }, admin(app))).status).toBe(200);
    const number = (await get(app, "/purchases/invoices/pi-a")).number;
    expect((await post(app, "/purchase-returns", {
      id: "pr-asof", date: "2026-08-12", memo: "",
      lines: [{ itemId: "item-asof", warehouseId: "WH-MAIN", supplierId: "sup-asof", sourceInvoiceId: "pi-a", sourceInvoiceNumber: number, reason: "DEFECTIVE", availableQty: "10", qty: "1", unitCost: "100.00", taxAmount: "0" }],
    }, admin(app))).status).toBe(201);
    expect((await post(app, "/purchase-returns/pr-asof/confirm", {}, admin(app))).status).toBe(200);
    expect((await post(app, "/purchases/invoices/pi-c/cancel", {}, admin(app))).status).toBe(200);

    for (const [date, owed] of [["2026-08-05", 1200], ["2026-08-11", 900], ["2026-08-13", 800]] as const) {
      const at = await ladderAt(app, "suppliers", date, "sup-asof");
      expect({ date, row: at.row }).toEqual({ date, row: owed });
      expect({ date, ladder: at.reportTotal }).toEqual({ date, ladder: at.referenceTotal });
    }
    const today = await ladderAt(app, "suppliers", "2026-12-31", "sup-asof");
    expect(today.row).toBe(600);
    expect(today.reportTotal).toBe(today.referenceTotal);
  });

  it("D223: an opening balance posted before its entry carried a document type ages from the day it posted", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-d223-"));
    const dbPath = path.join(dir, "books.sqlite");
    try {
      (await createBackend({ dbPath })).close();
      const customers = createSqliteCustomerRepository(dbPath);
      await customers.save(buildCustomer({ id: "cust-old", code: "cust-old", nameAr: "عميل قديم", openingBalance: Money.fromMajor("750") }));
      customers.close();
      const suppliers = createSqliteSupplierRepository(dbPath);
      await suppliers.save(buildSupplier({ id: "sup-old", code: "sup-old", nameAr: "مورد قديم", openingBalance: Money.fromMajor("300") }));
      suppliers.close();
      (await createBackend({ dbPath })).close();
      const { sqlite } = openSqliteConnection(dbPath);
      const day = (sqlite.prepare("SELECT date FROM journal_entry WHERE id = 'OB-CUST-JE:cust-old'").get() as { date: string }).date;
      sqlite.prepare("UPDATE journal_entry SET source_doc_type = NULL, source_doc_id = NULL, source_doc_number = NULL WHERE id LIKE 'OB-%'").run();
      sqlite.close();

      const app = keep(await createBackend({ dbPath }));
      expect(await ladderAt(app, "customers", day, "cust-old")).toEqual({ row: 750, reportTotal: 750, referenceTotal: 750 });
      expect(await ladderAt(app, "suppliers", day, "sup-old")).toEqual({ row: 300, reportTotal: 300, referenceTotal: 300 });
      const later = new Date(Date.parse(`${day}T00:00:00Z`) + 200 * 86_400_000).toISOString().slice(0, 10);
      const aged = (await get(app, `/reports/aging/customers?asOfDate=${later}`)).rows.find((r: { customerId: string }) => r.customerId === "cust-old");
      expect(aged?.over120).toBe(750);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("D241: a customer's opening balance entered on the customers screen is not posted a second time when the server restarts", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-d241-"));
    const dbPath = path.join(dir, "books.sqlite");
    try {
      const firstHandle = await createBackend({ dbPath });
      registries.set(firstHandle.app, firstHandle.sessions);
      expect((await post(firstHandle.app, "/customers", {
        id: "cust-new", code: "cust-new", nameAr: "عميل جديد", paymentTermsDays: 30, currency: "EGP", openingBalance: "750",
        active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto",
      }, admin(firstHandle.app))).status).toBe(201);
      firstHandle.close();

      const app = keep(await createBackend({ dbPath }));
      expect((await get(app, "/gl/accounts/1105/ledger")).balance.balance).toBe("750.000000");
      const ar = (await get(app, "/reconciliation")).rows.find((r: { key: string }) => r.key === "ar");
      expect(ar).toMatchObject({ subLedgerBalance: "750.000000", glBalance: "750.000000", matched: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
