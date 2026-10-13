import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seededWorld, type Answer, type SeededWorld } from "./test-helpers/seeded-world.js";

const ARABIC = /[؀-ۿ]/;
const WATCHED = ["1105", "1300-1", "4920", "5920", "4940", "5940", "4100"];

let world: SeededWorld;

async function must(method: string, url: string, body?: unknown): Promise<Answer> {
  const res = await world.request(method, url, body);
  if (res.status !== 200 && res.status !== 201) throw new Error(`${method} ${url} ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  return res;
}

async function rate(id: string, currency: string, value: string, date: string): Promise<void> {
  await must("POST", "/exchange-rates", { id, currency, rate: value, effectiveDate: date, rateType: "standard", source: "manual" });
  await must("POST", `/exchange-rates/${id}/approve`, {});
}

async function invoice(id: string, currency: string): Promise<void> {
  await must("POST", "/sales-invoices", { id, date: "2026-08-22", dueDate: "2026-12-21", customerId: "cust", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200", currency, lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: "10", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }] });
  await must("POST", `/sales-invoices/${id}/confirm`, {});
}

async function voucher(id: string, date: string, amount: string, currency?: string, voucherType = "customer_collection"): Promise<Answer> {
  await must("POST", "/vouchers", { id, date, amount, branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "1105", voucherType, customerId: "cust", ...(currency ? { currency } : {}) });
  return world.request("POST", `/vouchers/${id}/confirm`, {});
}

const books = (): string => JSON.stringify(WATCHED.map((account) => [account, world.balance(account).toString()]));
const allocationRows = (): number => world.count("voucher_allocation");

beforeEach(async () => {
  world = await seededWorld({ seedDemoData: false });
  await rate("fx-aed", "AED", "13.10", "2026-08-01");
  await rate("fx-aed-2", "AED", "13.45", "2026-09-10");
  await rate("fx-usd", "USD", "48.00", "2026-08-01");
  await rate("fx-usd-2", "USD", "48.70", "2026-09-10");
  await must("PUT", "/settings", { ...(await world.request("GET", "/settings")).body, multiCurrencyEnabled: true });
  await must("POST", "/treasury-accounts", { id: "ta-cash", code: "TA-CASH", name: "الخزينة", branchId: "BR-MAIN", glAccountId: "1300-1", openingBalance: "0" });
  await must("POST", "/vouchers", { id: "v-fund", date: "2026-08-01", voucherType: "capital_injection", amount: "5000000", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "3100" });
  await must("POST", "/vouchers/v-fund/confirm", {});
  await must("POST", "/customers", { id: "cust", code: "cust", nameAr: "عميل", paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
  await must("POST", "/items", { id: "SVC-1", code: "SVC-1", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" });
});

afterEach(() => world.close());

describe("a reversed voucher and the mirror that reversed it take no further action", () => {
  async function reversedPair(): Promise<{ original: string; mirror: string }> {
    await invoice("inv-aed", "AED");
    expect((await voucher("v-egp", "2026-09-10", "250")).status).toBe(200);
    const reversed = await must("POST", "/vouchers/v-egp/reverse", { memo: "خطأ في الإدخال", date: "2026-09-12" });
    return { original: "v-egp", mirror: String((reversed.body.reversal as { id: string }).id) };
  }

  it("every state-changing voucher route refuses both, in Arabic, and leaves the books and the allocation sub-ledger as they were", async () => {
    const pair = await reversedPair();
    const before = { books: books(), allocations: allocationRows(), invoice: (await must("GET", "/sales-invoices/inv-aed")).body.remainingBalance };
    const attempts: { label: string; method: string; url: string; body: unknown }[] = [];
    for (const [role, id] of Object.entries(pair)) {
      attempts.push({ label: `allocate ${role}`, method: "POST", url: `/vouchers/${id}/allocations`, body: { allocationId: `al-${role}`, invoiceId: "inv-aed", amount: "250" } });
      attempts.push({ label: `allocate ${role} on a named day`, method: "POST", url: `/vouchers/${id}/allocations`, body: { allocationId: `al-${role}-d`, invoiceId: "inv-aed", amount: "250", date: "2026-09-20" } });
      attempts.push({ label: `reverse ${role}`, method: "POST", url: `/vouchers/${id}/reverse`, body: { memo: "مرة أخرى", date: "2026-09-20" } });
      attempts.push({ label: `confirm ${role}`, method: "POST", url: `/vouchers/${id}/confirm`, body: {} });
      attempts.push({ label: `cancel ${role}`, method: "POST", url: `/vouchers/${id}/cancel`, body: {} });
    }
    for (const attempt of attempts) {
      const res = await world.request(attempt.method, attempt.url, attempt.body);
      expect([409, 422], `${attempt.label} -> ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toContain(res.status);
      expect(String(res.body.message ?? ""), attempt.label).toMatch(ARABIC);
    }
    expect(books()).toBe(before.books);
    expect(allocationRows()).toBe(before.allocations);
    expect((await must("GET", "/sales-invoices/inv-aed")).body.remainingBalance).toBe(before.invoice);
  });

  it("the mirror's refusal names the reversal and carries an English message", async () => {
    const pair = await reversedPair();
    const res = await world.request("POST", `/vouchers/${pair.mirror}/allocations`, { allocationId: "al-m", invoiceId: "inv-aed", amount: "250" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("VOUCHER_REVERSED");
    expect(String(res.body.message)).toMatch(/عكس/);
    expect(String(res.body.messageEn)).toMatch(/revers/i);
  });

  it("neither is offered for allocation: detail, list, queue, counts and stats all read one answer", async () => {
    const pair = await reversedPair();
    for (const id of Object.values(pair)) {
      const detail = (await must("GET", `/vouchers/${id}`)).body as { allocatable: boolean; allocationSummary: { needsAllocation: boolean } };
      expect(detail.allocatable, id).toBe(false);
      expect(detail.allocationSummary.needsAllocation, id).toBe(false);
      const summary = (await must("GET", `/vouchers/${id}/allocations`)).body.allocationSummary as { needsAllocation: boolean };
      expect(summary.needsAllocation, id).toBe(false);
    }
    const rowsOf = (body: Record<string, unknown>) => (Array.isArray(body) ? body : ((body.items ?? body.rows) as { id: string; allocatable: boolean; allocationSummary: { needsAllocation: boolean } }[]));
    const listed = rowsOf((await must("GET", "/vouchers")).body).filter((row) => Object.values(pair).includes(row.id));
    expect(listed.map((row) => [row.allocatable, row.allocationSummary.needsAllocation])).toEqual([[false, false], [false, false]]);
    expect(rowsOf((await must("GET", "/vouchers?needsAllocation=any")).body).map((row) => row.id)).toEqual([]);
    expect(((await must("GET", "/vouchers/counts")).body as Record<string, number>).needs_allocation ?? 0).toBe(0);
    expect((await must("GET", "/vouchers/stats")).body.needsAllocation).toBe(0);
  });

  it("the needs-allocation queue lists a standing receipt with money left, by direction, and drops it once it is reversed", async () => {
    await invoice("inv-aed", "AED");
    expect((await voucher("v-open", "2026-09-10", "300")).status).toBe(200);
    const ids = async (query: string) => {
      const body = (await must("GET", `/vouchers?needsAllocation=${query}`)).body as unknown;
      return ((Array.isArray(body) ? body : ((body as { items?: unknown[]; rows?: unknown[] }).items ?? (body as { rows?: unknown[] }).rows)) as { id: string }[]).map((row) => row.id);
    };
    expect(await ids("any")).toEqual(["v-open"]);
    expect(await ids("receipt")).toEqual(["v-open"]);
    expect(await ids("payment")).toEqual([]);
    await must("POST", "/vouchers/v-open/reverse", { memo: "خطأ", date: "2026-09-12" });
    expect(await ids("any")).toEqual([]);
  });

  it("a refund does not draw on the money of a reversed receipt or of its mirror", async () => {
    expect((await voucher("v-usd", "2026-09-10", "100", "USD")).status).toBe(200);
    await must("POST", "/vouchers/v-usd/reverse", { memo: "خطأ", date: "2026-09-10" });
    const before = allocationRows();
    expect((await voucher("v-refund", "2026-09-12", "100", "USD", "customer_refund")).status).toBe(200);
    expect(allocationRows()).toBe(before);
    expect((await world.invariants()).allocationsOnReversedVouchers).toBe("0");
  });

  it("reversing a voucher undoes its allocations in the same act, so no reversed voucher is left holding one", async () => {
    await invoice("inv-usd", "USD");
    expect((await voucher("v-settle", "2026-09-10", "400", "USD")).status).toBe(200);
    await must("POST", "/vouchers/v-settle/allocations", { allocationId: "al-1", invoiceId: "inv-usd", amount: "19480" });
    await must("POST", "/vouchers/v-settle/reverse", { memo: "خطأ", date: "2026-09-12" });
    expect(world.count("voucher_allocation", "voucher_id = 'v-settle' AND status = 'active'")).toBe(0);
    expect((await must("GET", "/sales-invoices/inv-usd")).body.remainingBalance).toBe("48000.000000");
    expect((await world.invariants()).allocationsOnReversedVouchers).toBe("0");
  });

  it("a bounced cheque takes no allocation either: refused in Arabic, books and sub-ledger unchanged", async () => {
    await invoice("inv-aed", "AED");
    await must("POST", "/treasury-accounts", { id: "ta-bank", code: "TA-BANK", name: "البنك", type: "bank", branchId: "BR-MAIN", glAccountId: "1310", openingBalance: "0" });
    await must("POST", "/cheques", { id: "chq", chequeNumber: "N-1", bankName: "بنك مصر", issueDate: "2026-09-10", dueDate: "2026-09-10", branchId: "BR-MAIN", partyId: "cust", counterpartyGlAccountId: "1105", amount: "250", direction: "incoming", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" } });
    await must("POST", "/cheques/chq/deposit", { bankTreasuryAccountId: "ta-bank" });
    await must("POST", "/cheques/chq/bounce", { date: "2026-09-20" });
    const before = { books: books(), allocations: allocationRows() };
    const res = await world.request("POST", "/cheques/chq/allocations", { allocationId: "al-chq", invoiceId: "inv-aed", amount: "250" });
    expect([409, 422]).toContain(res.status);
    expect(String(res.body.message)).toMatch(ARABIC);
    expect({ books: books(), allocations: allocationRows() }).toEqual(before);
  });

  it("the reconciliation counts and names an allocation that stands on a mirror", async () => {
    const pair = await reversedPair();
    expect((await world.invariants()).allocationsOnReversedVouchers).toBe("0");
    world.sqlite.prepare(`INSERT INTO voucher_allocation (id, voucher_id, invoice_id, amount, status, created_at, date) VALUES ('al-planted', ?, 'inv-aed', 250000000, 'active', '2026-09-20T00:00:00.000Z', '2026-09-20')`).run(pair.mirror);
    const recon = (await must("GET", "/reconciliation")).body as { allocationsOnReversedVouchers: { count: number; rows: { allocationId: string; voucherId: string }[] } };
    expect(recon.allocationsOnReversedVouchers.count).toBe(1);
    expect(recon.allocationsOnReversedVouchers.rows).toEqual([expect.objectContaining({ allocationId: "al-planted", voucherId: pair.mirror })]);
  });
});
