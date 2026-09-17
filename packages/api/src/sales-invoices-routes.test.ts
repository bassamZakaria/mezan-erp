import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import {
  Money,
  Qty,
  NextNumberService,
  StockLedgerService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  createInventoryStockHook,
  postJournalEntry,
  applyAllocatedSettlement,
  createEntitlements,
  createAuthContext,
  type Account,
  type SalesReturnDocument,
  type DocumentWorkflowGate,
} from "@mezan/domain";
import { createSqliteSalesInvoiceStore, type SqliteSalesInvoiceStoreHandle } from "@mezan/persistence";
import { createSalesInvoicesRoutes, type SalesInvoiceRoutesDeps } from "./sales-invoices-routes.js";
import { entitlementsBinding } from "./module-gate.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
import type { Context } from "hono";

/**
 * Mirrors how `createApp` mounts `entitlementsBinding` in front of every
 * route (Task A2b) — the harness below builds routes directly, so without
 * this wrap `c.get("entitlements")` is never set and a module-licensing
 * regression at a `moduleRefusalFor` call site would pass here and only
 * surface once mounted for real.
 */
function wrapWithEntitlements(app: Hono, activeModules: string[]) {
  const entitlements = createEntitlements({ plan: "core", activeModules, features: {}, seats: 1, expiresAt: null });
  const wrapper = new Hono();
  wrapper.use("*", entitlementsBinding(() => entitlements));
  wrapper.route("/", app);
  return wrapper;
}

/**
 * The dev header resolver plus the ROLE codes a real session grant carries.
 * `insecureHeaderAuthContextResolver` resolves permissions only, and roles and
 * permissions being two different vocabularies is the whole of DEC-2 — a test
 * that could not tell them apart could not see the defect.
 */
function testAuthContextResolver(c: Context) {
  const base = insecureHeaderAuthContextResolver(c);
  return createAuthContext({
    userId: base.userId,
    permissions: [...base.permissions],
    roleCodes: (c.req.header("x-role-codes") ?? "").split(",").map((r) => r.trim()).filter(Boolean),
    branchScope: base.branchScope,
    warehouseScope: base.warehouseScope,
  });
}

const AR = "1300";
const REVENUE = "4000";
const TAX = "2200";
const COGS = "5000";
const INVENTORY = "1200";
const TREASURY_GL = "1310";
const TREASURY_ACCOUNT = "ta-cash";
const NOW = "2026-08-22T10:00:00.000Z";

const closers: SqliteSalesInvoiceStoreHandle[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

/* Minimal in-memory GL ledger + stock stores (kept local to the API test). */
class MemLedger {
  rows = new Map<string, any>();
  async save(e: any) { this.rows.set(e.id, e); }
  async update(e: any) { this.rows.set(e.id, e); }
  async findById(id: string) { return this.rows.get(id) ?? null; }
  async findByEntryNo() { return null; }
  async list() { return [...this.rows.values()]; }
  async accountBalance(accountId: string) { return { accountId, debit: Money.zero(), credit: Money.zero(), balance: Money.zero() }; }
  async accountLedger() { return []; }
  async transaction<T>(fn: () => Promise<T>) { return fn(); }
}
class MemSeq { m = new Map<string, number>(); async increment(code: string, period: number | null) { const k = `${code}:${period ?? ""}`; const n = (this.m.get(k) ?? 0) + 1; this.m.set(k, n); return n; } }
class MemStockLedger { rows: any[] = []; async append(m: any) { this.rows.push(m); } async listByPosition(i: string, w: string) { return this.rows.filter((m) => m.itemId === i && m.warehouseId === w); } async listByItem() { return []; } async listByWarehouse() { return []; } async listPositions() { return []; } }
class MemLayers { rows = new Map<string, any>(); async add(l: any) { this.rows.set(l.id, l); } async listByPosition(i: string, w: string) { return [...this.rows.values()].filter((l) => l.itemId === i && l.warehouseId === w); } async updateRemaining(id: string, q: any) { const l = this.rows.get(id); if (l) this.rows.set(id, { ...l, remainingQty: q }); } async remove(id: string) { this.rows.delete(id); } }
class MemSnaps { rows = new Map<string, any>(); key(i: string, w: string) { return `${i}:${w}`; } async get(i: string, w: string) { return this.rows.get(this.key(i, w)) ?? null; } async save(s: any) { this.rows.set(this.key(s.itemId, s.warehouseId), s); } async list() { return [...this.rows.values()]; } }

async function harness(
  opts: {
    maxLineDiscountPercent?: number;
    returns?: SalesInvoiceRoutesDeps["returns"];
    withoutStockRestore?: boolean;
    now?: string;
    workflow?: DocumentWorkflowGate;
  } = {},
) {
  const accounts = {
    map: new Map<string, Account>([
      [AR, account(AR)],
      [REVENUE, account(REVENUE, { type: "revenue", naturalBalance: "credit" })],
      [TAX, account(TAX, { type: "liability", naturalBalance: "credit" })],
      [COGS, account(COGS, { type: "expense" })],
      [INVENTORY, account(INVENTORY)],
      [TREASURY_GL, account(TREASURY_GL)],
    ]),
    async findById(id: string) { return this.map.get(id) ?? null; },
  };
  const periods = {
    async findByDate(date: string) {
      return date >= "2026-08-01" && date <= "2026-08-31"
        ? { id: "fp", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" as const }
        : null;
    },
  };
  const ledger = new MemLedger();
  const glHook = createSalesInvoiceGlHook({
    ledger: ledger as any,
    accounts,
    periods,
    numbering: new NextNumberService(new MemSeq()),
    now: () => NOW,
    actor: "u1",
  });
  const stockService = new StockLedgerService({
    ledger: new MemStockLedger() as any,
    layers: new MemLayers() as any,
    snapshots: new MemSnaps() as any,
    policy: { allowNegativeStock: true },
    clock: () => NOW,
  });
  await stockService.recordOpeningBalance({
    adjustmentId: "open-A",
    warehouseId: "WH1",
    lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("10") }],
  });

  const repo = createSqliteSalesInvoiceStore();
  closers.push(repo);

  const collectionNumbering = new NextNumberService(new MemSeq());
  const deps: SalesInvoiceRoutesDeps = {
    repo,
    ...(opts.returns ? { returns: opts.returns } : {}),
    ...(opts.maxLineDiscountPercent === undefined
      ? {}
      : { discountPolicy: async () => ({ maxLineDiscountPercent: opts.maxLineDiscountPercent as number }) }),
    // guards N-9 — the routes only enforce optimistic concurrency when a guard is wired.
    versionGuard: { versions: repo.versions, displayNameOf: async (id: string) => (id === "u1" ? "منى" : null) },
    numbering: { next: () => new NextNumberService(new MemSeq()).next("SALES_INVOICE") },
    gl: glHook,
    stock: createSalesInvoiceStockHook(stockService),
    ...(opts.workflow ? { workflow: opts.workflow } : {}),
    ...(opts.withoutStockRestore ? {} : { stockRestore: createInventoryStockHook(stockService) }),
    now: () => opts.now ?? NOW,
    idGen: (() => { let n = 0; return () => `inv-${++n}`; })(),
    /**
     * A collection is a confirmed receipt voucher, so the money must land in a
     * real treasury account AND in the ledger: Dr treasury / Cr AR, then the
     * invoice's amountPaid follows from the allocation, never from the request.
     */
    collect: async (input) => {
      if (input.treasuryAccountId !== TREASURY_ACCOUNT) {
        throw new Error(`unknown treasury account ${input.treasuryAccountId}`);
      }
      const voucherId = `COLL:${input.invoiceId}`;
      await postJournalEntry(
        {
          id: voucherId,
          date: input.date,
          memo: input.memo ?? "",
          source: "system",
          sourceDocType: "VOUCHER",
          sourceDocId: voucherId,
          lines: [
            { accountId: TREASURY_GL, debit: input.amount, credit: Money.zero() },
            { accountId: AR, debit: Money.zero(), credit: input.amount },
          ],
        },
        { ledger: ledger as any, accounts, periods, numbering: collectionNumbering, now: () => NOW, actor: "u1" },
      );
      const invoice = await repo.findById(input.invoiceId);
      await applyAllocatedSettlement(repo, input.invoiceId, (invoice?.amountPaid ?? Money.zero()).add(input.amount));
      return { voucherId };
    },
  };
  return { app: createSalesInvoicesRoutes(deps, testAuthContextResolver), ledger, repo, stockService };
}

function req(path: string, init: RequestInit & { permissions?: string; roleCodes?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.roleCodes !== undefined) headers.set("x-role-codes", init.roleCodes);
  headers.set("x-user-id", "u1");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const draftBody = {
  date: "2026-08-22",
  dueDate: "2026-09-21",
  customerId: "cust-1",
  customerNameAr: "محمد الشهابي",
  warehouseId: "WH1",
  branchId: "BR1",
  arAccountId: AR,
  taxAccountId: TAX,
  lines: [
    { lineId: "L1", itemId: "ITEM-A", itemNameAr: "صنف أ", isStock: true, qty: "10", unitPrice: "25", taxRatePercent: 14, revenueAccountId: REVENUE, cogsAccountId: COGS, inventoryAccountId: INVENTORY },
    { lineId: "L2", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: "2", unitPrice: "50", discountPercent: 10, taxRatePercent: 14, revenueAccountId: REVENUE },
  ],
};

describe("sales-invoices routes", () => {
  it("rejects an unauthenticated create with 403", async () => {
    const { app } = await harness();
    const res = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody) }));
    expect(res.status).toBe(403);
  });

  it("creates a draft, lists it, then confirms it — posting stock + a balanced JE", async () => {
    const { app, ledger } = await harness();

    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.invoice.create" }));
    expect(create.status).toBe(201);
    const draft = (await create.json()) as any;
    expect(draft.status).toBe("draft");
    expect(draft.docNo).toBeNull();
    expect(draft.totals.grandTotal).toBe("387.600000");
    const id = draft.id;

    const list = await app.fetch(req("/", { permissions: "sales.invoice.view" }));
    expect(list.status).toBe(200);
    expect(((await list.json()) as any)).toHaveLength(1);

    const confirm = await app.fetch(req(`/${id}/confirm`, { method: "POST", body: JSON.stringify({}), permissions: "sales.invoice.confirm" }));
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as any;
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.docNo).toBe("INV-000001");
    expect(confirmed.held).toBe(false);
    expect(confirmed.remainingBalance).toBe("387.600000");

    const entry = await ledger.findById(id);
    expect(entry?.status).toBe("posted");
    const debit = Money.sum(entry.lines.map((l: any) => l.debit)).toString();
    const credit = Money.sum(entry.lines.map((l: any) => l.credit)).toString();
    expect(debit).toBe(credit);
    expect(debit).toBe("487.600000");
  });

  it("forbids confirm without the confirm permission", async () => {
    const { app } = await harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.invoice.create" }));
    const { id } = (await create.json()) as any;
    const res = await app.fetch(req(`/${id}/confirm`, { method: "POST", body: JSON.stringify({}), permissions: "sales.invoice.view" }));
    expect(res.status).toBe(403);
  });

  it("records a payment moving the invoice to partially paid", async () => {
    const { app, ledger } = await harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.invoice.create" }));
    const { id } = (await create.json()) as any;
    await app.fetch(req(`/${id}/confirm`, { method: "POST", body: JSON.stringify({}), permissions: "sales.invoice.confirm" }));

    const pay = await app.fetch(
      req(`/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: "100", treasuryAccountId: TREASURY_ACCOUNT }),
        permissions: "sales.invoice.edit",
      }),
    );
    expect(pay.status).toBe(200);
    const paid = (await pay.json()) as any;
    expect(paid.status).toBe("partially_paid");
    expect(paid.amountPaid).toBe("100.000000");
    expect(paid.remainingBalance).toBe("287.600000");

    // The sub-ledger movement has its GL side: Dr treasury 100 / Cr AR 100.
    const collection = await ledger.findById(paid.voucherId);
    expect(collection?.status).toBe("posted");
    const debit = Money.sum(collection.lines.map((l: any) => l.debit)).toString();
    const credit = Money.sum(collection.lines.map((l: any) => l.credit)).toString();
    expect(debit).toBe(credit);
    expect(debit).toBe("100.000000");
    expect(collection.lines.find((l: any) => l.accountId === AR)?.credit.toString()).toBe("100.000000");
    expect(collection.lines.find((l: any) => l.accountId === TREASURY_GL)?.debit.toString()).toBe("100.000000");
  });

  it("refuses a collection that names no treasury account — money must land somewhere", async () => {
    const { app } = await harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.invoice.create" }));
    const { id } = (await create.json()) as any;
    await app.fetch(req(`/${id}/confirm`, { method: "POST", body: JSON.stringify({}), permissions: "sales.invoice.confirm" }));

    const pay = await app.fetch(req(`/${id}/payments`, { method: "POST", body: JSON.stringify({ amount: "100" }), permissions: "sales.invoice.edit" }));
    expect(pay.status).toBe(400);
  });

  it("validates the request body", async () => {
    const { app } = await harness();
    const res = await app.fetch(req("/", { method: "POST", body: JSON.stringify({ ...draftBody, lines: [] }), permissions: "sales.invoice.create" }));
    expect(res.status).toBe(400);
  });
});

/**
 * Guards DEC-2. `GateStep.role` is a ROLE code, and this route used to hand the
 * gate `ctx.permissions` — the resolved PERMISSION set — as `submitterRoles`,
 * so the two sides of the same gate disagreed about what a step names.
 */
describe("what the confirm route feeds the workflow gate", () => {
  it("hands it the caller's role codes, and none of their permissions", async () => {
    const seen: (readonly string[] | undefined)[] = [];
    const { app } = await harness({
      workflow: {
        async evaluate(input) {
          seen.push(input.submitterRoles);
          return { granted: true, requestId: input.requestId };
        },
      },
    });
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.invoice.create" }));
    const { id } = (await create.json()) as any;
    const confirm = await app.fetch(
      req(`/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify({}),
        permissions: "sales.invoice.confirm,FINANCE_MANAGER",
        roleCodes: "FINANCE_MANAGER",
      }),
    );
    expect(confirm.status).toBe(200);
    expect(seen).toEqual([["FINANCE_MANAGER"]]);
    // Specifically NOT the permission set, which carries the same string.
    expect(seen[0]).not.toContain("sales.invoice.confirm");
  });

  it("still lets a tenant admin bypass the gate", async () => {
    const seen: (readonly string[] | undefined)[] = [];
    const { app } = await harness({
      workflow: {
        async evaluate(input) {
          seen.push(input.submitterRoles);
          return { granted: true, requestId: input.requestId };
        },
      },
    });
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "*" }));
    const { id } = (await create.json()) as any;
    await app.fetch(req(`/${id}/confirm`, { method: "POST", body: JSON.stringify({}), permissions: "*" }));
    expect(seen).toEqual([["*"]]);
  });
});

/**
 * Guards D116: `sales.invoice.void` existed in the catalogue and gated nothing,
 * so a wrong CONFIRMED invoice had no exit at all — only a draft could be
 * cancelled. Every assertion here is on the books, not on the status flag.
 */
describe("voiding a confirmed invoice", () => {
  const VOID = "sales.invoice.void";

  /**
   * Σ debit − Σ credit on one account, over exactly the entries the trial
   * balance counts — a reversed entry keeps its lines in the books (see
   * `reports/gl-shared.ts`), and its mirror is what nets it off.
   */
  function postedBalance(ledger: any, accountId: string): Money {
    let scaled = 0n;
    for (const entry of ledger.rows.values()) {
      if (entry.status !== "posted" && entry.status !== "reversed") continue;
      for (const line of entry.lines as { accountId: string; debit: Money; credit: Money }[]) {
        if (line.accountId !== accountId) continue;
        scaled += line.debit.scaled - line.credit.scaled;
      }
    }
    return Money.fromScaled(scaled);
  }

  async function confirmedInvoice(opts: Parameters<typeof harness>[0] = {}) {
    const h = await harness(opts);
    const create = await h.app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.invoice.create" }));
    const { id } = (await create.json()) as any;
    const confirm = await h.app.fetch(req(`/${id}/confirm`, { method: "POST", body: JSON.stringify({}), permissions: "sales.invoice.confirm" }));
    expect(confirm.status).toBe(200);
    return { ...h, id };
  }

  it("posts a balanced mirror entry, restores the AR balance and puts the stock back", async () => {
    const { app, ledger, stockService, id } = await confirmedInvoice();

    // Where the books stand with the invoice live: AR carries the whole
    // receivable and 10 units of ITEM-A have left WH1.
    expect(postedBalance(ledger, AR).toString()).toBe("387.600000");
    expect((await stockService.getPosition("ITEM-A", "WH1")).onHand.toString()).toBe("90.000000");

    const res = await app.fetch(req(`/${id}/void`, { method: "POST", permissions: VOID }));
    expect(res.status).toBe(200);
    const voided = (await res.json()) as any;
    expect(voided.status).toBe("reversed");

    // The original entry is marked reversed and linked to its mirror; the
    // mirror balances to the cent and carries the same total the other way.
    const original = await ledger.findById(id);
    expect(original.status).toBe("reversed");
    expect(original.reversedByEntryId).toBe(voided.reversalJournalEntryId);
    const mirror = await ledger.findById(voided.reversalJournalEntryId);
    expect(mirror.status).toBe("posted");
    expect(mirror.reversesEntryId).toBe(id);
    const debit = Money.sum(mirror.lines.map((l: any) => l.debit));
    const credit = Money.sum(mirror.lines.map((l: any) => l.credit));
    expect(debit.toString()).toBe(credit.toString());
    expect(debit.toString()).toBe("487.600000");

    // Both halves are back: the AR sub-ledger returns to its prior balance and
    // the warehouse holds the 10 units again, at the cost they left at.
    expect(postedBalance(ledger, AR).toString()).toBe("0.000000");
    expect(postedBalance(ledger, REVENUE).toString()).toBe("0.000000");
    expect(postedBalance(ledger, INVENTORY).toString()).toBe("0.000000");
    const position = await stockService.getPosition("ITEM-A", "WH1");
    expect(position.onHand.toString()).toBe("100.000000");
    expect(position.totalValue.toString()).toBe("1000.000000");

    // And the invoice stops being a receivable on every read surface.
    expect(voided.remainingBalance).toBe("0.000000");
    const stats = (await (await app.fetch(req("/stats", { permissions: "sales.invoice.view" }))).json()) as any;
    expect(stats.count).toBe(0);
    expect(stats.remaining).toBe("0.000000");
    const counts = (await (await app.fetch(req("/counts", { permissions: "sales.invoice.view" }))).json()) as any;
    expect(counts.reversed).toBe(1);
    expect(counts.open).toBe(0);
  });

  it("refuses without sales.invoice.void", async () => {
    const { app, id } = await confirmedInvoice();
    const res = await app.fetch(req(`/${id}/void`, { method: "POST", permissions: "sales.invoice.confirm" }));
    expect(res.status).toBe(403);
  });

  it("refuses a draft — that is what cancel is for — and refuses a second void", async () => {
    const { app } = await harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.invoice.create" }));
    const { id } = (await create.json()) as any;
    const draftVoid = await app.fetch(req(`/${id}/void`, { method: "POST", permissions: VOID }));
    expect(draftVoid.status).toBe(409);

    await app.fetch(req(`/${id}/confirm`, { method: "POST", body: JSON.stringify({}), permissions: "sales.invoice.confirm" }));
    expect((await app.fetch(req(`/${id}/void`, { method: "POST", permissions: VOID }))).status).toBe(200);
    expect((await app.fetch(req(`/${id}/void`, { method: "POST", permissions: VOID }))).status).toBe(409);
  });

  it("refuses an invoice that has been collected against, and moves nothing", async () => {
    const { app, ledger, stockService, id } = await confirmedInvoice();
    await app.fetch(
      req(`/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: "100", treasuryAccountId: TREASURY_ACCOUNT }),
        permissions: "sales.invoice.edit",
      }),
    );

    const res = await app.fetch(req(`/${id}/void`, { method: "POST", permissions: VOID }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "INVOICE_HAS_COLLECTIONS" });
    expect((await ledger.findById(id)).status).toBe("posted");
    expect((await stockService.getPosition("ITEM-A", "WH1")).onHand.toString()).toBe("90.000000");
  });

  it("refuses when the reversal would fall outside an open period, leaving both halves untouched", async () => {
    // The harness opens August 2026 only. The invoice still posts into August
    // (a document posts on its own date), but the void's mirror entry is
    // stamped "now" — September — and there is no open period to take it.
    const { app, ledger, stockService, id } = await confirmedInvoice({ now: "2026-09-05T09:00:00.000Z" });
    const res = await app.fetch(req(`/${id}/void`, { method: "POST", permissions: VOID }));
    expect(res.status).toBe(422);

    expect((await ledger.findById(id)).status).toBe("posted");
    expect(postedBalance(ledger, AR).toString()).toBe("387.600000");
    expect((await stockService.getPosition("ITEM-A", "WH1")).onHand.toString()).toBe("90.000000");
  });

  it("answers 503 rather than reversing the GL when no stock-restore hook is mounted", async () => {
    const { app, ledger, id } = await confirmedInvoice({ withoutStockRestore: true });
    const res = await app.fetch(req(`/${id}/void`, { method: "POST", permissions: VOID }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "STOCK_RESTORE_UNAVAILABLE" });
    // The GL must be exactly where it was: a one-sided void is the bug this guards.
    expect((await ledger.findById(id)).status).toBe("posted");
    expect(postedBalance(ledger, AR).toString()).toBe("387.600000");
  });
});

describe("the discount ceiling and the giveaway gate", () => {
  /** The same harness, with a tenant ceiling of 20% on a line discount. */
  const harnessWithCeiling = (maxLineDiscountPercent = 20) => harness({ maxLineDiscountPercent });

  const line = (overrides: Record<string, unknown>) => ({
    ...draftBody,
    lines: [{ ...draftBody.lines[0], ...overrides }],
  });

  it("refuses a zero-priced line without sales.price.override", async () => {
    const { app } = await harnessWithCeiling();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.invoice.create", body: JSON.stringify(line({ unitPrice: "0" })) }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ permission: "sales.price.override" });
  });

  it("allows a zero-priced line to someone who holds the override", async () => {
    const { app } = await harnessWithCeiling();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create,sales.price.override",
        body: JSON.stringify(line({ unitPrice: "0" })),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("refuses a 100% line discount without the override, and allows it with", async () => {
    const body = line({ discountType: "percent", discountPercent: 100 });
    const { app } = await harnessWithCeiling();

    const refused = await app.fetch(
      req("/", { method: "POST", permissions: "sales.invoice.create", body: JSON.stringify(body) }),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ permission: "sales.price.override" });

    // A 100% discount is also over the 20% ceiling, so it needs BOTH: the
    // override for the giveaway, and the approval for the ceiling.
    const overrideOnly = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create,sales.price.override",
        body: JSON.stringify(body),
      }),
    );
    expect(overrideOnly.status).toBe(403);
    expect(await overrideOnly.json()).toMatchObject({ permission: "sales.discount.approve" });

    const allowed = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create,sales.price.override,sales.discount.approve",
        body: JSON.stringify(body),
      }),
    );
    expect(allowed.status).toBe(201);
  });

  it("refuses an amount discount that swallows the whole line, the same as a 100% one", async () => {
    // 10 × 25.00 = 250.00; a 250.00 discount is a giveaway however it is typed.
    const { app } = await harnessWithCeiling();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify(line({ discountType: "amount", discountAmount: "250" })),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ permission: "sales.price.override" });
  });

  it("allows a discount at the tenant's ceiling and refuses one above it", async () => {
    const { app } = await harnessWithCeiling(20);

    const atCeiling = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify(line({ discountType: "percent", discountPercent: 20 })),
      }),
    );
    expect(atCeiling.status).toBe(201);

    const overCeiling = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify(line({ discountType: "percent", discountPercent: 21 })),
      }),
    );
    expect(overCeiling.status).toBe(403);
    expect(await overCeiling.json()).toMatchObject({ permission: "sales.discount.approve" });
  });

  it("still answers the approval refusal for an over-ceiling discount on a tenant licensed only for sales — the ceiling is a sales control, not a POS feature", async () => {
    const { app } = await harnessWithCeiling(20);
    const bound = wrapWithEntitlements(app, ["sales"]);

    const refused = await bound.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify(line({ discountType: "percent", discountPercent: 21 })),
      }),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "PERMISSION_DENIED", permission: "sales.discount.approve" });

    const allowed = await bound.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create,sales.discount.approve",
        body: JSON.stringify(line({ discountType: "percent", discountPercent: 21 })),
      }),
    );
    expect(allowed.status).toBe(201);
  });

  it("lets an approver exceed the ceiling", async () => {
    const { app } = await harnessWithCeiling(20);
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create,sales.discount.approve",
        body: JSON.stringify(line({ discountType: "percent", discountPercent: 45 })),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("applies the ceiling to a header discount as well as a line one", async () => {
    const { app } = await harnessWithCeiling(20);
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify({ ...draftBody, discount: { type: "percent", percent: 30 } }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ permission: "sales.discount.approve" });
  });

  /** Guards D87: an amount discount is measured against the ceiling as a percentage. */
  it("holds an amount discount to the ceiling exactly as the equivalent percent one", async () => {
    // 10 × 25.00 = 250.00. A 240.00 discount is 96% of the line — far above the
    // 20% ceiling — and typing it as «مبلغ» rather than «نسبة» used to walk past
    // the ceiling and past sales.discount.approve entirely.
    const { app } = await harnessWithCeiling(20);
    const refused = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify(line({ discountType: "amount", discountAmount: "240" })),
      }),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ permission: "sales.discount.approve" });

    const approved = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create,sales.discount.approve",
        body: JSON.stringify(line({ discountType: "amount", discountAmount: "240" })),
      }),
    );
    expect(approved.status).toBe(201);
  });

  it("lets an amount discount at or under the ceiling through", async () => {
    // 20% of 250.00 is exactly 50.00 — at the ceiling, so allowed; 50.01 is over.
    const { app } = await harnessWithCeiling(20);
    const atCeiling = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify(line({ discountType: "amount", discountAmount: "50" })),
      }),
    );
    expect(atCeiling.status).toBe(201);

    const overCeiling = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify(line({ discountType: "amount", discountAmount: "50.01" })),
      }),
    );
    expect(overCeiling.status).toBe(403);
    expect(await overCeiling.json()).toMatchObject({ permission: "sales.discount.approve" });
  });

  it("applies the ceiling to an amount discount on the header too", async () => {
    // Lines gross 10 × 25.00 + 2 × 50.00 = 350.00; a 100.00 header discount is
    // 28.6% of it, above the 20% ceiling.
    const { app } = await harnessWithCeiling(20);
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify({ ...draftBody, discount: { type: "amount", amount: "100" } }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ permission: "sales.discount.approve" });
  });

  it("has no ceiling at all when the tenant configures none", async () => {
    const { app } = await harness();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify(line({ discountType: "percent", discountPercent: 99 })),
      }),
    );
    expect(res.status).toBe(201);
  });
});

/**
 * Q-5: `/counts` used to hydrate the whole filtered table on every keystroke,
 * and every credit lookup listed every return ever raised. The counts must be
 * identical whichever path the returns module offers.
 */
describe("sales-invoices counts + return credit (guards Q-5)", () => {
  const overdueBody = { ...draftBody, dueDate: "2026-08-01" };

  function returnDoc(sourceInvoiceId: string, unitPrice: string, taxAmount: string): SalesReturnDocument {
    return {
      id: `ret-${sourceInvoiceId}`,
      docType: "SALES_RETURN",
      docNo: "SR-000001",
      date: "2026-08-22",
      memo: "مرتجع",
      status: "confirmed",
      lines: [
        {
          itemId: "ITEM-A",
          warehouseId: "WH1",
          customerId: "cust-1",
          sourceInvoiceId,
          sourceInvoiceNumber: null,
          reason: "DEFECTIVE",
          availableQty: Qty.fromMajor("1"),
          qty: Qty.fromMajor("1"),
          unitPrice: Money.fromMajor(unitPrice),
          unitCost: Money.fromMajor("10"),
          taxAmount: Money.fromMajor(taxAmount),
        },
      ],
      createdAt: "2026-08-22T10:00:00.000Z",
      confirmedAt: "2026-08-22T10:00:00.000Z",
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    };
  }

  async function seed(h: { app: { fetch(req: Request): Response | Promise<Response> }; repo: SqliteSalesInvoiceStoreHandle }) {
    const ids: string[] = [];
    for (const body of [draftBody, draftBody, overdueBody, draftBody]) {
      const res = await h.app.fetch(req("/", { method: "POST", body: JSON.stringify(body), permissions: "sales.invoice.create" }));
      ids.push(((await res.json()) as any).id);
    }
    // Confirm the first three in the store: the harness's numbering hook mints
    // INV-000001 on every call, so confirming three through the route would
    // collide on the document number rather than exercise the counts.
    let n = 0;
    for (const id of ids.slice(0, 3)) {
      const inv = await h.repo.findById(id);
      await h.repo.update({ ...inv!, status: "confirmed", docNo: `INV-00000${++n}`, confirmedAt: NOW });
    }
    return ids;
  }

  it("counts every stored status and both derived chips, with return credit netted off", async () => {
    // ids[0] is fully credited by a confirmed return, so it is no longer open.
    const docs = [returnDoc("inv-1", "340", "47.60")];
    const h = await harness({ returns: { list: async () => docs } });
    const { app } = h;
    const ids = await seed(h);
    expect(ids[0]).toBe("inv-1");

    const res = await app.fetch(req("/counts", { permissions: "sales.invoice.view" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      all: 4,
      draft: 1,
      confirmed: 3,
      // A cancelled confirmed invoice is `reversed`, not `cancelled` — it keeps
      // its number and its mirror entry. The chip exists so the count is not
      // silently absent from a status the list can actually be filtered by.
      reversed: 0,
      partially_paid: 0,
      paid: 0,
      cancelled: 0,
      open: 2,
      overdue: 1,
    });
  });

  it("answers identically whether the returns module can scope by invoice id or only list everything", async () => {
    const docs = [returnDoc("inv-1", "340", "47.60")];
    const listOnly = await harness({ returns: { list: async () => docs } });
    await seed(listOnly);

    const scoped = await harness({
      returns: {
        // The scoped path must never fall back to the whole history.
        list: async () => { throw new Error("returns.list() must not be called when listByLineRef exists"); },
        listByLineRef: async (_field, invoiceIds) => docs.filter((d) => d.lines.some((l) => invoiceIds.includes(l.sourceInvoiceId))),
      },
    });
    await seed(scoped);

    for (const path of ["/counts", "/inv-1", "/inv-2", "/?status=open", "/stats"]) {
      const a = await listOnly.app.fetch(req(path, { permissions: "sales.invoice.view" }));
      const b = await scoped.app.fetch(req(path, { permissions: "sales.invoice.view" }));
      expect(b.status).toBe(a.status);
      expect(await b.json()).toEqual(await a.json());
    }
  });
});

// guards N-9 — two tills on one invoice used to be last-write-wins and silent.
describe("sales invoice routes — optimistic concurrency (N-9)", () => {
  async function draft() {
    const { app, repo } = await harness();
    const created = await app.fetch(req("/", { method: "POST", permissions: "sales.invoice.create", body: JSON.stringify(draftBody) }));
    const invoice = (await created.json()) as { id: string };
    return { app, repo, id: invoice.id };
  }

  it("serves the row version on the detail read", async () => {
    const { app, id } = await draft();
    const res = await app.fetch(req(`/${id}`, { permissions: "sales.invoice.view" }));
    const body = (await res.json()) as { version: number };
    expect(body.version).toBe(1);
  });

  it("refuses a stale expectedVersion with 409 and names who moved it", async () => {
    const { app, repo, id } = await draft();
    // Another till acts first: any write moves the version.
    const current = (await repo.findById(id))!;
    await repo.update({ ...current, notes: "غيّرها صندوق آخر" });
    await repo.versions.stampModifier(id, "u1");

    const res = await app.fetch(
      req(`/${id}/confirm`, { method: "POST", permissions: "sales.invoice.confirm", body: JSON.stringify({ expectedVersion: 1 }) }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string; currentVersion: number };
    expect(body.error).toBe("DOCUMENT_VERSION_CONFLICT");
    expect(body.message).toBe("تم تعديل هذا المستند قبل قليل بواسطة منى — أعد التحميل");
    expect(body.currentVersion).toBe(2);
    expect((await repo.findById(id))!.status).toBe("draft");
  });

  it("lets the CURRENT version through, and moves the version on", async () => {
    const { app, repo, id } = await draft();
    const res = await app.fetch(
      req(`/${id}/confirm`, { method: "POST", permissions: "sales.invoice.confirm", body: JSON.stringify({ expectedVersion: 1 }) }),
    );
    expect(res.status).toBe(200);
    expect((await repo.versions.read(id))!.version).toBeGreaterThan(1);
  });

  it("degrades honestly when the winning editor cannot be named", async () => {
    const { app, repo, id } = await draft();
    const current = (await repo.findById(id))!;
    await repo.update({ ...current, notes: "x" });

    const res = await app.fetch(
      req(`/${id}/confirm`, { method: "POST", permissions: "sales.invoice.confirm", body: JSON.stringify({ expectedVersion: 1 }) }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toBe("تم تعديل هذا المستند قبل قليل — أعد التحميل");
  });

  it("an older client that sends no expectedVersion keeps working exactly as before", async () => {
    const { app, repo, id } = await draft();
    const current = (await repo.findById(id))!;
    await repo.update({ ...current, notes: "x" });

    const res = await app.fetch(req(`/${id}/confirm`, { method: "POST", permissions: "sales.invoice.confirm", body: JSON.stringify({}) }));
    expect(res.status).toBe(200);
  });

  /**
   * The list row's own kebab confirms the invoice — it does not open the
   * detail first. A list that omits `version` therefore leaves the row with
   * nothing to send back, and the guard above never fires at all.
   */
  it("serves the row version on the LIST, so a row-level confirm can send it", async () => {
    const { app } = await draft();
    const res = await app.fetch(req("/", { permissions: "sales.invoice.view" }));
    const rows = (await res.json()) as { id: string; version: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(1);
  });

  it("refuses a confirm sent with a version the LIST row served before another till moved it", async () => {
    const { app, repo, id } = await draft();
    const rows = (await (await app.fetch(req("/", { permissions: "sales.invoice.view" }))).json()) as {
      version: number;
    }[];
    const staleVersion = rows[0]!.version;

    const current = (await repo.findById(id))!;
    await repo.update({ ...current, notes: "غيّرها صندوق آخر" });

    const res = await app.fetch(
      req(`/${id}/confirm`, {
        method: "POST",
        permissions: "sales.invoice.confirm",
        body: JSON.stringify({ expectedVersion: staleVersion }),
      }),
    );
    expect(res.status).toBe(409);
    expect((await repo.findById(id))!.status).toBe("draft");
  });

  it("refuses a stale cancel too, not only a stale confirm", async () => {
    const { app, repo, id } = await draft();
    const current = (await repo.findById(id))!;
    await repo.update({ ...current, notes: "x" });

    const res = await app.fetch(
      req(`/${id}/cancel`, { method: "POST", permissions: "sales.invoice.delete_draft", body: JSON.stringify({ expectedVersion: 1 }) }),
    );
    expect(res.status).toBe(409);
    expect((await repo.findById(id))!.status).toBe("draft");
  });
});
