import { describe, it, expect, afterEach } from "vitest";
import {
  Money,
  NextNumberService,
  StockLedgerService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  type Account,
  type LedgerRepository,
  type TaxRate,
  type JournalListFilter,
} from "@mezan/domain";
// Test-only in-memory account repository — not part of @mezan/domain's public
// barrel (it's a test helper), so this reaches the domain module directly,
// same as packages/domain/src/sales-invoices/sales-invoice.test.ts does.
import { InMemoryAccountRepository } from "../../domain/src/accounts/test-helpers/in-memory-account-repository.js";
import {
  createSqliteSalesQuoteStore,
  createSqliteSalesInvoiceStore,
  type SqliteSalesQuoteStoreHandle,
  type SqliteSalesInvoiceStoreHandle,
} from "@mezan/persistence";
import { createSalesQuotesRoutes, type SalesQuoteRoutesDeps } from "./sales-quotes-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
/** Covers `POST /:id/convert-to-invoice` — the bridge between sales-quotes and sales-invoices. */

const NOW = "2026-08-22T10:00:00.000Z";
const AR = "1300";
const REVENUE = "4000";
const TAX = "2200";

class MemSeq {
  m = new Map<string, number>();
  async increment(code: string, period: number | null) {
    const k = `${code}:${period ?? ""}`;
    const n = (this.m.get(k) ?? 0) + 1;
    this.m.set(k, n);
    return n;
  }
}

/** Minimal no-op ledger — the convert tests only assert the created invoice's own state, not its GL entry. */
class NoopLedger implements LedgerRepository {
  async save() {}
  async update() {}
  async replaceDraft() {}
  async deleteDraft() {}
  async findById() {
    return null;
  }
  async findByEntryNo() {
    return null;
  }
  async list(_filter: JournalListFilter = {}) {
    return [];
  }
  async accountBalance(accountId: string) {
    return { accountId, debit: Money.zero(), credit: Money.zero(), balance: Money.zero() };
  }
  async accountLedger() {
    return [];
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

const quoteClosers: SqliteSalesQuoteStoreHandle[] = [];
const invoiceClosers: SqliteSalesInvoiceStoreHandle[] = [];
afterEach(() => {
  for (const h of quoteClosers.splice(0)) h.close();
  for (const h of invoiceClosers.splice(0)) h.close();
});

async function harness(includeInvoiceBridge: boolean, taxRates?: SalesQuoteRoutesDeps["taxRates"]) {
  let invoiceStore: SqliteSalesInvoiceStoreHandle | null = null;
  const repo = createSqliteSalesQuoteStore();
  quoteClosers.push(repo);
  const quoteNumbering = new NextNumberService(new MemSeq());

  let invoice: SalesQuoteRoutesDeps["invoice"];
  if (includeInvoiceBridge) {
    const invoiceRepo = createSqliteSalesInvoiceStore();
    invoiceClosers.push(invoiceRepo);
    invoiceStore = invoiceRepo;

    const accounts = new InMemoryAccountRepository();
    await accounts.create(account(AR));
    await accounts.create(account(REVENUE, { type: "revenue", naturalBalance: "credit" }));
    await accounts.create(account(TAX, { type: "liability", naturalBalance: "credit" }));

    const glHook = createSalesInvoiceGlHook({
      ledger: new NoopLedger(),
      accounts,
      periods: {
        async findByDate() {
          return { id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" as const };
        },
      },
      numbering: new NextNumberService(new MemSeq()),
      now: () => NOW,
      actor: "u1",
    });

    const stockService = new StockLedgerService({
      ledger: {
        async append() {},
        async listByPosition() {
          return [];
        },
        async listByItem() {
          return [];
        },
        async listByWarehouse() {
          return [];
        },
        async listPositions() {
          return [];
        },
      },
      layers: {
        async add() {},
        async listByPosition() {
          return [];
        },
        async updateRemaining() {},
        async remove() {},
      },
      snapshots: {
        async get() {
          return null;
        },
        async save() {},
        async list() {
          return [];
        },
      },
      policy: { allowNegativeStock: true },
      clock: () => NOW,
    });

    invoice = {
      repo: invoiceRepo,
      taxPolicy: () => ({ enabled: true, defaultRatePercent: 0, inclusive: false }),
      taxRates: taxRates ?? { list: async () => [] },
      numbering: { next: () => new NextNumberService(new MemSeq()).next("SALES_INVOICE") },
      gl: glHook,
      stock: createSalesInvoiceStockHook(stockService),
    };
  }

  const deps: SalesQuoteRoutesDeps = {
    repo,
    numbering: { next: () => quoteNumbering.next("SALES_QUOTE") },
    now: () => NOW,
    idGen: (() => {
      let n = 0;
      return () => `inv-from-quote-${++n}`;
    })(),
    invoice,
    taxRates,
  };
  return { app: createSalesQuotesRoutes(deps, insecureHeaderAuthContextResolver), repo, invoiceStore };
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
  expiryDate: "2026-09-21",
  customerId: "cust-1",
  customerNameAr: "محمد الشهابي",
  branchId: "BR1",
  lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", qty: "2", unitPrice: "50", taxRatePercent: 14 }],
};

async function createSentAcceptedQuote(app: ReturnType<typeof createSalesQuotesRoutes>): Promise<string> {
  const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.quote.create" }));
  const created = (await create.json()) as { id: string };
  await app.fetch(req(`/${created.id}/send`, { method: "POST", permissions: "sales.quote.send" }));
  await app.fetch(req(`/${created.id}/accept`, { method: "POST", permissions: "sales.quote.edit" }));
  return created.id;
}

const convertBody = {
  dueDate: "2026-09-21",
  warehouseId: "WH1",
  arAccountId: AR,
  taxAccountId: TAX,
  lines: [{ lineId: "L1", isStock: false, revenueAccountId: REVENUE }],
};

describe("POST /:id/convert-to-invoice", () => {
  it("responds 501 when the invoice bridge isn't configured", async () => {
    const { app } = await harness(false);
    const id = await createSentAcceptedQuote(app);
    const res = await app.fetch(
      req(`/${id}/convert-to-invoice`, { method: "POST", permissions: "sales.invoice.create", body: JSON.stringify(convertBody) }),
    );
    expect(res.status).toBe(501);
  });

  it("rejects converting a quote that isn't accepted yet", async () => {
    const { app } = await harness(true);
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.quote.create" }));
    const created = (await create.json()) as { id: string };
    const res = await app.fetch(
      req(`/${created.id}/convert-to-invoice`, { method: "POST", permissions: "sales.invoice.create", body: JSON.stringify(convertBody) }),
    );
    expect(res.status).toBe(409);
  });

  it("converts an accepted quote into a draft invoice and marks the quote محول", async () => {
    const { app, repo } = await harness(true);
    const id = await createSentAcceptedQuote(app);

    const res = await app.fetch(
      req(`/${id}/convert-to-invoice`, { method: "POST", permissions: "sales.invoice.create", body: JSON.stringify(convertBody) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { quote: { status: string; convertedInvoiceId: string }; invoiceId: string };
    expect(body.quote.status).toBe("converted");
    expect(body.quote.convertedInvoiceId).toBe(body.invoiceId);

    const stored = await repo.findById(id);
    expect(stored?.status).toBe("converted");
    expect(stored?.convertedInvoiceId).toBe(body.invoiceId);
  });

  it("D79: the invoice inherits the quote line's rate even after that rate was deactivated — an accepted quote is never a dead end", async () => {
    const rate = (id: string, percent: number, status: TaxRate["status"]): TaxRate => ({
      id, code: id, name: id, rate: percent, calculationType: "exclusive", isDefault: false,
      outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "V001", status,
    });
    const master: TaxRate[] = [rate("VAT-EXPORT", 0, "active")];
    const { app, invoiceStore } = await harness(true, { list: async () => master });

    const create = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.quote.create",
        body: JSON.stringify({ ...draftBody, lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", qty: "2", unitPrice: "50", taxRateId: "VAT-EXPORT" }] }),
      }),
    );
    const quote = (await create.json()) as { id: string; lines: { taxRateId: string | null }[] };
    expect(quote.lines[0]?.taxRateId).toBe("VAT-EXPORT");
    await app.fetch(req(`/${quote.id}/send`, { method: "POST", permissions: "sales.quote.send" }));
    await app.fetch(req(`/${quote.id}/accept`, { method: "POST", permissions: "sales.quote.edit" }));

    master[0] = rate("VAT-EXPORT", 0, "inactive");
    const refusedOnANewQuote = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.quote.create",
        body: JSON.stringify({ ...draftBody, lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", qty: "1", unitPrice: "50", taxRateId: "VAT-EXPORT" }] }),
      }),
    );
    expect(refusedOnANewQuote.status).toBe(422);

    const res = await app.fetch(
      req(`/${quote.id}/convert-to-invoice`, { method: "POST", permissions: "sales.invoice.create", body: JSON.stringify(convertBody) }),
    );
    expect(res.status).toBe(201);
    const { invoiceId } = (await res.json()) as { invoiceId: string };
    const invoice = await invoiceStore!.findById(invoiceId);
    expect(invoice?.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([["VAT-EXPORT", 0]]);
  });

  it("D79 round 3: a quote line that stored NO rate at 14% converts to an invoice line with no rate — the one active 14% rate is not read off the percent a second time", async () => {
    const vat: TaxRate = {
      id: "VAT14", code: "VAT14", name: "ضريبة القيمة المضافة", rate: 14, calculationType: "exclusive", isDefault: true,
      outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active",
    };
    const { app, invoiceStore } = await harness(true, { list: async () => [vat] });
    const create = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.quote.create",
        body: JSON.stringify({ ...draftBody, lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", qty: "2", unitPrice: "50", taxRatePercent: 14, taxRateId: null }] }),
      }),
    );
    const quote = (await create.json()) as { id: string; lines: { taxRateId: string | null; taxRatePercent: number }[] };
    expect(quote.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 14 });
    await app.fetch(req(`/${quote.id}/send`, { method: "POST", permissions: "sales.quote.send" }));
    await app.fetch(req(`/${quote.id}/accept`, { method: "POST", permissions: "sales.quote.edit" }));

    const res = await app.fetch(
      req(`/${quote.id}/convert-to-invoice`, { method: "POST", permissions: "sales.invoice.create", body: JSON.stringify(convertBody) }),
    );
    expect(res.status).toBe(201);
    const { invoiceId } = (await res.json()) as { invoiceId: string };
    const invoice = await invoiceStore!.findById(invoiceId);
    expect(invoice?.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([[null, 14]]);
  });

  it("rejects a request missing GL-account info for one of the quote's lines", async () => {
    const { app } = await harness(true);
    const id = await createSentAcceptedQuote(app);
    const res = await app.fetch(
      req(`/${id}/convert-to-invoice`, {
        method: "POST",
        permissions: "sales.invoice.create",
        body: JSON.stringify({ ...convertBody, lines: [] }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
