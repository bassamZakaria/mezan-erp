import { describe, it, expect, afterEach } from "vitest";
import { Money, type Account } from "@mezan/domain";
import {
  openSqliteConnection,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteVoucherStore,
} from "@mezan/persistence";
import { createVouchersRoutes, createAllocationRoutes, type VoucherRoutesDeps } from "./vouchers-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

let idSeq = 0;

async function newApp() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const treasury = createSqliteTreasuryAccountRepository();
  const store = createSqliteVoucherStore();
  closers.push(ledger, accounts, periods, treasury, store);

  await accounts.create(account("1300-1"));
  await accounts.create(account("1100"));
  await accounts.create(account("2100", { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account("4900", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("5900", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("3100", { type: "equity", naturalBalance: "credit" }));
  await periods.create({ id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  await treasury.create({ id: "ta-cash1", code: "CASH-001", name: "صندوق", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: "1300-1", openingBalance: (await import("@mezan/domain")).Money.zero(), openingBalanceDate: null, status: "active" });
  await store.invoices.save({ id: "inv1", invoiceNo: "INV-000001", kind: "sales", partyId: "cust-1", date: "2026-08-10", total: (await import("@mezan/domain")).Money.fromMajor("200"), allocated: (await import("@mezan/domain")).Money.zero() });

  idSeq = 0;
  const deps: VoucherRoutesDeps = {
    documents: store.documents,
    allocations: store.allocations,
    invoices: store.invoices,
    ledger,
    accounts,
    periods,
    numbering: ledger.numbering,
    treasuryAccounts: treasury,
    now: () => "2026-08-22T10:00:00.000Z",
    idGen: () => `gen-${++idSeq}`,
  };
  return { vouchers: createVouchersRoutes(deps, insecureHeaderAuthContextResolver), root: createAllocationRoutes(deps, insecureHeaderAuthContextResolver), ledger };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? "*");
  headers.set("x-user-id", "tester");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const collection = {
  id: "v1",
  date: "2026-08-22",
  voucherType: "customer_collection",
  amount: "250.00",
  branchId: "b1",
  paymentMethod: "cash",
  treasuryAccountId: "ta-cash1",
  treasuryGlAccountId: "1300-1",
  counterpartyGlAccountId: "1100",
  customerId: "cust-1",
};

describe("vouchers routes", () => {
  it("creates a draft then confirms it (posts GL, stamps CV-000001)", async () => {
    const { vouchers, ledger } = await newApp();
    const created = await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify(collection) }));
    expect(created.status).toBe(201);
    expect((await created.json() as any).status).toBe("draft");

    const confirmed = await vouchers.fetch(req("/v1/confirm", { method: "POST" }));
    expect(confirmed.status).toBe(200);
    const body = await confirmed.json() as any;
    expect(body.status).toBe("confirmed");
    expect(body.docNo).toBe("CV-000001");
    expect(body.held).toBe(false);
    expect((await ledger.accountBalance("1300-1")).balance.toString()).toBe("250.000000");
  });

  it("filters the list by voucher type", async () => {
    const { vouchers } = await newApp();
    await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify(collection) }));
    await vouchers.fetch(req("/v1/confirm", { method: "POST" }));
    const res = await vouchers.fetch(req("/?type=customer_collection"));
    expect((await res.json() as any)).toHaveLength(1);
    const none = await vouchers.fetch(req("/?type=supplier_payment"));
    expect((await none.json() as any)).toHaveLength(0);
  });

  it("blocks a cash payment that would overdraw the drawer (422)", async () => {
    const { vouchers } = await newApp();
    await vouchers.fetch(
      req("/", {
        method: "POST",
        body: JSON.stringify({
          id: "vx",
          date: "2026-08-22",
          voucherType: "other_expense",
          amount: "100.00",
          branchId: "b1",
          paymentMethod: "cash",
          treasuryAccountId: "ta-cash1",
          treasuryGlAccountId: "1300-1",
          counterpartyGlAccountId: "5900",
        }),
      }),
    );
    const res = await vouchers.fetch(req("/vx/confirm", { method: "POST" }));
    expect(res.status).toBe(422);
    expect((await res.json() as any).error).toBe("CASH_BALANCE_NEGATIVE");
  });

  it("allocates a confirmed collection onto an open invoice and reverses it", async () => {
    const { vouchers, root } = await newApp();
    await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify(collection) }));
    await vouchers.fetch(req("/v1/confirm", { method: "POST" }));

    const open = await root.fetch(req("/open-invoices?kind=sales&partyId=cust-1"));
    expect((await open.json() as any)).toHaveLength(1);

    const alloc = await vouchers.fetch(
      req("/v1/allocations", { method: "POST", body: JSON.stringify({ allocationId: "al1", invoiceId: "inv1", amount: "120.00" }) }),
    );
    expect(alloc.status).toBe(201);

    const detail = await vouchers.fetch(req("/v1"));
    const detailBody = await detail.json() as any;
    expect(detailBody.allocationSummary.allocated).toBe("120.000000");
    expect(detailBody.allocationSummary.needsAllocation).toBe(true);

    const rev = await root.fetch(req("/allocations/al1/reverse", { method: "POST" }));
    expect(rev.status).toBe(200);
    expect((await rev.json() as any).status).toBe("reversed");

    const after = await vouchers.fetch(req("/v1"));
    expect((await after.json() as any).allocationSummary.allocated).toBe("0.000000");
  });

  it("over-allocation is refused (422)", async () => {
    const { vouchers } = await newApp();
    await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify(collection) }));
    await vouchers.fetch(req("/v1/confirm", { method: "POST" }));
    const res = await vouchers.fetch(
      req("/v1/allocations", { method: "POST", body: JSON.stringify({ invoiceId: "inv1", amount: "300.00" }) }),
    );
    expect(res.status).toBe(422);
    expect((await res.json() as any).error).toBe("ALLOCATION_EXCEEDS");
  });

  it("denies creation without the create permission (403)", async () => {
    const { vouchers } = await newApp();
    const res = await vouchers.fetch(req("/", { method: "POST", permissions: "treasury.cash_voucher.view", body: JSON.stringify(collection) }));
    expect(res.status).toBe(403);
  });
});

/**
 * A second harness over ONE SQLite connection, the way `create-backend` wires
 * it: the CV- counter and the voucher document live in the same transaction, so
 * a confirm that fails must not burn a number. It also carries a CLOSED July
 * period, a second (bank) treasury account and the 3200 drawings account, none
 * of which the original harness needs.
 */
async function newClosedPeriodApp() {
  const { sqlite } = openSqliteConnection(":memory:");
  closers.push({ close: () => sqlite.close() });
  const ledger = createSqliteLedgerStore(sqlite);
  const accounts = createSqliteAccountRepository(sqlite);
  const periods = createSqliteFiscalPeriodRepository(sqlite);
  const treasury = createSqliteTreasuryAccountRepository(sqlite);
  const store = createSqliteVoucherStore(sqlite);

  await accounts.create(account("1300-1"));
  await accounts.create(account("1310"));
  await accounts.create(account("1100"));
  await accounts.create(account("2100", { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account("3100", { type: "equity", naturalBalance: "credit" }));
  await accounts.create(account("3200", { type: "equity", naturalBalance: "debit" }));
  await accounts.create(account("5900", { type: "expense", naturalBalance: "debit" }));
  await periods.create({ id: "fp-2026-07", year: 2026, periodNumber: 7, startDate: "2026-07-01", endDate: "2026-07-31", status: "closed" });
  await periods.create({ id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  await treasury.create({ id: "ta-cash1", code: "CASH-001", name: "الخزينة الرئيسية", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: "1300-1", openingBalance: Money.zero(), openingBalanceDate: null, status: "active" });
  await treasury.create({ id: "ta-bank1", code: "BANK-001", name: "البنك الأهلي", nameEn: null, type: "bank", currency: "EGP", branchId: "b1", glAccountId: "1310", openingBalance: Money.zero(), openingBalanceDate: null, status: "active" });
  await store.invoices.save({ id: "inv1", invoiceNo: "INV-000001", kind: "sales", partyId: "cust-1", date: "2026-08-10", total: Money.fromMajor("200"), allocated: Money.zero() });

  idSeq = 0;
  const deps: VoucherRoutesDeps = {
    documents: store.documents,
    allocations: store.allocations,
    invoices: store.invoices,
    ledger,
    accounts,
    periods,
    numbering: ledger.numbering,
    treasuryAccounts: treasury,
    now: () => "2026-08-22T10:00:00.000Z",
    idGen: () => `gen-${++idSeq}`,
  };
  return { vouchers: createVouchersRoutes(deps, insecureHeaderAuthContextResolver), root: createAllocationRoutes(deps, insecureHeaderAuthContextResolver), ledger, store };
}

const backdated = {
  id: "v-july",
  date: "2026-07-20",
  voucherType: "customer_collection",
  amount: "900.00",
  branchId: "b1",
  paymentMethod: "cash",
  treasuryAccountId: "ta-cash1",
  treasuryGlAccountId: "1300-1",
  counterpartyGlAccountId: "1100",
  customerId: "cust-1",
};


describe("a voucher back-dated into a closed day", () => {
  it("is refused, posts nothing, and leaves the voucher a draft", async () => {
    const { vouchers, ledger } = await newClosedPeriodApp();
    const created = await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify(backdated) }));
    expect(created.status).toBe(201);

    const res = await vouchers.fetch(req("/v-july/confirm", { method: "POST" }));
    expect(res.status).toBe(422);
    expect((await res.json() as any).error).toBe("PERIOD_NOT_OPEN_FOR_POSTING");

    const detail = await (await vouchers.fetch(req("/v-july"))).json() as any;
    expect(detail.status).toBe("draft");
    expect(detail.docNo).toBeNull();
    expect(detail.journalEntryId).toBeNull();
    expect((await ledger.accountBalance("1300-1")).balance.toString()).toBe("0.000000");
  });

  it("does not burn a سند number — the next good voucher is still CV-000001", async () => {
    const { vouchers } = await newClosedPeriodApp();
    await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify(backdated) }));
    expect((await vouchers.fetch(req("/v-july/confirm", { method: "POST" }))).status).toBe(422);

    await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify({ ...backdated, id: "v-aug", date: "2026-08-22" }) }));
    const ok = await vouchers.fetch(req("/v-aug/confirm", { method: "POST" }));
    expect(ok.status).toBe(200);
    expect((await ok.json() as any).docNo).toBe("CV-000001");
  });
});

describe("a posted voucher cannot be edited or re-posted", () => {
  it("offers no update route at all — correction is by reversal only", async () => {
    const { vouchers } = await newClosedPeriodApp();
    await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify({ ...backdated, id: "v1", date: "2026-08-22" }) }));
    await vouchers.fetch(req("/v1/confirm", { method: "POST" }));

    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await vouchers.fetch(req("/v1", { method, body: JSON.stringify({ amount: "1.00" }) }));
      expect(res.status).toBe(404);
    }
    const detail = await (await vouchers.fetch(req("/v1"))).json() as any;
    expect(detail.amount).toBe("900.000000");
    expect(detail.status).toBe("confirmed");
  });

  it("refuses a second confirm and does not post the amount twice", async () => {
    const { vouchers, ledger } = await newClosedPeriodApp();
    await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify({ ...backdated, id: "v1", date: "2026-08-22" }) }));
    await vouchers.fetch(req("/v1/confirm", { method: "POST" }));
    expect((await ledger.accountBalance("1300-1")).balance.toString()).toBe("900.000000");

    const again = await vouchers.fetch(req("/v1/confirm", { method: "POST" }));
    expect(again.status).toBe(409);
    expect((await ledger.accountBalance("1300-1")).balance.toString()).toBe("900.000000");
  });

  it("refuses to cancel a confirmed voucher — a live one is reversed, never cancelled", async () => {
    const { vouchers } = await newClosedPeriodApp();
    await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify({ ...backdated, id: "v1", date: "2026-08-22" }) }));
    await vouchers.fetch(req("/v1/confirm", { method: "POST" }));

    const res = await vouchers.fetch(req("/v1/cancel", { method: "POST" }));
    expect(res.status).toBe(409);
    expect((await (await vouchers.fetch(req("/v1"))).json() as any).status).toBe("confirmed");
  });
});

