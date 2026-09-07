import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import { voucherLine } from "./voucher-document.js";
import type { Account } from "../accounts/account.js";
import type { PostedLine } from "../gl/ledger.js";
import { computeFxRevaluation, deriveOpenFxBalances } from "../fx-revaluation/revaluation.js";

describe("VoucherService — confirm posts GL via the document framework", () => {
  it("customer collection: draft → confirmed, stamps CV- number + posts a balanced JE", async () => {
    const h = buildTestService();
    const draft = await h.service.createVoucher({
      id: "v1",
      date: "2026-08-22",
      voucherType: "customer_collection",
      amount: Money.fromMajor("250"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "1100",
      customerId: "cust-1",
    });
    expect(draft.status).toBe("draft");
    expect(draft.docNo).toBeNull();

    const { document, held } = await h.service.confirmVoucher("v1");
    expect(held).toBe(false);
    expect(document.status).toBe("confirmed");
    expect(document.docNo).toBe("CV-000001");
    expect(document.journalEntryId).not.toBeNull();

    // The cash GL account received the money.
    const bal = await h.ledger.accountBalance("1300-1");
    expect(bal.balance.toString()).toBe("250.000000");
    const ar = await h.ledger.accountBalance("1100");
    expect(ar.balance.toString()).toBe("-250.000000"); // credited
  });

  it("supplier payment (funded): debits AP, credits cash", async () => {
    const h = buildTestService();
    await h.seedCashBalance("1300-1", "1000");
    await h.service.createVoucher({
      id: "v2",
      date: "2026-08-22",
      voucherType: "supplier_payment",
      amount: Money.fromMajor("400"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "2100",
      supplierId: "sup-1",
    });
    await h.service.confirmVoucher("v2");
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("600.000000"); // 1000 - 400
    expect((await h.ledger.accountBalance("2100")).balance.toString()).toBe("400.000000"); // debited
  });

  it("inter-treasury transfer: moves balance from source to destination, net liquidity unchanged", async () => {
    const h = buildTestService();
    await h.seedCashBalance("1300-1", "500");
    await h.service.createVoucher({
      id: "v3",
      date: "2026-08-22",
      voucherType: "inter_treasury_transfer",
      amount: Money.fromMajor("60"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterTreasuryAccountId: "ta-cash2",
      counterTreasuryGlAccountId: "1300-2",
    });
    await h.service.confirmVoucher("v3");
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("440.000000");
    expect((await h.ledger.accountBalance("1300-2")).balance.toString()).toBe("60.000000");
  });

  it("gap-free CV- numbering across two confirmed vouchers", async () => {
    const h = buildTestService();
    for (const id of ["a", "b"]) {
      await h.service.createVoucher({
        id,
        date: "2026-08-22",
        voucherType: "other_income",
        amount: Money.fromMajor("10"),
        branchId: "b1",
        paymentMethod: "cash",
        treasuryAccountId: "ta-cash1",
        treasuryGlAccountId: "1300-1",
        counterpartyGlAccountId: "4900",
      });
      await h.service.confirmVoucher(id);
    }
    expect((await h.service.findById("a"))!.docNo).toBe("CV-000001");
    expect((await h.service.findById("b"))!.docNo).toBe("CV-000002");
  });

  it("reversing a confirmed voucher posts a mirror JE and marks it reversed", async () => {
    const h = buildTestService();
    await h.service.createVoucher({
      id: "v4",
      date: "2026-08-22",
      voucherType: "other_income",
      amount: Money.fromMajor("100"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "4900",
    });
    await h.service.confirmVoucher("v4");
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("100.000000");

    const { original } = await h.service.reverseVoucher("v4", { reversalId: "v4-rev" });
    expect(original.status).toBe("reversed");
    // The reversing JE nets the cash account back to zero.
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("0.000000");
  });
});

/**
 * guards B-4/B-5 — a USD voucher stored its currency, converted nothing, tagged
 * nothing on the GL line and allocated currency-blind: a USD 1,000 receipt
 * settled 1,000 of a 49,350 EGP receivable, and the untagged AR line left the
 * invoice in the FX revaluation's open position forever.
 */
describe("VoucherService — a foreign-currency voucher", () => {
  const usdCollection = {
    id: "v-usd",
    date: "2026-08-22",
    voucherType: "customer_collection" as const,
    amount: Money.fromMajor("1000"),
    currency: "USD",
    branchId: "b1",
    paymentMethod: "cash" as const,
    treasuryAccountId: "ta-cash1",
    treasuryGlAccountId: "1300-1",
    counterpartyGlAccountId: "1100",
    customerId: "cust-1",
  };

  it("converts to base at the approved rate and tags the counterparty line with currency + rate", async () => {
    const h = buildTestService({ rates: { USD: "49.35" } });
    await h.service.createVoucher(usdCollection);
    const { document } = await h.service.confirmVoucher("v-usd");

    // The document keeps its own figure…
    expect(voucherLine(document).amount.toString()).toBe("1000.000000");
    expect(voucherLine(document).fxRate).toBe("49.35");
    // …and the ledger holds base.
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("49350.000000");
    expect((await h.ledger.accountBalance("1100")).balance.toString()).toBe("-49350.000000");

    const entry = (await h.ledger.findById(document.journalEntryId as string))!;
    const arLine = entry.lines.find((l) => l.accountId === "1100")!;
    expect(arLine.currency).toBe("USD");
    expect(arLine.fxRate).toBe("49.35");
    // The cash leg is base money in a base treasury — no FX tag on it.
    expect(entry.lines.find((l) => l.accountId === "1300-1")!.currency ?? null).toBeNull();
  });

  it("refuses a currency with no approved rate, and posts nothing", async () => {
    const h = buildTestService();
    await h.service.createVoucher(usdCollection);
    await expect(h.service.confirmVoucher("v-usd")).rejects.toThrow(/سعر صرف معتمد/);
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("0.000000");
    expect((await h.service.findById("v-usd"))!.status).toBe("draft");
  });

  it("allocates in BASE, so it settles the receivable it actually paid", async () => {
    const h = buildTestService({
      rates: { USD: "49.35" },
      invoices: [
        {
          id: "inv-1",
          invoiceNo: "SI-000001",
          kind: "sales",
          partyId: "cust-1",
          date: "2026-08-01",
          total: Money.fromMajor("49350.00"),
          allocated: Money.zero(),
        },
      ],
    });
    await h.service.createVoucher(usdCollection);
    await h.service.confirmVoucher("v-usd");

    const summary = await h.service.allocationSummary((await h.service.findById("v-usd"))!);
    expect(summary.voucherAmount.toString()).toBe("49350.000000");

    await h.service.allocate("v-usd", {
      allocationId: "a1",
      invoiceId: "inv-1",
      amount: Money.fromMajor("49350.00"),
    });
    const invoice = (await h.invoices.findById("inv-1"))!;
    expect(invoice.allocated.toString()).toBe("49350.000000");
    // Fully settled — not 1,000 of 49,350.
    expect(invoice.total.scaled - invoice.allocated.scaled).toBe(0n);
  });

  it("guards the treasury on the BASE amount, not the foreign digits", async () => {
    const h = buildTestService({ rates: { USD: "49.35" }, preventNegativeCashBalance: true });
    await h.seedCashBalance("1300-1", "10000");
    await h.service.createVoucher({
      ...usdCollection,
      id: "v-pay",
      voucherType: "supplier_payment",
      counterpartyGlAccountId: "2100",
      customerId: undefined,
      supplierId: "sup-1",
      amount: Money.fromMajor("300"), // 14,805 EGP — more than the 10,000 on hand
    });
    await expect(h.service.confirmVoucher("v-pay")).rejects.toThrow();
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("10000.000000");
  });

  it("leaves a base-currency voucher exactly as it was", async () => {
    const h = buildTestService();
    await h.service.createVoucher({ ...usdCollection, id: "v-egp", currency: "EGP" });
    const { document } = await h.service.confirmVoucher("v-egp");
    expect(voucherLine(document).fxRate ?? null).toBeNull();
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("1000.000000");
  });
});

/**
 * guards B-5 — every month-end restated an invoice the customer had already
 * paid, because the settling voucher's AR line carried no currency or rate and
 * `deriveOpenFxBalances` therefore never saw it net the position down.
 */
describe("VoucherService — a settled foreign invoice leaves the FX open position", () => {
  async function postedLines(h: ReturnType<typeof buildTestService>): Promise<PostedLine[]> {
    const out: PostedLine[] = [];
    for (const entry of await h.ledger.list()) {
      if (entry.status !== "posted") continue;
      for (const line of entry.lines) {
        out.push({
          entryId: entry.id,
          entryNo: entry.entryNo ?? null,
          date: entry.date,
          source: entry.source ?? "system",
          accountId: line.accountId,
          costCenterId: line.costCenterId ?? null,
          currency: line.currency ?? null,
          fxRate: line.fxRate ?? null,
          memo: line.memo ?? null,
          debit: line.debit,
          credit: line.credit,
        });
      }
    }
    return out;
  }

  const accounts: Account[] = [
    { id: "1100", code: "1100", nameAr: "ذمم عملاء", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  ];

  it("nets the position to nothing once the collection posts, so month-end books no gain", async () => {
    const h = buildTestService({ rates: { USD: "49.35" } });
    // The invoice: USD 1,000 receivable booked at 49.35.
    await h.ledger.save({
      id: "inv-je",
      entryNo: "JE-INV",
      date: "2026-08-01",
      memo: "فاتورة بالدولار",
      status: "posted",
      source: "system",
      lines: [
        { accountId: "1100", debit: Money.fromMajor("49350.00"), credit: Money.zero(), memo: null, currency: "USD", fxRate: "49.35" },
        { accountId: "4900", debit: Money.zero(), credit: Money.fromMajor("49350.00"), memo: null },
      ],
      createdAt: "2026-08-01T00:00:00.000Z",
      postedAt: "2026-08-01T00:00:00.000Z",
      reversesEntryId: null,
      reversedByEntryId: null,
    });

    // Before the collection the position is genuinely open.
    const open = deriveOpenFxBalances(await postedLines(h), accounts);
    expect(open).toHaveLength(1);
    expect(open[0]!.foreignAmount.toString()).toBe("1000.000000");

    await h.service.createVoucher({
      id: "v-settle",
      date: "2026-08-22",
      voucherType: "customer_collection",
      amount: Money.fromMajor("1000"),
      currency: "USD",
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "1100",
      customerId: "cust-1",
    });
    await h.service.confirmVoucher("v-settle");

    // After it, nothing is open — so there is nothing to restate at 55.00.
    const after = deriveOpenFxBalances(await postedLines(h), accounts);
    expect(after).toHaveLength(0);

    const result = computeFxRevaluation(after, {
      date: "2026-08-31",
      closingRates: new Map([["USD", "55"]]),
      gainAccountId: "4900",
      lossAccountId: "5900",
    });
    expect(result.hasImpact).toBe(false);
    expect(result.totalGain.toString()).toBe("0.000000");
  });
});
