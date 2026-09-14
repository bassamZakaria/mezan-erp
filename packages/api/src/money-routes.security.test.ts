import { describe, it, expect, afterEach } from "vitest";
import { Money, type Account } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteVoucherStore,
} from "@mezan/persistence";
import { createGlRoutes, type GlRoutesDeps } from "./gl-routes.js";
import { createVouchersRoutes, type VoucherRoutesDeps } from "./vouchers-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
/**
 * Every route here moves money. A 403 that still wrote the row is the bug worth
 * catching, so each refusal is followed by a re-read of BOTH stores: the
 * document is still where it was, and the general ledger balance has not
 * changed by a millieme. The starting balances are deliberately non-zero —
 * zero-to-zero survives most plausible bugs.
 */

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

const CASH = "1300-1";
const REVENUE = "4000";
const COUNTERPARTY = "1100";

function account(id: string, overrides: Partial<Account> = {}): Account {
  const base = {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset" as const,
    naturalBalance: "debit" as const,
    parentId: null,
    isHeader: false,
    status: "active" as const,
  };
  return { ...base, ...overrides };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  headers.set("x-user-id", "tester");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function glHarness() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(ledger, accounts, periods);
  await accounts.create(account(CASH));
  await accounts.create(account(REVENUE, { type: "revenue", naturalBalance: "credit" }));
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });
  const deps: GlRoutesDeps = {
    ledger,
    accounts,
    periods,
    numbering: ledger.numbering,
    now: () => "2026-08-22T10:00:00.000Z",
    idGen: () => "rev-fixed",
  };
  return { app: createGlRoutes(deps, insecureHeaderAuthContextResolver), ledger };
}

function entry(id: string, amount: string) {
  return {
    id,
    date: "2026-08-22",
    memo: "بيع نقدي",
    lines: [
      { accountId: CASH, debit: amount, credit: "0" },
      { accountId: REVENUE, debit: "0", credit: amount },
    ],
  };
}

describe("POST /gl/journal-entries refuses every caller but the one holding accounting.journal.post", () => {
  it("refuses no permission, a different permission and a look-alike tier, and posts nothing", async () => {
    const { app, ledger } = await glHarness();

    // Non-zero starting position: one legitimately posted entry.
    const seeded = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify(entry("je-seed", "1250.50")) }),
    );
    expect(seeded.status).toBe(201);
    expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("1250.500000");

    const refusals = ["", "sales.invoice.confirm", "accounting.journal.view", "accounting.journal.create", "accounting.journal.approve"];
    for (const permissions of refusals) {
      const res = await app.fetch(
        req("/journal-entries", { method: "POST", permissions, body: JSON.stringify(entry("je-forbidden", "999.00")) }),
      );
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe("PERMISSION_DENIED");

      // Nothing written: the ledger still holds only the seeded entry, and the
      // cash balance has not moved.
      const rows = await ledger.list();
      expect(rows.map((e) => e.id)).toEqual(["je-seed"]);
      expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("1250.500000");
    }

    // …and the gate is not simply always-closed.
    const allowed = await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify(entry("je-ok", "100.00")) }),
    );
    expect(allowed.status).toBe(201);
    expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("1350.500000");
  });

  it("refuses to POST an existing draft holding only the create permission that made it", async () => {
    const { app, ledger } = await glHarness();
    const draft = await app.fetch(
      req("/journal-entries/draft", { method: "POST", permissions: "accounting.journal.create", body: JSON.stringify(entry("je-draft", "480.25")) }),
    );
    expect(draft.status).toBe(201);
    expect(((await draft.json()) as { status: string }).status).toBe("draft");
    expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("0.000000");

    for (const permissions of ["accounting.journal.create", "accounting.journal.view", "accounting.journal.approve"]) {
      const res = await app.fetch(req("/journal-entries/je-draft/post", { method: "POST", permissions }));
      expect(res.status).toBe(403);
      const stored = await ledger.findById("je-draft");
      expect(stored?.status).toBe("draft");
      expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("0.000000");
    }

    const posted = await app.fetch(req("/journal-entries/je-draft/post", { method: "POST", permissions: "accounting.journal.post" }));
    expect(posted.status).toBe(200);
    expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("480.250000");
  });

  it("refuses to reverse a posted entry without the post permission, leaving the balance intact", async () => {
    const { app, ledger } = await glHarness();
    await app.fetch(
      req("/journal-entries", { method: "POST", permissions: "accounting.journal.post", body: JSON.stringify(entry("je-1", "700.00")) }),
    );
    expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("700.000000");

    for (const permissions of ["accounting.journal.view", "accounting.journal.create", "accounting.journal.approve"]) {
      const res = await app.fetch(
        req("/journal-entries/je-1/reverse", { method: "POST", permissions, body: JSON.stringify({ date: "2026-08-23" }) }),
      );
      expect(res.status).toBe(403);
      expect(await ledger.list()).toHaveLength(1);
      expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("700.000000");
    }
  });
});

async function voucherHarness() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const treasury = createSqliteTreasuryAccountRepository();
  const store = createSqliteVoucherStore();
  closers.push(ledger, accounts, periods, treasury, store);

  await accounts.create(account(CASH));
  await accounts.create(account(COUNTERPARTY));
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });
  await treasury.create({
    id: "ta-cash1",
    code: "CASH-001",
    name: "صندوق الفرع",
    nameEn: null,
    type: "cash",
    currency: "EGP",
    branchId: "b1",
    glAccountId: CASH,
    openingBalance: Money.zero(),
    openingBalanceDate: null,
    guaranteeFacilityLimit: null,
    status: "active",
  });

  let seq = 0;
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
    idGen: () => `gen-${++seq}`,
  };
  return { app: createVouchersRoutes(deps, insecureHeaderAuthContextResolver), ledger, store };
}

function voucher(id: string, amount: string) {
  return {
    id,
    date: "2026-08-22",
    voucherType: "customer_collection",
    amount,
    branchId: "b1",
    paymentMethod: "cash",
    treasuryAccountId: "ta-cash1",
    treasuryGlAccountId: CASH,
    counterpartyGlAccountId: COUNTERPARTY,
    customerId: "cust-1",
  };
}

describe("cash vouchers refuse a caller without the confirming or voiding permission", () => {
  it("refuses to confirm for a viewer, a creator and an empty grant — no GL line, still a draft", async () => {
    const { app, ledger } = await voucherHarness();

    // Non-zero starting position: one voucher legitimately confirmed.
    await app.fetch(req("/", { method: "POST", permissions: "treasury.cash_voucher.create", body: JSON.stringify(voucher("v0", "250.00")) }));
    const okConfirm = await app.fetch(req("/v0/confirm", { method: "POST", permissions: "treasury.cash_voucher.confirm" }));
    expect(okConfirm.status).toBe(200);
    expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("250.000000");

    await app.fetch(req("/", { method: "POST", permissions: "treasury.cash_voucher.create", body: JSON.stringify(voucher("v1", "900.00")) }));

    const refusals = ["", "treasury.cash_voucher.view", "treasury.cash_voucher.create", "treasury.account.view", "sales.invoice.confirm"];
    for (const permissions of refusals) {
      const res = await app.fetch(req("/v1/confirm", { method: "POST", permissions }));
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe("PERMISSION_DENIED");

      const read = await app.fetch(req("/v1", { permissions: "*" }));
      const doc = (await read.json()) as { status: string; docNo: string | null };
      expect(doc.status).toBe("draft");
      expect(doc.docNo).toBeNull();
      expect(await ledger.list()).toHaveLength(1);
      expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("250.000000");
    }

    const allowed = await app.fetch(req("/v1/confirm", { method: "POST", permissions: "treasury.cash_voucher.confirm" }));
    expect(allowed.status).toBe(200);
    expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("1150.000000");
  });

  it("refuses to cancel or reverse for a caller holding confirm rather than void", async () => {
    const { app, ledger } = await voucherHarness();
    await app.fetch(req("/", { method: "POST", permissions: "treasury.cash_voucher.create", body: JSON.stringify(voucher("v1", "410.75")) }));
    await app.fetch(req("/v1/confirm", { method: "POST", permissions: "treasury.cash_voucher.confirm" }));
    expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("410.750000");

    for (const permissions of ["treasury.cash_voucher.confirm", "treasury.cash_voucher.view", "treasury.allocation.manage"]) {
      const cancelled = await app.fetch(req("/v1/cancel", { method: "POST", permissions }));
      expect(cancelled.status).toBe(403);

      const reversed = await app.fetch(
        req("/v1/reverse", { method: "POST", permissions, body: JSON.stringify({ date: "2026-08-23" }) }),
      );
      expect(reversed.status).toBe(403);

      const read = await app.fetch(req("/v1", { permissions: "*" }));
      expect(((await read.json()) as { status: string }).status).toBe("confirmed");
      expect(await ledger.list()).toHaveLength(1);
      expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("410.750000");
    }

    const voided = await app.fetch(
      req("/v1/reverse", { method: "POST", permissions: "treasury.cash_voucher.void", body: JSON.stringify({ date: "2026-08-23" }) }),
    );
    expect(voided.status).toBe(201);
    expect(await ledger.list()).toHaveLength(2);
    expect((await ledger.accountBalance(CASH)).balance.toString()).toBe("0.000000");
  });

  it("refuses an allocation — money applied to an invoice — for a caller holding only the view tier", async () => {
    const { app, store } = await voucherHarness();
    await store.invoices.save({
      id: "inv1",
      invoiceNo: "INV-000001",
      kind: "sales",
      partyId: "cust-1",
      date: "2026-08-10",
      total: Money.fromMajor("200.00"),
      allocated: Money.zero(),
    });
    await app.fetch(req("/", { method: "POST", permissions: "treasury.cash_voucher.create", body: JSON.stringify(voucher("v1", "250.00")) }));
    await app.fetch(req("/v1/confirm", { method: "POST", permissions: "treasury.cash_voucher.confirm" }));

    const body = JSON.stringify({ invoiceId: "inv1", amount: "200.00" });
    for (const permissions of ["treasury.allocation.view", "treasury.cash_voucher.confirm", ""]) {
      const res = await app.fetch(req("/v1/allocations", { method: "POST", permissions, body }));
      expect(res.status).toBe(403);
      const invoice = await store.invoices.findById("inv1");
      expect(invoice?.allocated.toString()).toBe("0.000000");
      expect(await store.allocations.listByVoucher("v1")).toHaveLength(0);
    }

    const allowed = await app.fetch(req("/v1/allocations", { method: "POST", permissions: "treasury.allocation.manage", body }));
    expect(allowed.status).toBe(201);
    expect((await store.invoices.findById("inv1"))?.allocated.toString()).toBe("200.000000");
  });
});
