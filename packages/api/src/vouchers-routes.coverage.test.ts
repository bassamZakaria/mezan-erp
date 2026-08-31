import { describe, it, expect, afterEach } from "vitest";
import { Money, type Account } from "@mezan/domain";
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

async function newApp() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const treasury = createSqliteTreasuryAccountRepository();
  const store = createSqliteVoucherStore();
  closers.push(ledger, accounts, periods, treasury, store);

  await accounts.create(account("1300-1"));
  await accounts.create(account("1300-2"));
  await accounts.create(account("1300-3"));
  await accounts.create(account("1100"));
  await accounts.create(account("2100", { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account("4900", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("5900", { type: "expense", naturalBalance: "debit" }));
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });
  for (const [id, code, glAccountId, branchId, type] of [
    ["ta-cash1", "CASH-001", "1300-1", "b1", "cash"],
    ["ta-cash2", "CASH-002", "1300-2", "b2", "cash"],
    // A bank account, so a payment is not measured against a cash drawer's balance.
    ["ta-bank1", "BANK-001", "1300-3", "b1", "bank"],
  ] as const) {
    await treasury.create({
      id,
      code,
      name: "صندوق",
      nameEn: null,
      type,
      currency: "EGP",
      branchId,
      glAccountId,
      openingBalance: Money.fromMajor("10000"),
      openingBalanceDate: "2026-08-01",
      status: "active",
    });
  }
  await store.invoices.save({
    id: "inv1",
    invoiceNo: "INV-000001",
    kind: "sales",
    partyId: "cust-1",
    date: "2026-08-10",
    total: Money.fromMajor("200"),
    allocated: Money.zero(),
  });
  await store.invoices.save({
    id: "inv3",
    invoiceNo: "INV-000002",
    kind: "sales",
    partyId: "cust-1",
    date: "2026-08-12",
    total: Money.fromMajor("150"),
    allocated: Money.zero(),
  });
  await store.invoices.save({
    id: "inv2",
    invoiceNo: "PI-000001",
    kind: "purchase",
    partyId: "sup-1",
    date: "2026-08-11",
    total: Money.fromMajor("500"),
    allocated: Money.zero(),
  });

  let idSeq = 0;
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
  return { vouchers: createVouchersRoutes(deps), root: createAllocationRoutes(deps), ledger, store };
}

type App = Awaited<ReturnType<typeof newApp>>["vouchers"];

function req(
  path: string,
  init: RequestInit & { permissions?: string; branchScope?: string } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? "*");
  headers.set("x-user-id", "tester");
  if (init.branchScope !== undefined) headers.set("x-branch-scope", init.branchScope);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

type ReqInit = Parameters<typeof req>[1];

async function post(app: App, path: string, payload?: unknown, init: ReqInit = {}) {
  return app.fetch(
    req(path, { method: "POST", ...init, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function get(app: App, path: string, init: ReqInit = {}) {
  return app.fetch(req(path, init));
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function collection(overrides: Record<string, unknown> = {}) {
  return {
    id: "v-collect",
    date: "2026-08-22",
    voucherType: "customer_collection",
    amount: "250.00",
    branchId: "b1",
    paymentMethod: "cash",
    treasuryAccountId: "ta-cash1",
    treasuryGlAccountId: "1300-1",
    counterpartyGlAccountId: "1100",
    customerId: "cust-1",
    ...overrides,
  };
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "v-pay",
    date: "2026-08-22",
    voucherType: "supplier_payment",
    amount: "100.00",
    branchId: "b1",
    paymentMethod: "bank",
    treasuryAccountId: "ta-bank1",
    treasuryGlAccountId: "1300-3",
    counterpartyGlAccountId: "2100",
    supplierId: "sup-1",
    ...overrides,
  };
}

describe("vouchers-routes — every axis the treasury list narrows by", () => {
  async function seeded(app: App) {
    await post(app, "/", collection({ referenceNo: "REF-77" }));
    await post(app, "/v-collect/confirm", {});
    await post(app, "/", payment({ date: "2026-08-10" }));
    await post(app, "/", collection({ id: "v-b2", branchId: "b2", treasuryAccountId: "ta-cash2", treasuryGlAccountId: "1300-2", amount: "40.00" }));
  }

  async function idsOf(app: App, query: string, init: ReqInit = {}) {
    const rows = await json<Array<{ id: string }>>(await get(app, `/${query}`, init));
    return rows.map((r) => r.id);
  }

  it("filters by type, status, branch, both date bounds and free text", async () => {
    const { vouchers } = await newApp();
    const created = [
      await post(vouchers, "/", collection({ referenceNo: "REF-77" })),
      await post(vouchers, "/v-collect/confirm", {}),
      await post(vouchers, "/", payment({ date: "2026-08-10" })),
      await post(
        vouchers,
        "/",
        collection({
          id: "v-b2",
          branchId: "b2",
          treasuryAccountId: "ta-cash2",
          treasuryGlAccountId: "1300-2",
          amount: "40.00",
        }),
      ),
    ];
    expect(await Promise.all(created.map(async (r) => (r.ok ? r.status : await r.text())))).toEqual([
      201, 200, 201, 201,
    ]);

    expect(await idsOf(vouchers, "")).toHaveLength(3);
    expect(await idsOf(vouchers, "?type=supplier_payment")).toEqual(["v-pay"]);
    expect(await idsOf(vouchers, "?status=draft")).toEqual(expect.arrayContaining(["v-pay", "v-b2"]));
    expect(await idsOf(vouchers, "?status=confirmed")).toEqual(["v-collect"]);
    expect(await idsOf(vouchers, "?branchId=b2")).toEqual(["v-b2"]);
    expect(await idsOf(vouchers, "?fromDate=2026-08-20")).toEqual(expect.arrayContaining(["v-collect", "v-b2"]));
    expect(await idsOf(vouchers, "?toDate=2026-08-15")).toEqual(["v-pay"]);
    expect(await idsOf(vouchers, "?search=REF-77")).toEqual(["v-collect"]);
    expect(await idsOf(vouchers, "?search=CV-000001")).toEqual(["v-collect"]);
    expect(await idsOf(vouchers, "?search=%20%20")).toHaveLength(3);
  });

  it("never lets a query parameter widen the caller's branch scope", async () => {
    const { vouchers } = await newApp();
    await seeded(vouchers);

    expect(await idsOf(vouchers, "", { branchScope: "b2" })).toEqual(["v-b2"]);
    expect(await idsOf(vouchers, "?branchId=b1", { branchScope: "b2" })).toEqual([]);
  });

  it("serves the needs-allocation work queue split by direction", async () => {
    const { vouchers } = await newApp();
    await seeded(vouchers);
    const confirmed = await post(vouchers, "/v-pay/confirm", {});
    expect(confirmed.ok ? confirmed.status : await confirmed.text()).toBe(200);

    expect(await idsOf(vouchers, "?needsAllocation=any")).toEqual(
      expect.arrayContaining(["v-collect", "v-pay"]),
    );
    expect(await idsOf(vouchers, "?needsAllocation=receipt")).toEqual(["v-collect"]);
    expect(await idsOf(vouchers, "?needsAllocation=payment")).toEqual(["v-pay"]);

    // Part of it applied still leaves it in the queue…
    await post(vouchers, "/v-collect/allocations", { invoiceId: "inv1", amount: "200.00" });
    expect(await idsOf(vouchers, "?needsAllocation=receipt")).toEqual(["v-collect"]);

    // …and a voucher applied in full drops out of it.
    await post(vouchers, "/", collection({ id: "v-exact", amount: "150.00" }));
    await post(vouchers, "/v-exact/confirm", {});
    await post(vouchers, "/v-exact/allocations", { invoiceId: "inv3", amount: "150.00" });
    expect(await idsOf(vouchers, "?needsAllocation=receipt")).toEqual(["v-collect"]);
  });

  it("counts each chip axis against every filter but its own", async () => {
    const { vouchers } = await newApp();
    await seeded(vouchers);

    const counts = await json<Record<string, number>>(await get(vouchers, "/counts?status=confirmed"));
    expect(counts.all).toBe(3);
    expect(counts.draft).toBe(2);
    expect(counts.confirmed).toBe(1);
    expect(counts.needs_allocation).toBe(1);
    expect(counts.needs_allocation_receipt).toBe(1);
    expect(counts.needs_allocation_payment).toBe(0);
    // Every type is counted, including the ones nobody has used.
    // The type axis keeps the status filter, so only the confirmed collection counts.
    expect(counts["type:customer_collection"]).toBe(1);
    expect(counts["type:supplier_payment"]).toBe(0);
    expect(counts["type:tax_payment"]).toBe(0);

    // The type axis keeps the status filter, so selecting a type does not make
    // the status chips read the whole book.
    const withType = await json<Record<string, number>>(await get(vouchers, "/counts?type=supplier_payment"));
    expect(withType.all).toBe(1);
    expect(withType.draft).toBe(1);
    // The type axis drops only itself, so it still counts every type.
    expect(withType["type:customer_collection"]).toBe(2);
    expect(withType["type:supplier_payment"]).toBe(1);
  });

  it("sums the strip in Money and leaves a transfer out of both money totals", async () => {
    const { vouchers } = await newApp();
    await seeded(vouchers);
    await post(vouchers, "/v-pay/confirm", {});
    await post(vouchers, "/", {
      id: "v-transfer",
      date: "2026-08-22",
      voucherType: "inter_treasury_transfer",
      amount: "100.00",
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterTreasuryAccountId: "ta-cash2",
      counterTreasuryGlAccountId: "1300-2",
    });
    await post(vouchers, "/v-transfer/confirm", {});

    const stats = await json<{
      count: number;
      confirmed: number;
      draft: number;
      needsAllocation: number;
      receipts: string;
      payments: string;
      net: string;
      unallocated: string;
    }>(await get(vouchers, "/stats"));

    expect(stats.count).toBe(4);
    expect(stats.confirmed).toBe(3);
    expect(stats.draft).toBe(1);
    expect(stats.receipts).toBe("250.000000");
    expect(stats.payments).toBe("100.000000");
    expect(stats.net).toBe("150.000000");
    expect(stats.needsAllocation).toBe(2);
    expect(stats.unallocated).toBe("350.000000");
  });

  it("400s a list, counts or stats query the contract does not know", async () => {
    const { vouchers } = await newApp();
    for (const path of ["/", "/counts", "/stats"]) {
      const res = await get(vouchers, `${path}?type=bribe`);
      expect(res.status).toBe(400);
      expect((await json<{ error: string }>(res)).error).toBe("VALIDATION_ERROR");
    }
    expect((await get(vouchers, "/?status=imaginary")).status).toBe(400);
  });
});

describe("vouchers-routes — reading one voucher", () => {
  it("carries the allocation summary and the allocations themselves", async () => {
    const { vouchers } = await newApp();
    await post(vouchers, "/", collection());
    await post(vouchers, "/v-collect/confirm", {});
    await post(vouchers, "/v-collect/allocations", { invoiceId: "inv1", amount: "200.00" });

    const doc = await json<{
      allocatable: boolean;
      allocationSummary: { allocated: string; unallocated: string; needsAllocation: boolean };
      allocations: Array<{ invoiceId: string; amount: string; status: string }>;
    }>(await get(vouchers, "/v-collect"));

    expect(doc.allocatable).toBe(true);
    expect(doc.allocationSummary.allocated).toBe("200.000000");
    expect(doc.allocationSummary.unallocated).toBe("50.000000");
    expect(doc.allocationSummary.needsAllocation).toBe(true);
    expect(doc.allocations).toHaveLength(1);
    expect(doc.allocations[0]).toMatchObject({ invoiceId: "inv1", amount: "200.000000", status: "active" });
  });

  it("reports a voucher outside the caller's branch as absent, never as forbidden (D130)", async () => {
    const { vouchers } = await newApp();
    await post(vouchers, "/", collection());

    const res = await get(vouchers, "/v-collect", { branchScope: "b2" });
    expect(res.status).toBe(404);
    expect((await json<{ error: string }>(res)).error).toBe("NOT_FOUND");

    const allocations = await get(vouchers, "/v-collect/allocations", { branchScope: "b2" });
    expect(allocations.status).toBe(404);
  });

  it("404s a voucher and its allocations when the id is unknown", async () => {
    const { vouchers } = await newApp();
    expect((await get(vouchers, "/nope")).status).toBe(404);
    expect((await get(vouchers, "/nope/allocations")).status).toBe(404);
  });

  it("lists the allocations of a voucher that has none", async () => {
    const { vouchers } = await newApp();
    await post(vouchers, "/", collection());
    const res = await json<{ allocations: unknown[]; allocationSummary: { allocated: string } }>(
      await get(vouchers, "/v-collect/allocations"),
    );
    expect(res.allocations).toEqual([]);
    expect(res.allocationSummary.allocated).toBe("0.000000");
  });
});

describe("vouchers-routes — the write endpoints and what they refuse", () => {
  it("mints an id and a document number when the caller supplies neither", async () => {
    const { vouchers } = await newApp();
    const res = await post(vouchers, "/", { ...collection(), id: undefined });
    expect(res.status).toBe(201);
    const doc = await json<{ id: string; docNo: string | null; status: string }>(res);
    expect(doc.id).toBe("gen-1");
    expect(doc.status).toBe("draft");
  });

  it("carries withholding and the cost centre onto the voucher (D26, D27)", async () => {
    const { vouchers } = await newApp();
    const res = await post(
      vouchers,
      "/",
      payment({
        amount: "1000.00",
        withholdingAmount: "50.00",
        withholdingRatePercent: 5,
        withholdingGlAccountId: "2100",
        costCenterId: "cc-1",
        referenceNo: "TRX-1",
      }),
    );
    expect(res.status).toBe(201);
    expect(await json<Record<string, unknown>>(res)).toMatchObject({
      costCenterId: "cc-1",
      withholdingAmount: "50.000000",
      withholdingRatePercent: 5,
      netPaidAmount: "950.000000",
      referenceNo: "TRX-1",
    });
  });

  it("400s a create, a confirm, a reverse and an allocation the schema rejects", async () => {
    const { vouchers } = await newApp();
    await post(vouchers, "/", collection());

    expect((await post(vouchers, "/", { voucherType: "customer_collection" })).status).toBe(400);
    expect((await post(vouchers, "/v-collect/confirm", { requestId: 5 })).status).toBe(400);
    expect((await post(vouchers, "/v-collect/reverse", { date: 5 })).status).toBe(400);
    expect((await post(vouchers, "/v-collect/allocations", { invoiceId: "inv1" })).status).toBe(400);
  });

  it("treats a confirm or a reverse with no body at all as an empty one", async () => {
    const { vouchers } = await newApp();
    await post(vouchers, "/", collection());

    const confirmed = await vouchers.fetch(req("/v-collect/confirm", { method: "POST" }));
    expect(confirmed.status).toBe(200);
    expect((await json<{ status: string }>(confirmed)).status).toBe("confirmed");

    const reversed = await vouchers.fetch(req("/v-collect/reverse", { method: "POST" }));
    expect(reversed.status).toBe(201);
    const { original, reversal } = await json<{ original: { status: string }; reversal: { id: string } }>(reversed);
    expect(original.status).toBe("reversed");
    expect(reversal.id).toBeDefined();
  });

  it("404s a confirm, cancel, reverse or allocation naming a voucher that is not there", async () => {
    const { vouchers } = await newApp();
    expect((await post(vouchers, "/nope/confirm", {})).status).toBe(404);
    expect((await post(vouchers, "/nope/cancel")).status).toBe(404);
    expect((await post(vouchers, "/nope/reverse", {})).status).toBe(404);
  });

  it("409s a second voucher reusing an id already in the book", async () => {
    const { vouchers } = await newApp();
    await post(vouchers, "/", collection());
    const again = await post(vouchers, "/", collection({ amount: "10.00" }));
    expect(again.status).toBe(409);
  });

  it("409s reversing a voucher that was never confirmed", async () => {
    const { vouchers } = await newApp();
    await post(vouchers, "/", collection());
    const res = await post(vouchers, "/v-collect/reverse", {});
    expect(res.status).toBe(409);
  });

  it("409s allocating from a voucher whose type carries no allocation at all", async () => {
    const { vouchers } = await newApp();
    await post(vouchers, "/", {
      id: "v-income",
      date: "2026-08-22",
      voucherType: "other_income",
      amount: "80.00",
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "4900",
    });
    await post(vouchers, "/v-income/confirm", {});
    const res = await post(vouchers, "/v-income/allocations", { invoiceId: "inv1", amount: "10.00" });
    expect(res.status).toBe(409);
  });

  it("404s allocating onto an invoice the sub-ledger does not hold", async () => {
    const { vouchers } = await newApp();
    await post(vouchers, "/", collection());
    await post(vouchers, "/v-collect/confirm", {});
    const res = await post(vouchers, "/v-collect/allocations", { invoiceId: "inv-ghost", amount: "10.00" });
    expect(res.status).toBe(404);
  });

  it("403s each write endpoint for a caller who may only view", async () => {
    const { vouchers } = await newApp();
    await post(vouchers, "/", collection());
    const viewOnly = { permissions: "treasury.cash_voucher.view" };
    expect((await post(vouchers, "/", collection({ id: "v-2" }), viewOnly)).status).toBe(403);
    expect((await post(vouchers, "/v-collect/confirm", {}, viewOnly)).status).toBe(403);
    expect((await post(vouchers, "/v-collect/cancel", undefined, viewOnly)).status).toBe(403);
    expect((await post(vouchers, "/v-collect/reverse", {}, viewOnly)).status).toBe(403);
    expect((await post(vouchers, "/v-collect/allocations", { invoiceId: "inv1", amount: "1.00" }, viewOnly)).status).toBe(
      403,
    );
    expect((await get(vouchers, "/v-collect/allocations", viewOnly)).status).toBe(403);
  });

  it("cancels a draft, and the cancelled voucher posts nothing", async () => {
    const { vouchers, ledger } = await newApp();
    await post(vouchers, "/", collection());
    const res = await post(vouchers, "/v-collect/cancel");
    expect(res.status).toBe(200);
    expect((await json<{ status: string; journalEntryId: string | null }>(res)).status).toBe("cancelled");
    expect(await ledger.list()).toHaveLength(0);
  });
});

describe("allocation routes mounted at the app root", () => {
  it("reverses an allocation, and refuses to reverse it twice", async () => {
    const { vouchers, root } = await newApp();
    await post(vouchers, "/", collection());
    await post(vouchers, "/v-collect/confirm", {});
    const created = await post(vouchers, "/v-collect/allocations", {
      allocationId: "alloc-1",
      invoiceId: "inv1",
      amount: "200.00",
    });
    expect(created.status).toBe(201);

    const reversed = await post(root, "/allocations/alloc-1/reverse");
    expect(reversed.status).toBe(200);
    expect((await json<{ status: string }>(reversed)).status).toBe("reversed");

    expect((await post(root, "/allocations/alloc-1/reverse")).status).toBe(409);
  });

  it("404s reversing an allocation that does not exist", async () => {
    const { root } = await newApp();
    expect((await post(root, "/allocations/nope/reverse")).status).toBe(404);
  });

  it("lists the open invoices for the allocation screen, filtered by kind and party", async () => {
    const { root } = await newApp();

    expect(await json<unknown[]>(await get(root, "/open-invoices"))).toHaveLength(3);

    const sales = await json<Array<{ id: string }>>(await get(root, "/open-invoices?kind=sales"));
    expect(sales.map((i) => i.id).sort()).toEqual(["inv1", "inv3"]);

    const bySupplier = await json<Array<{ id: string }>>(await get(root, "/open-invoices?partyId=sup-1"));
    expect(bySupplier.map((i) => i.id)).toEqual(["inv2"]);

    // An unrecognised kind narrows nothing rather than refusing the request.
    expect(await json<unknown[]>(await get(root, "/open-invoices?kind=nonsense"))).toHaveLength(3);
  });

  it("403s both root endpoints for a caller without the allocation permissions", async () => {
    const { root } = await newApp();
    expect((await get(root, "/open-invoices", { permissions: "treasury.cash_voucher.view" })).status).toBe(403);
    expect((await post(root, "/allocations/a/reverse", undefined, { permissions: "treasury.allocation.view" })).status).toBe(
      403,
    );
  });
});
