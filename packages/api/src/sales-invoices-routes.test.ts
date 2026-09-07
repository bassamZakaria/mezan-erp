import { describe, it, expect, afterEach } from "vitest";
import {
  Money,
  Qty,
  NextNumberService,
  StockLedgerService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  postJournalEntry,
  applyAllocatedSettlement,
  type Account,
  type SalesReturnDocument,
} from "@mezan/domain";
import { createSqliteSalesInvoiceStore, type SqliteSalesInvoiceStoreHandle } from "@mezan/persistence";
import { createSalesInvoicesRoutes, type SalesInvoiceRoutesDeps } from "./sales-invoices-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
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

async function harness(opts: { maxLineDiscountPercent?: number; returns?: SalesInvoiceRoutesDeps["returns"] } = {}) {
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
    now: () => NOW,
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
  return { app: createSalesInvoicesRoutes(deps, insecureHeaderAuthContextResolver), ledger, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
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
        // guards D116/P-8: a collection is a treasury act, not an invoice edit.
        permissions: "treasury.cash_voucher.create",
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

  /** guards D116/P-8: `sales.invoice.edit` used to be enough to take the cash. */
  it("refuses a collection from a seat that may only EDIT the invoice, and accepts the instalment collector", async () => {
    const { app } = await harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.invoice.create" }));
    const { id } = (await create.json()) as any;
    await app.fetch(req(`/${id}/confirm`, { method: "POST", body: JSON.stringify({}), permissions: "sales.invoice.confirm" }));

    const denied = await app.fetch(
      req(`/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: "100", treasuryAccountId: TREASURY_ACCOUNT }),
        permissions: "sales.invoice.edit",
      }),
    );
    expect(denied.status).toBe(403);

    const allowed = await app.fetch(
      req(`/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: "100", treasuryAccountId: TREASURY_ACCOUNT }),
        permissions: "installments.collection.create",
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it("refuses a collection that names no treasury account — money must land somewhere", async () => {
    const { app } = await harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.invoice.create" }));
    const { id } = (await create.json()) as any;
    await app.fetch(req(`/${id}/confirm`, { method: "POST", body: JSON.stringify({}), permissions: "sales.invoice.confirm" }));

    const pay = await app.fetch(req(`/${id}/payments`, { method: "POST", body: JSON.stringify({ amount: "100" }), permissions: "treasury.cash_voucher.create" }));
    expect(pay.status).toBe(400);
  });

  it("validates the request body", async () => {
    const { app } = await harness();
    const res = await app.fetch(req("/", { method: "POST", body: JSON.stringify({ ...draftBody, lines: [] }), permissions: "sales.invoice.create" }));
    expect(res.status).toBe(400);
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
    expect(await overrideOnly.json()).toMatchObject({ permission: "pos.discount.approve" });

    const allowed = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create,sales.price.override,pos.discount.approve",
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
    expect(await overCeiling.json()).toMatchObject({ permission: "pos.discount.approve" });
  });

  it("lets an approver exceed the ceiling", async () => {
    const { app } = await harnessWithCeiling(20);
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create,pos.discount.approve",
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
    expect(await res.json()).toMatchObject({ permission: "pos.discount.approve" });
  });

  it("LIMITATION (D87): the ceiling checks percent discounts only, so an amount discount walks past it", async () => {
    // 10 × 25.00 = 250.00. A 240.00 discount is 96% of the line — far above the
    // 20% ceiling — but it is typed as an amount, and `overCeiling` only looks
    // at percent lines. It is under the giveaway rule's threshold (which fires
    // at the whole line), so nothing refuses it.
    const { app } = await harnessWithCeiling(20);
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify(line({ discountType: "amount", discountAmount: "240" })),
      }),
    );
    expect(res.status).toBe(201);

    // When D87 is closed, this must be a 403 naming pos.discount.approve.
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
