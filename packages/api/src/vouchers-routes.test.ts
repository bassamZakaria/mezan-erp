import { describe, it, expect, afterEach } from "vitest";
import type { Account } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteVoucherStore,
} from "@mezan/persistence";
import { createVouchersRoutes, createAllocationRoutes, type VoucherRoutesDeps } from "./vouchers-routes.js";

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
  return { vouchers: createVouchersRoutes(deps), root: createAllocationRoutes(deps), ledger };
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
