import { describe, it, expect, afterEach } from "vitest";
import {
  ChequeService,
  Money,
  createAuthContext,
  type Account,
  type GateConfig,
} from "@mezan/domain";
import type { Context } from "hono";
import {
  openSqliteConnection,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteVoucherStore,
  createSqliteApprovalRequestStore,
  createSqliteChequeRepository,
} from "@mezan/persistence";
import { createVouchersRoutes, createAllocationRoutes, type VoucherRoutesDeps } from "./vouchers-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

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

function req(path: string, init: RequestInit & { permissions?: string; roleCodes?: string; userId?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? "*");
  if (init.roleCodes !== undefined) headers.set("x-role-codes", init.roleCodes);
  headers.set("x-user-id", init.userId ?? "tester");
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

/**
 * A harness with the two seams the defects below need: a configurable approval
 * chain (DEC-2) and a real cheque register behind the voucher screen (D81).
 */
async function newGatedApp(opts: { gate?: GateConfig; withRegister?: boolean } = {}) {
  const { sqlite } = openSqliteConnection(":memory:");
  closers.push({ close: () => sqlite.close() });
  const ledger = createSqliteLedgerStore(sqlite);
  const accounts = createSqliteAccountRepository(sqlite);
  const periods = createSqliteFiscalPeriodRepository(sqlite);
  const treasury = createSqliteTreasuryAccountRepository(sqlite);
  const store = createSqliteVoucherStore(sqlite);
  const requests = createSqliteApprovalRequestStore(sqlite);
  const chequeRepo = createSqliteChequeRepository(sqlite);

  await accounts.create(account("1300-1"));
  await accounts.create(account("1100"));
  await accounts.create(account("1320"));
  await accounts.create(account("1360"));
  await periods.create({ id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  await treasury.create({ id: "ta-cash1", code: "CASH-001", name: "صندوق", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: "1300-1", openingBalance: Money.zero(), openingBalanceDate: null, status: "active" });

  const gl = { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-22T10:00:00.000Z" };
  const register = new ChequeService({ cheques: chequeRepo, gl, now: () => "2026-08-22T10:00:00.000Z" });

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
    ...(opts.gate ? { resolveGateConfig: () => opts.gate as GateConfig, approvalRequests: requests } : {}),
    ...(opts.withRegister
      ? {
          cheques: {
            /**
             * What a composition root would bind. The three fields the wire
             * contract does not carry — drawee bank, due date and the
             * "شيكات تحت التحصيل" control account — are supplied here, which is
             * exactly the gap `createVoucherSchema` has to close before a real
             * post-dated cheque can be raised from this screen.
             */
            async register(input) {
              if (!input.chequeNumber) return null;
              const cheque = await register.createCheque({
                id: `chq-${input.voucherId}`,
                direction: input.direction,
                chequeNumber: input.chequeNumber,
                bankName: "بنك مصر",
                amount: input.amount,
                currency: input.currency,
                issueDate: input.issueDate,
                dueDate: "2026-09-30",
                branchId: input.branchId,
                partyId: input.partyId ?? "unknown",
                counterpartyGlAccountId: input.counterpartyGlAccountId ?? "1100",
                controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
                journalEntryId: `chq-je-${input.voucherId}`,
                actor: input.actor,
              });
              return { chequeId: cheque.id };
            },
          },
        }
      : {}),
  };
  return { vouchers: createVouchersRoutes(deps, testAuthContextResolver), register, ledger };
}

/**
 * Guards DEC-2. `GateStep.role` is a ROLE code, and this route used to hand the
 * gate `ctx.permissions` — the resolved PERMISSION set — as `actorRoles`, so
 * the admin bypass keyed off the wrong vocabulary entirely.
 */
describe("what the voucher confirm feeds the workflow gate", () => {
  const gate: GateConfig = { actionType: "TREASURY_VOUCHER_CONFIRM", steps: [{ role: "FINANCE_MANAGER" }] };

  it("holds a role-gated confirm for a caller who does not hold the role", async () => {
    const { vouchers } = await newGatedApp({ gate });
    await vouchers.fetch(
      req("/", { method: "POST", body: JSON.stringify(collection), permissions: "treasury.cash_voucher.create", roleCodes: "CLERK" }),
    );
    const res = await vouchers.fetch(
      req("/v1/confirm", { method: "POST", permissions: "treasury.cash_voucher.confirm", roleCodes: "CLERK" }),
    );
    expect(((await res.json()) as any).held).toBe(true);
  });

  it("reads the bypass off the caller's ROLES, not off their permissions", async () => {
    // The discriminator: narrow permissions, admin role. Fed the permission set
    // the gate would see no `"*"` and hold the voucher.
    const { vouchers } = await newGatedApp({ gate });
    await vouchers.fetch(
      req("/", { method: "POST", body: JSON.stringify(collection), permissions: "treasury.cash_voucher.create", roleCodes: "*" }),
    );
    const res = await vouchers.fetch(
      req("/v1/confirm", { method: "POST", permissions: "treasury.cash_voucher.confirm", roleCodes: "*" }),
    );
    const body = (await res.json()) as any;
    expect(body.held).toBe(false);
    expect(body.status).toBe("confirmed");
  });
});

/**
 * Guards D81: a voucher paid by «شيك» wrote nothing into «سجل الشيكات», so the
 * register missed every cheque raised on the voucher screen — and post-dated
 * cheques are ordinary receivables for this market.
 */
describe("a voucher paid by cheque", () => {
  const chequeCollection = { ...collection, paymentMethod: "cheque", referenceNo: "CHQ-7788" };
  const chequePayment = {
    id: "v2",
    date: "2026-08-22",
    voucherType: "supplier_payment",
    amount: "300.00",
    branchId: "b1",
    paymentMethod: "cheque",
    treasuryAccountId: "ta-cash1",
    treasuryGlAccountId: "1300-1",
    counterpartyGlAccountId: "1100",
    supplierId: "sup-1",
    referenceNo: "CHQ-9001",
  };

  it("puts an INCOMING cheque in the register for a receipt voucher, with the acting user", async () => {
    const { vouchers, register } = await newGatedApp({ withRegister: true });
    const created = await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify(chequeCollection), userId: "nadia" }));
    expect(created.status).toBe(201);

    const rows = await register.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: "incoming",
      chequeNumber: "CHQ-7788",
      partyId: "cust-1",
      branchId: "b1",
    });
    expect(rows[0]!.amount.toString()).toBe("250.000000");
  });

  it("puts an OUTGOING cheque in the register for a payment voucher", async () => {
    const { vouchers, register } = await newGatedApp({ withRegister: true });
    await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify(chequePayment), userId: "hossam" }));
    const rows = await register.list();
    expect(rows.map((r) => [r.direction, r.chequeNumber, r.partyId])).toEqual([["outgoing", "CHQ-9001", "sup-1"]]);
  });

  it("leaves the register alone for a voucher paid any other way", async () => {
    const { vouchers, register } = await newGatedApp({ withRegister: true });
    await vouchers.fetch(req("/", { method: "POST", body: JSON.stringify(collection) }));
    expect(await register.list()).toHaveLength(0);
  });
});

