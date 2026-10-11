import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { InMemoryLedgerRepository, InMemorySequenceStore, RecordingAuditSink } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { createJournalTaxTagPort } from "../gl/index.js";
import { VatPeriodAlreadyFiledError } from "../tax/vat-filing.js";
import {
  TaxClassificationAlreadyFiledError,
  TaxClassificationFilingOutcome,
  TaxClassificationNotPostedError,
  TaxClassificationSharedPostingError,
} from "../tax-rates/index.js";
import { StockLedgerService } from "../inventory/index.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "../inventory/test-helpers/in-memory-stores.js";
import type { DocumentWorkflowGate, DocumentDomainEvent } from "../documents/hooks.js";
import {
  InactiveTaxRateError,
  TaxRateAlreadyClassifiedError,
  TaxRateClassificationPercentError,
  TaxRateNotFoundError,
  TaxRatePercentMismatchError,
  TaxRateUnverifiableError,
  type TaxRate,
  SYSTEM_NOT_SUBJECT_TAX_RATE,
  SYSTEM_NOT_SUBJECT_TAX_RATE_ID,
} from "../tax-rates/index.js";
import {
  SalesInvoiceService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  applyAllocatedSettlement,
  createSalesInvoiceCustomerExposureHook,
  InvalidSalesInvoiceError,
  InvalidSalesInvoicePaymentError,
  InvalidSalesInvoiceTransitionError,
  SalesInvoiceNotFoundError,
  DuplicateSalesInvoiceError,
  type CreateSalesInvoiceCommand,
  type SalesInvoicePricingDeps,
  type SalesInvoiceServiceDeps,
} from "./index.js";
import type { SalesInvoicePromotionHook } from "./ports.js";
import { InMemorySalesInvoiceRepository } from "./test-helpers/in-memory-sales-invoice-repository.js";

const AR = "1300";
const REVENUE = "4000";
const TAX = "2200";
const NOW = "2026-08-22T10:00:00.000Z";

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

async function baseDeps(
  overrides: Partial<SalesInvoiceServiceDeps> = {},
  opts: { readonly vatFilings?: { findCovering(date: string): Promise<readonly { id: string; status: string }[]> } } = {},
) {
  const accounts = new InMemoryAccountRepository();
  await accounts.create(account(AR));
  await accounts.create(account(REVENUE, { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account(TAX, { type: "liability", naturalBalance: "credit" }));

  const periods = new InMemoryFiscalPeriodRepository();
  await periods.create({ id: "fp", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });

  const ledger = new InMemoryLedgerRepository();
  const glHook = createSalesInvoiceGlHook({
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    now: () => NOW,
    actor: "u1",
  });

  const stockService = new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers: new InMemoryCostLayers(),
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: true },
    clock: () => NOW,
  });
  const stockHook = createSalesInvoiceStockHook(stockService);

  const repo = new InMemorySalesInvoiceRepository();
  const numbering = new NextNumberService(new InMemorySequenceStore());

  const svc = new SalesInvoiceService({
    repo,
    numbering: { next: () => numbering.next("SALES_INVOICE") },
    gl: glHook,
    stock: stockHook,
    now: () => NOW,
    actor: "u1",
    taxTags: createJournalTaxTagPort({ ledger, vatFilings: opts.vatFilings }),
    ...overrides,
  });

  return { svc, repo, ledger, accounts };
}

function draftCmd(overrides: Partial<CreateSalesInvoiceCommand> = {}): CreateSalesInvoiceCommand {
  return {
    id: "inv-1",
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "محمد الشهابي",
    warehouseId: "WH1",
    branchId: "BR1",
    arAccountId: AR,
    taxAccountId: TAX,
    lines: [
      {
        lineId: "L1",
        itemId: "SVC-1",
        itemNameAr: "خدمة",
        isStock: false,
        qty: Qty.fromMajor("1"),
        unitPrice: Money.fromMajor("500"),
        taxRatePercent: 0,
        revenueAccountId: REVENUE,
      },
    ],
    ...overrides,
  };
}

/* ================================================================== */
/* 1. Workflow gate                                                    */
/* ================================================================== */

describe("SalesInvoiceService.confirm — workflow gate", () => {
  function gate(granted: boolean): DocumentWorkflowGate {
    return { evaluate: async (input) => ({ granted, requestId: input.requestId }) };
  }

  it("holds the invoice بانتظار الموافقة when the gate does not grant, and emits DOCUMENT_SUBMITTED", async () => {
    const events: DocumentDomainEvent[] = [];
    const { svc } = await baseDeps({ workflow: gate(false), events: { publish: (e) => events.push(e) } });
    await svc.createDraft(draftCmd());
    const result = await svc.confirm("inv-1");

    expect(result.held).toBe(true);
    expect(result.invoice.status).toBe("pending");
    expect(result.invoice.workflowRequestId).toBe("inv-1:confirm");
    expect(events.at(-1)?.type).toBe("DOCUMENT_SUBMITTED");
  });

  it("re-confirming a pending invoice while still not granted is a no-op, not an illegal transition", async () => {
    const { svc } = await baseDeps({ workflow: gate(false) });
    await svc.createDraft(draftCmd());
    await svc.confirm("inv-1");
    const again = await svc.confirm("inv-1");
    expect(again.held).toBe(true);
    expect(again.invoice.status).toBe("pending");
  });

  it("confirms normally once the gate grants", async () => {
    const { svc } = await baseDeps({ workflow: gate(true) });
    await svc.createDraft(draftCmd());
    const result = await svc.confirm("inv-1");
    expect(result.held).toBe(false);
    expect(result.invoice.status).toBe("confirmed");
    expect(result.invoice.workflowRequestId).toBeNull();
  });
});

/* ================================================================== */
/* 2. returnToDraft                                                    */
/* ================================================================== */

describe("SalesInvoiceService.returnToDraft", () => {
  it("is a no-op for an invoice already in draft", async () => {
    const { svc } = await baseDeps();
    await svc.createDraft(draftCmd());
    const returned = await svc.returnToDraft("inv-1");
    expect(returned.status).toBe("draft");
  });

  it("returns a pending invoice to draft and clears its workflow request id", async () => {
    const { svc } = await baseDeps({ workflow: { evaluate: async (i) => ({ granted: false, requestId: i.requestId }) } });
    await svc.createDraft(draftCmd());
    await svc.confirm("inv-1"); // held pending
    const returned = await svc.returnToDraft("inv-1");
    expect(returned.status).toBe("draft");
    expect(returned.workflowRequestId).toBeNull();
  });

  it("refuses to return a confirmed (live) invoice to draft", async () => {
    const { svc } = await baseDeps();
    await svc.createDraft(draftCmd());
    await svc.confirm("inv-1");
    await expect(svc.returnToDraft("inv-1")).rejects.toBeInstanceOf(InvalidSalesInvoiceTransitionError);
  });

  it("throws SalesInvoiceNotFoundError for a missing id", async () => {
    const { svc } = await baseDeps();
    await expect(svc.returnToDraft("missing")).rejects.toBeInstanceOf(SalesInvoiceNotFoundError);
  });
});

/* ================================================================== */
/* 3. applyAllocatedSettlement                                         */
/* ================================================================== */

describe("applyAllocatedSettlement", () => {
  it("returns null for a missing invoice", async () => {
    const { repo } = await baseDeps();
    expect(await applyAllocatedSettlement(repo, "missing", Money.fromMajor("100"))).toBeNull();
  });

  it("refuses money settled against an invoice that is not live, and writes nothing", async () => {
    const { svc, repo } = await baseDeps();
    await svc.createDraft(draftCmd());
    await expect(applyAllocatedSettlement(repo, "inv-1", Money.fromMajor("100"))).rejects.toBeInstanceOf(InvalidSalesInvoicePaymentError);
    const stored = await repo.findById("inv-1");
    expect([stored?.status, stored?.amountPaid.toString()]).toEqual(["draft", "0.000000"]);
  });

  it("leaves an invoice that is not live alone when nothing is settled against it", async () => {
    const { svc, repo } = await baseDeps();
    await svc.createDraft(draftCmd());
    const result = await applyAllocatedSettlement(repo, "inv-1", Money.zero());
    expect([result?.status, result?.amountPaid.toString()]).toEqual(["draft", "0.000000"]);
  });

  it("moves confirmed -> partially_paid -> paid as settlement rises, and back down on reversal", async () => {
    const { svc, repo } = await baseDeps();
    await svc.createDraft(draftCmd()); // grand total 500.00
    await svc.confirm("inv-1");

    const partial = await applyAllocatedSettlement(repo, "inv-1", Money.fromMajor("200"));
    expect(partial?.status).toBe("partially_paid");
    expect(partial?.amountPaid.toString()).toBe("200.000000");

    const full = await applyAllocatedSettlement(repo, "inv-1", Money.fromMajor("500"));
    expect(full?.status).toBe("paid");
    expect(full?.amountPaid.toString()).toBe("500.000000");

    // Reversing an allocation walks the status back down.
    const backToPartial = await applyAllocatedSettlement(repo, "inv-1", Money.fromMajor("200"));
    expect(backToPartial?.status).toBe("partially_paid");

    const backToConfirmed = await applyAllocatedSettlement(repo, "inv-1", Money.zero());
    expect(backToConfirmed?.status).toBe("confirmed");
    expect(backToConfirmed?.amountPaid.toString()).toBe("0.000000");
  });

  it("caps settlement at the grand total rather than overpaying", async () => {
    const { svc, repo } = await baseDeps();
    await svc.createDraft(draftCmd());
    await svc.confirm("inv-1");
    const result = await applyAllocatedSettlement(repo, "inv-1", Money.fromMajor("999"));
    expect(result?.status).toBe("paid");
    expect(result?.amountPaid.toString()).toBe("500.000000");
  });

  it("is idempotent when neither the amount nor the resulting status changes", async () => {
    const { svc, repo } = await baseDeps();
    await svc.createDraft(draftCmd());
    await svc.confirm("inv-1");
    await applyAllocatedSettlement(repo, "inv-1", Money.fromMajor("200"));
    const before = await repo.findById("inv-1");
    const again = await applyAllocatedSettlement(repo, "inv-1", Money.fromMajor("200"));
    expect(again).toEqual(before);
  });
});

describe("a foreign invoice settles in base (D202)", () => {
  async function usdInvoice() {
    const deps = await baseDeps({ exchangeRates: { findRate: async () => ({ rate: "50.00" }) } });
    await deps.svc.createDraft(draftCmd({ currency: "USD" }));
    await deps.svc.confirm("inv-1");
    return deps;
  }

  it("is مدفوع جزئياً, not مدفوع, when 500.00 EGP is allocated against USD 500 booked at 50.00", async () => {
    const { repo } = await usdInvoice();
    const partial = await applyAllocatedSettlement(repo, "inv-1", Money.fromMajor("500"));
    expect(partial?.status).toBe("partially_paid");
    expect(partial?.amountPaid.toString()).toBe("500.000000");
    const full = await applyAllocatedSettlement(repo, "inv-1", Money.fromMajor("30000"));
    expect(full?.status).toBe("paid");
    expect(full?.amountPaid.toString()).toBe("25000.000000");
  });

  it("lets a collection run up to the base total, and no further", async () => {
    const { svc } = await usdInvoice();
    await expect(svc.assertCollectable("inv-1", Money.fromMajor("20000"))).resolves.toBeTruthy();
    await expect(svc.assertCollectable("inv-1", Money.fromMajor("25000.01"))).rejects.toBeInstanceOf(InvalidSalesInvoicePaymentError);
  });

  it("counts the base amount still owed towards the customer's credit exposure", async () => {
    const { repo } = await usdInvoice();
    await applyAllocatedSettlement(repo, "inv-1", Money.fromMajor("5000"));
    const exposure = await createSalesInvoiceCustomerExposureHook(repo).currentBalance("cust-1");
    expect(exposure.toString()).toBe("20000.000000");
  });
});

/* ================================================================== */
/* 4. Promotion application at confirm                                 */
/* ================================================================== */

describe("SalesInvoiceService.confirm — promotion", () => {
  it("stamps the promotion snapshot returned by the hook and it reduces GL revenue", async () => {
    const promoHook: SalesInvoicePromotionHook = {
      evaluate: async (req) => ({
        promotionId: "promo-1",
        code: "SAVE10",
        nameAr: "خصم 10",
        couponCode: null,
        discountTotal: Money.fromMajor("50"),
        lineDiscounts: [{ lineId: req.lines[0]!.lineId, itemId: req.lines[0]!.itemId, amount: Money.fromMajor("50") }],
        appliedAt: NOW,
      }),
    };
    const { svc, ledger } = await baseDeps({ promotions: promoHook });
    await svc.createDraft(draftCmd()); // 500.00 line
    const { invoice } = await svc.confirm("inv-1");

    expect(invoice.appliedPromotion?.promotionId).toBe("promo-1");
    // grand total after a 50.00 promotion discount on a 500.00 line.
    const entry = await ledger.findById("inv-1");
    const revenueCredit = Money.sum((entry?.lines ?? []).filter((l) => l.accountId === REVENUE).map((l) => l.credit));
    expect(revenueCredit.toString()).toBe("450.000000");
  });

  it("never re-evaluates a promotion already stamped on the invoice", async () => {
    let calls = 0;
    const promoHook: SalesInvoicePromotionHook = {
      evaluate: async () => {
        calls += 1;
        return null;
      },
    };
    const { svc } = await baseDeps({ promotions: promoHook, workflow: { evaluate: async (i) => ({ granted: false, requestId: i.requestId }) } });
    await svc.createDraft(draftCmd());
    await svc.confirm("inv-1"); // held pending; promotion not evaluated because gate denies first
    expect(calls).toBe(0);
  });
});

/* ================================================================== */
/* 5. Pricing variance (D35)                                           */
/* ================================================================== */

describe("SalesInvoiceService.confirm — pricing variance", () => {
  it("surfaces a variance when a line is charged below the customer's list price", async () => {
    const pricing: SalesInvoicePricingDeps = {
      listPriceFor: async () => Money.fromMajor("600"),
    };
    const { svc } = await baseDeps({ pricing });
    await svc.createDraft(draftCmd()); // charged 500.00
    const result = await svc.confirm("inv-1");
    expect(result.pricingVariances).toHaveLength(1);
    expect(result.pricingVariances[0]?.listPrice.toString()).toBe("600.000000");
    expect(result.pricingVariances[0]?.chargedPrice.toString()).toBe("500.000000");
    // WARNS only — never blocks the confirm.
    expect(result.invoice.status).toBe("confirmed");
  });

  it("reports no variance when charged at or above list price, or when no list applies", async () => {
    const pricingAtList: SalesInvoicePricingDeps = { listPriceFor: async () => Money.fromMajor("500") };
    const { svc: svc1 } = await baseDeps({ pricing: pricingAtList });
    await svc1.createDraft(draftCmd());
    expect((await svc1.confirm("inv-1")).pricingVariances).toHaveLength(0);

    const pricingNoList: SalesInvoicePricingDeps = { listPriceFor: async () => null };
    const { svc: svc2 } = await baseDeps({ pricing: pricingNoList });
    await svc2.createDraft(draftCmd());
    expect((await svc2.confirm("inv-1")).pricingVariances).toHaveLength(0);
  });
});

/* ================================================================== */
/* 6. Foreign-currency confirm (D24)                                   */
/* ================================================================== */

describe("SalesInvoiceService.confirm — foreign currency", () => {
  it("confirms a base-currency invoice with no fx rate lookup at all", async () => {
    const { svc } = await baseDeps({ baseCurrency: "EGP" });
    await svc.createDraft(draftCmd());
    const { invoice } = await svc.confirm("inv-1");
    expect(invoice.fxRate).toBeNull();
  });

  it("converts AR to base currency at the approved rate and stamps fxRate on the invoice", async () => {
    const exchangeRates = { findRate: async () => ({ rate: "50" }) };
    const { svc, ledger } = await baseDeps({ baseCurrency: "EGP", exchangeRates });
    await svc.createDraft(draftCmd({ currency: "USD" })); // 500.00 USD
    const { invoice } = await svc.confirm("inv-1");
    expect(invoice.fxRate).toBe("50");

    const entry = await ledger.findById("inv-1");
    const arDebit = Money.sum((entry?.lines ?? []).filter((l) => l.accountId === AR).map((l) => l.debit));
    expect(arDebit.toString()).toBe("25000.000000"); // 500 USD * 50
    const arLine = entry?.lines.find((l) => l.accountId === AR);
    expect(arLine?.currency).toBe("USD");
    expect(arLine?.fxRate).toBe("50");
  });

  it("refuses to confirm a foreign-currency invoice with no approved rate, leaving it a draft", async () => {
    const exchangeRates = { findRate: async () => null };
    const { svc } = await baseDeps({ baseCurrency: "EGP", exchangeRates });
    await svc.createDraft(draftCmd({ currency: "USD" }));
    await expect(svc.confirm("inv-1")).rejects.toBeInstanceOf(InvalidSalesInvoiceError);
    const still = await svc.findById("inv-1");
    expect(still?.status).toBe("draft");
  });

  it("refuses a foreign-currency invoice outright when no exchangeRates dep is configured at all", async () => {
    const { svc } = await baseDeps({ baseCurrency: "EGP" });
    await svc.createDraft(draftCmd({ currency: "USD" }));
    await expect(svc.confirm("inv-1")).rejects.toBeInstanceOf(InvalidSalesInvoiceError);
  });
});

/* ================================================================== */
/* 7. validate() — every documented refusal                            */
/* ================================================================== */

describe("SalesInvoiceService.createDraft — validation", () => {
  it("rejects a duplicate id", async () => {
    const { svc } = await baseDeps();
    await svc.createDraft(draftCmd());
    await expect(svc.createDraft(draftCmd())).rejects.toBeInstanceOf(DuplicateSalesInvoiceError);
  });

  async function expectReason(overrides: Partial<CreateSalesInvoiceCommand>, reason: string) {
    const { svc } = await baseDeps();
    try {
      await svc.createDraft(draftCmd(overrides));
      throw new Error("expected createDraft to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSalesInvoiceError);
      expect((err as InstanceType<typeof InvalidSalesInvoiceError>).reasons).toContain(reason);
    }
  }

  it("requires a customer", async () => {
    await expectReason({ customerId: "" }, "العميل مطلوب.");
  });

  it("requires a warehouse", async () => {
    await expectReason({ warehouseId: "" }, "المستودع مطلوب.");
  });

  it("requires an AR account", async () => {
    await expectReason({ arAccountId: "" }, "حساب المدينون مطلوب.");
  });

  it("requires at least one line", async () => {
    await expectReason({ lines: [] }, "الفاتورة تتطلب بنداً واحداً على الأقل.");
  });

  it("requires every line to name an item", async () => {
    const { svc } = await baseDeps();
    await expect(
      svc.createDraft(
        draftCmd({ lines: [{ lineId: "L1", itemId: "", itemNameAr: "بند", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("1"), revenueAccountId: REVENUE }] }),
      ),
    ).rejects.toBeInstanceOf(InvalidSalesInvoiceError);
  });

  it("rejects a zero or negative line quantity", async () => {
    const { svc } = await baseDeps();
    await expect(
      svc.createDraft(
        draftCmd({ lines: [{ lineId: "L1", itemId: "A", itemNameAr: "صنف أ", isStock: false, qty: Qty.zero(), unitPrice: Money.fromMajor("1"), revenueAccountId: REVENUE }] }),
      ),
    ).rejects.toBeInstanceOf(InvalidSalesInvoiceError);
  });

  it("rejects a negative unit price", async () => {
    const { svc } = await baseDeps();
    await expect(
      svc.createDraft(
        draftCmd({ lines: [{ lineId: "L1", itemId: "A", itemNameAr: "صنف أ", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("-1"), revenueAccountId: REVENUE }] }),
      ),
    ).rejects.toBeInstanceOf(InvalidSalesInvoiceError);
  });

  it("rejects a percent line discount outside 0..100", async () => {
    const { svc } = await baseDeps();
    await expect(
      svc.createDraft(
        draftCmd({
          lines: [{ lineId: "L1", itemId: "A", itemNameAr: "صنف أ", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("1"), discountPercent: 150, revenueAccountId: REVENUE }],
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidSalesInvoiceError);
  });

  it("rejects a negative line discount amount", async () => {
    const { svc } = await baseDeps();
    await expect(
      svc.createDraft(
        draftCmd({
          lines: [
            {
              lineId: "L1",
              itemId: "A",
              itemNameAr: "صنف أ",
              isStock: false,
              qty: Qty.fromMajor("1"),
              unitPrice: Money.fromMajor("1"),
              discountType: "amount",
              discountAmount: Money.fromMajor("-1"),
              revenueAccountId: REVENUE,
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidSalesInvoiceError);
  });

  it("requires COGS and inventory accounts on a stock line", async () => {
    const { svc } = await baseDeps();
    await expect(
      svc.createDraft(
        draftCmd({
          lines: [{ lineId: "L1", itemId: "A", itemNameAr: "صنف أ", isStock: true, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("1"), revenueAccountId: REVENUE }],
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidSalesInvoiceError);
  });

  it("rejects a negative invoice-level amount discount, rather than letting it inflate the total", async () => {
    await expectReason({ discount: { type: "amount", amount: Money.fromMajor("-10") } }, "خصم الفاتورة لا يقبل قيمة سالبة.");
  });

  it("rejects an invoice-level percent discount outside 0..100", async () => {
    await expectReason({ discount: { type: "percent", percent: 101 } }, "نسبة خصم الفاتورة يجب أن تكون بين 0 و 100.");
  });
});

/* ================================================================== */
/* 8. Lookups, listing and tax policy                                  */
/* ================================================================== */

describe("SalesInvoiceService — lookups and listing", () => {
  it("findByIdOrDocNo resolves by id, then by document number, then null", async () => {
    const { svc } = await baseDeps();
    await svc.createDraft(draftCmd());
    await svc.confirm("inv-1");
    expect((await svc.findByIdOrDocNo("inv-1"))?.id).toBe("inv-1");
    expect((await svc.findByIdOrDocNo("INV-000001"))?.id).toBe("inv-1");
    expect(await svc.findByIdOrDocNo("nope")).toBeNull();
  });

  it("list/count pass the filter straight through to the repository", async () => {
    const { svc } = await baseDeps();
    await svc.createDraft(draftCmd({ id: "inv-1", customerId: "cust-1" }));
    await svc.createDraft(draftCmd({ id: "inv-2", customerId: "cust-2" }));
    expect(await svc.count({ customerId: "cust-1" })).toBe(1);
    const rows = await svc.list({ customerId: "cust-2" });
    expect(rows.map((r) => r.id)).toEqual(["inv-2"]);
  });
});

describe("SalesInvoiceService.createDraft — tax policy", () => {
  it("defaults a line naming no rate to zero when no tax policy dep is configured", async () => {
    const { svc } = await baseDeps();
    const draft = await svc.createDraft(draftCmd({ lines: [{ lineId: "L1", itemId: "A", itemNameAr: "أ", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), revenueAccountId: REVENUE }] }));
    expect(draft.lines[0]?.taxRatePercent).toBe(0);
  });

  it("still honours a line's own explicit rate when no tax policy dep is configured", async () => {
    const { svc } = await baseDeps();
    const draft = await svc.createDraft(draftCmd({ lines: [{ lineId: "L1", itemId: "A", itemNameAr: "أ", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 14, revenueAccountId: REVENUE }] }));
    expect(draft.lines[0]?.taxRatePercent).toBe(14);
  });

  it("raises a zero rate for every line when the tenant's tax policy is disabled", async () => {
    const { svc } = await baseDeps({ taxPolicy: () => ({ enabled: false, defaultRatePercent: 14, inclusive: false }) });
    const draft = await svc.createDraft(draftCmd({ lines: [{ lineId: "L1", itemId: "A", itemNameAr: "أ", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 14, revenueAccountId: REVENUE }] }));
    expect(draft.lines[0]?.taxRatePercent).toBe(0);
  });

  it("raises a zero rate for a tax-exempt customer even with tax enabled", async () => {
    const { svc } = await baseDeps({ taxPolicy: () => ({ enabled: true, defaultRatePercent: 14, inclusive: false }) });
    const draft = await svc.createDraft(draftCmd({ customerTaxExempt: true, lines: [{ lineId: "L1", itemId: "A", itemNameAr: "أ", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 14, revenueAccountId: REVENUE }] }));
    expect(draft.lines[0]?.taxRatePercent).toBe(0);
  });

  it("stamps taxInclusive from the tax policy onto the draft", async () => {
    const { svc } = await baseDeps({ taxPolicy: () => ({ enabled: true, defaultRatePercent: 0, inclusive: true }) });
    const draft = await svc.createDraft(draftCmd());
    expect(draft.taxInclusive).toBe(true);
  });
});

/* ================================================================== */
/* 9. Events + audit                                                   */
/* ================================================================== */

describe("SalesInvoiceService — domain events", () => {
  it("emits DOCUMENT_DRAFTED, DOCUMENT_CONFIRMED and DOCUMENT_CANCELLED with the document's identity", async () => {
    const events: DocumentDomainEvent[] = [];
    const { svc } = await baseDeps({ events: { publish: (e) => events.push(e) } });
    await svc.createDraft(draftCmd());
    expect(events[0]).toMatchObject({ type: "DOCUMENT_DRAFTED", docId: "inv-1", docType: "SALES_INVOICE" });

    await svc.confirm("inv-1");
    expect(events[1]).toMatchObject({ type: "DOCUMENT_CONFIRMED", docId: "inv-1", docNo: "INV-000001" });

    await svc.createDraft(draftCmd({ id: "inv-2" }));
    await svc.cancel("inv-2");
    expect(events.at(-1)).toMatchObject({ type: "DOCUMENT_CANCELLED", docId: "inv-2" });
  });

  it("never throws when no events dep is configured", async () => {
    const { svc } = await baseDeps();
    await expect(svc.createDraft(draftCmd())).resolves.toBeTruthy();
  });
});

describe("SalesInvoiceService — audit", () => {
  it("records a WARNING-severity CANCEL audit event with the document's own branch", async () => {
    const audit = new RecordingAuditSink();
    const { svc } = await baseDeps({ audit, actor: "u9" });
    await svc.createDraft(draftCmd({ branchId: "BR9" }));
    await svc.cancel("inv-1");
    const last = audit.events.at(-1);
    expect(last?.action).toBe("CANCEL");
    expect(last?.severity).toBe("WARNING");
    expect(last?.branchId).toBe("BR9");
    expect(last?.actor).toBe("u9");
  });

  it("never throws when no audit dep is configured", async () => {
    const { svc } = await baseDeps();
    await svc.createDraft(draftCmd());
    await expect(svc.cancel("inv-1")).resolves.toBeTruthy();
  });
});


describe("SalesInvoiceService.createDraft — the tax rate's identity (D79)", () => {
  const rate = (id: string, percent: number, etaSubType: TaxRate["etaSubType"], status: TaxRate["status"] = "active"): TaxRate => ({
    id, code: id, name: id, rate: percent, calculationType: "exclusive", isDefault: false,
    outputTaxAccountId: null, inputTaxAccountId: null, etaSubType, status,
  });
  const MASTER = [rate("VAT14", 14, "auto"), rate("EXEMPT", 0, "V003"), rate("EXPORT", 0, "V001"), rate("OLD5", 5, "auto", "inactive")];
  const taxRates = { list: async () => MASTER };
  const serviceLine = (lineId: string, tax: { taxRateId?: string | null; taxRatePercent?: number }) => ({
    lineId, itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"),
    revenueAccountId: REVENUE, ...tax,
  });

  it("stores the named rate's id and reads the percent off the rate, not the request", async () => {
    const { svc } = await baseDeps({ taxRates });
    const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRateId: "EXEMPT" }), serviceLine("L2", { taxRateId: "EXPORT" }), serviceLine("L3", { taxRateId: "VAT14" })] }));
    expect(invoice.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([["EXEMPT", 0], ["EXPORT", 0], ["VAT14", 14]]);
  });

  it("resolves a percent-only line to the one active rate at that percent", async () => {
    const { svc } = await baseDeps({ taxRates });
    const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRatePercent: 14 })] }));
    expect(invoice.lines[0]).toMatchObject({ taxRateId: "VAT14", taxRatePercent: 14 });
  });

  it("stores NO id for a 0% line that names no rate while exempt and export both exist — and still raises the invoice", async () => {
    const { svc } = await baseDeps({ taxRates });
    const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRatePercent: 0 })] }));
    expect(invoice.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 0 });
  });

  it("resolves a line that names neither through the tenant's default percent", async () => {
    const { svc } = await baseDeps({ taxRates, taxPolicy: () => ({ enabled: true, defaultRatePercent: 14, inclusive: false }) });
    const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", {})] }));
    expect(invoice.lines[0]).toMatchObject({ taxRateId: "VAT14", taxRatePercent: 14 });
  });

  it("refuses an unknown rate id, a deactivated rate, and a percent that is not the rate's own", async () => {
    const { svc, repo } = await baseDeps({ taxRates });
    await expect(svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRateId: "TAX-1" })] }))).rejects.toBeInstanceOf(TaxRateNotFoundError);
    await expect(svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRateId: "OLD5" })] }))).rejects.toBeInstanceOf(InactiveTaxRateError);
    await expect(svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRateId: "EXEMPT", taxRatePercent: 14 })] }))).rejects.toBeInstanceOf(TaxRatePercentMismatchError);
    expect(await repo.findById("inv-1")).toBeNull();
  });

  it("never stamps a taxed rate's id on a line a tax-exempt customer is charged nothing for", async () => {
    const { svc } = await baseDeps({ taxRates });
    const invoice = await svc.createDraft(draftCmd({ customerTaxExempt: true, lines: [serviceLine("L1", { taxRateId: "VAT14" }), serviceLine("L2", { taxRateId: "EXPORT" })] }));
    expect(invoice.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([[null, 0], ["EXPORT", 0]]);
  });

  it("does the same when VAT is switched off for the tenant", async () => {
    const { svc } = await baseDeps({ taxRates, taxPolicy: () => ({ enabled: false, defaultRatePercent: 14, inclusive: false }) });
    const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRateId: "VAT14" })] }));
    expect(invoice.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 0 });
  });

  it("posts the stored ids onto the journal, so exempt and export revenue never blend", async () => {
    const { svc, ledger } = await baseDeps({ taxRates });
    await svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRateId: "EXEMPT" }), serviceLine("L2", { taxRateId: "EXPORT" }), serviceLine("L3", { taxRateId: "VAT14" })] }));
    const { invoice } = await svc.confirm("inv-1");
    const entry = await ledger.findById(invoice.journalEntryId as string);
    const revenue = (entry?.lines ?? []).filter((l) => l.accountId === REVENUE);
    expect(revenue.map((l) => l.taxRateId).sort()).toEqual(["EXEMPT", "EXPORT", "VAT14"]);
    const vat = (entry?.lines ?? []).filter((l) => l.accountId === TAX);
    expect(vat).toHaveLength(1);
    expect(vat[0]).toMatchObject({ taxRateId: "VAT14", taxRatePercent: 14 });
  });

  it("without the tax rate master wired, a percent-only line keeps its percent and stores no id", async () => {
    const { svc } = await baseDeps();
    const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRatePercent: 14 })] }));
    expect(invoice.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 14 });
  });

  it("without the tax rate master wired, a line that NAMES a rate is refused — never stored with the id dropped", async () => {
    const { svc, repo } = await baseDeps();
    await expect(svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRateId: "EXEMPT" })] }))).rejects.toBeInstanceOf(TaxRateUnverifiableError);
    expect(await repo.findById("inv-1")).toBeNull();
  });

  describe("on a tenant holding the system «غير خاضع» rate (D79 round 4)", () => {
    const withSystem = { list: async () => [...MASTER, SYSTEM_NOT_SUBJECT_TAX_RATE] };
    const NOT_SUBJECT = { taxRateId: SYSTEM_NOT_SUBJECT_TAX_RATE_ID, taxRatePercent: 0 };
    const vatOff = () => ({ enabled: false, defaultRatePercent: 14, inclusive: false });

    it("a sale with VAT switched off names it — the one case the system rate is assigned", async () => {
      const { svc } = await baseDeps({ taxRates: withSystem, taxPolicy: vatOff });
      const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", {})] }));
      expect(invoice.lines[0]).toMatchObject(NOT_SUBJECT);
    });

    it("a tax-exempt customer with no exemption rate stores NO rate — round 3 filed it as not subject", async () => {
      const { svc } = await baseDeps({ taxRates: withSystem });
      const invoice = await svc.createDraft(draftCmd({ customerTaxExempt: true, lines: [serviceLine("L1", { taxRatePercent: 14 }), serviceLine("L2", { taxRateId: "VAT14" }), serviceLine("L3", { taxRateId: "EXPORT" })] }));
      expect(invoice.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([[null, 0], [null, 0], ["EXPORT", 0]]);
    });

    it("a tax-exempt customer's sale names the 0% rate on the customer's card, on every line policy zero-rated", async () => {
      const { svc } = await baseDeps({ taxRates: withSystem });
      const invoice = await svc.createDraft(draftCmd({ customerTaxExempt: true, customerTaxExemptionRateId: "EXEMPT", lines: [serviceLine("L1", { taxRatePercent: 14 }), serviceLine("L2", { taxRateId: "VAT14" }), serviceLine("L3", { taxRateId: "EXPORT" })] }));
      expect(invoice.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([["EXEMPT", 0], ["EXEMPT", 0], ["EXPORT", 0]]);
    });

    it("an exemption rate on the card of a customer who is NOT exempt changes nothing", async () => {
      const { svc } = await baseDeps({ taxRates: withSystem });
      const invoice = await svc.createDraft(draftCmd({ customerTaxExempt: false, customerTaxExemptionRateId: "EXEMPT", lines: [serviceLine("L1", { taxRateId: "VAT14" })] }));
      expect(invoice.lines[0]).toMatchObject({ taxRateId: "VAT14", taxRatePercent: 14 });
    });

    it("with VAT off, an exempt customer's sale is still out of scope: the system rate, not the card's", async () => {
      const { svc } = await baseDeps({ taxRates: withSystem, taxPolicy: vatOff });
      const invoice = await svc.createDraft(draftCmd({ customerTaxExempt: true, customerTaxExemptionRateId: "EXEMPT", lines: [serviceLine("L1", {})] }));
      expect(invoice.lines[0]).toMatchObject(NOT_SUBJECT);
    });

    it("a 0% line a user entered without a rate still stores NONE — the system rate is never read off the percent", async () => {
      const { svc } = await baseDeps({ taxRates: withSystem });
      const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRatePercent: 0 }), serviceLine("L2", { taxRateId: null, taxRatePercent: 0 })] }));
      expect(invoice.lines.map((l) => l.taxRateId)).toEqual([null, null]);
    });

    it("posts the card's rate onto the revenue line of the journal, so the VAT return can name the row", async () => {
      const { svc, ledger } = await baseDeps({ taxRates: withSystem });
      await svc.createDraft(draftCmd({ customerTaxExempt: true, customerTaxExemptionRateId: "EXEMPT", lines: [serviceLine("L1", { taxRatePercent: 14 })] }));
      const { invoice } = await svc.confirm("inv-1");
      const entry = await ledger.findById(invoice.journalEntryId as string);
      const revenue = (entry?.lines ?? []).filter((l) => l.accountId === REVENUE);
      expect(revenue.map((l) => [l.taxRateId, l.taxRatePercent, l.credit.toString()])).toEqual([["EXEMPT", 0, "100.000000"]]);
      expect((entry?.lines ?? []).filter((l) => l.accountId === TAX)).toEqual([]);
    });

    it("an inherited 0% line with no rate takes the policy's rate only when policy zero-rates the invoice; an inherited 14% line with no rate is carried as it is", async () => {
      const inheritedLine = (lineId: string, taxRatePercent: number) => ({ ...serviceLine(lineId, {}), inheritedTax: { taxRateId: null, taxRatePercent } });
      const carded = await baseDeps({ taxRates: withSystem });
      const named = await carded.svc.createDraft(draftCmd({ customerTaxExempt: true, customerTaxExemptionRateId: "EXEMPT", lines: [inheritedLine("L1", 0)] }));
      expect(named.lines[0]).toMatchObject({ taxRateId: "EXEMPT", taxRatePercent: 0 });

      const uncarded = await baseDeps({ taxRates: withSystem });
      const unnamed = await uncarded.svc.createDraft(draftCmd({ customerTaxExempt: true, lines: [inheritedLine("L1", 0)] }));
      expect(unnamed.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 0 });

      const ordinary = await baseDeps({ taxRates: withSystem });
      const carried = await ordinary.svc.createDraft(draftCmd({ lines: [inheritedLine("L1", 0), inheritedLine("L2", 14)] }));
      expect(carried.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([[null, 0], [null, 14]]);
    });

    describe("naming the rate of an inherited line whose source stored none (a quote converting)", () => {
      const inherited = (lineId: string, taxRateId: string | null, taxRatePercent: number, inheritedTaxRateId: string) => ({
        ...serviceLine(lineId, {}),
        inheritedTax: { taxRateId, taxRatePercent },
        inheritedTaxRateId,
      });

      it("names an active rate at the stored percent: 14% NULL → VAT14, 0% NULL → EXEMPT", async () => {
        const { svc } = await baseDeps({ taxRates: withSystem });
        const invoice = await svc.createDraft(draftCmd({ lines: [inherited("L1", null, 14, "VAT14"), inherited("L2", null, 0, "EXEMPT")] }));
        expect(invoice.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([["VAT14", 14], ["EXEMPT", 0]]);
      });

      it("refuses a rate at another percent — naming never reprices the line", async () => {
        const { svc, repo } = await baseDeps({ taxRates: withSystem });
        await expect(svc.createDraft(draftCmd({ lines: [inherited("L1", null, 14, "EXEMPT")] }))).rejects.toBeInstanceOf(TaxRateClassificationPercentError);
        expect(await repo.findById("inv-1")).toBeNull();
      });

      it("refuses to move a line that already names a rate to another one", async () => {
        const { svc } = await baseDeps({ taxRates: withSystem });
        await expect(svc.createDraft(draftCmd({ lines: [inherited("L1", "EXEMPT", 0, "EXPORT")] }))).rejects.toBeInstanceOf(TaxRateAlreadyClassifiedError);
      });

      it("accepts the rate the line already names, and refuses an inactive or unknown one", async () => {
        const { svc } = await baseDeps({ taxRates: withSystem });
        const same = await svc.createDraft(draftCmd({ lines: [inherited("L1", "EXEMPT", 0, "EXEMPT")] }));
        expect(same.lines[0]).toMatchObject({ taxRateId: "EXEMPT", taxRatePercent: 0 });
        const other = await baseDeps({ taxRates: withSystem });
        await expect(other.svc.createDraft(draftCmd({ lines: [inherited("L1", null, 14, "NOPE")] }))).rejects.toBeInstanceOf(TaxRateNotFoundError);
      });
    });
  });

  describe("on a tenant whose ONLY 0% rate is exempt (review finding 1)", () => {
    const onlyExempt = { list: async () => [rate("VAT14", 14, "auto"), rate("EXEMPT", 0, "V003")] };

    it("a tax-exempt customer's sale stores no rate — it is not an exempt SUPPLY", async () => {
      const { svc } = await baseDeps({ taxRates: onlyExempt });
      const invoice = await svc.createDraft(draftCmd({ customerTaxExempt: true, lines: [serviceLine("L1", { taxRatePercent: 14 })] }));
      expect(invoice.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 0 });
    });

    it("a sale with VAT switched off stores no rate", async () => {
      const { svc } = await baseDeps({ taxRates: onlyExempt, taxPolicy: () => ({ enabled: false, defaultRatePercent: 14, inclusive: false }) });
      const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", {})] }));
      expect(invoice.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 0 });
    });

    it("a 0% line that says 'no rate' stores no rate", async () => {
      const { svc } = await baseDeps({ taxRates: onlyExempt });
      const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRateId: null, taxRatePercent: 0 })] }));
      expect(invoice.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 0 });
    });

    it("and so does a 0% line that says nothing at all", async () => {
      const { svc } = await baseDeps({ taxRates: onlyExempt });
      const invoice = await svc.createDraft(draftCmd({ lines: [serviceLine("L1", { taxRatePercent: 0 })] }));
      expect(invoice.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 0 });
    });
  });

  it("a line inherited from a quote keeps a rate deactivated since, at the quoted percent", async () => {
    const { svc } = await baseDeps({ taxRates });
    const invoice = await svc.createDraft(draftCmd({ lines: [{ ...serviceLine("L1", {}), inheritedTax: { taxRateId: "OLD5", taxRatePercent: 5 } }] }));
    expect(invoice.lines[0]).toMatchObject({ taxRateId: "OLD5", taxRatePercent: 5 });
  });
});

describe("SalesInvoiceService.classifyLineTax — naming the rate of a posted line that stored none (D79 round 4)", () => {
  const rate = (id: string, percent: number, etaSubType: TaxRate["etaSubType"]): TaxRate => ({
    id, code: id, name: `ضريبة ${id}`, rate: percent, calculationType: "exclusive", isDefault: false,
    outputTaxAccountId: null, inputTaxAccountId: null, etaSubType, status: "active",
  });
  const taxRates = { list: async () => [rate("VAT14", 14, "auto"), rate("VAT14B", 14, "auto"), rate("EXEMPT", 0, "V003"), rate("EXPORT", 0, "V001")] };
  const unnamed = (lineId: string, taxRatePercent: number): CreateSalesInvoiceCommand["lines"][number] => ({
    lineId, itemId: "SVC-1", itemNameAr: `خدمة ${lineId}`, isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"),
    revenueAccountId: REVENUE, taxRateId: null, taxRatePercent,
  });

  async function posted(lines: ReturnType<typeof unnamed>[], overrides: Partial<SalesInvoiceServiceDeps> = {}, opts: Parameters<typeof baseDeps>[1] = {}) {
    const audit = new RecordingAuditSink();
    const deps = await baseDeps({ taxRates, audit, ...overrides }, opts);
    await deps.svc.createDraft(draftCmd({ lines }));
    const { invoice } = await deps.svc.confirm("inv-1");
    const entry = await deps.ledger.findById(invoice.journalEntryId as string);
    return { ...deps, audit, invoice, entry };
  }
  const journalOf = async (ledger: InMemoryLedgerRepository, entryId: string) =>
    ((await ledger.findById(entryId))?.lines ?? []).map((l) => [l.accountId, l.debit.toString(), l.credit.toString(), l.taxRatePercent ?? null, l.taxRateId ?? null]);

  it("names the invoice line and its journal lines, and moves no amount, account, date or status", async () => {
    const { svc, repo, ledger, invoice, entry } = await posted([unnamed("L1", 14)]);
    const before = await journalOf(ledger, entry!.id);
    expect(before).toEqual([[AR, "114.000000", "0.000000", null, null], [REVENUE, "0.000000", "100.000000", 14, null], [TAX, "0.000000", "14.000000", 14, null]]);

    const result = await svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "VAT14" });

    expect(result.journalLinesNamed).toBe(2);
    expect((await repo.findById("inv-1"))?.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([["VAT14", 14]]);
    expect(await journalOf(ledger, entry!.id)).toEqual([[AR, "114.000000", "0.000000", null, null], [REVENUE, "0.000000", "100.000000", 14, "VAT14"], [TAX, "0.000000", "14.000000", 14, "VAT14"]]);
    const after = await repo.findById("inv-1");
    expect({ ...after, lines: [] }).toEqual({ ...invoice, lines: [] });
    expect(svc.totalsOf(after!).grandTotal.toString()).toBe(svc.totalsOf(invoice).grandTotal.toString());
    const stored = await ledger.findById(entry!.id);
    expect([stored?.date, stored?.status, stored?.entryNo]).toEqual([entry!.date, entry!.status, entry!.entryNo]);
  });

  it("leaves a journal line that already names a rate alone", async () => {
    const named = { ...unnamed("L2", 14), taxRateId: "VAT14B" };
    const { svc, ledger, entry } = await posted([unnamed("L1", 14), named]);
    await svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "VAT14" });
    const tags = (await journalOf(ledger, entry!.id)).filter((l) => l[3] === 14).map((l) => [l[0], l[4]]);
    expect(tags).toEqual(expect.arrayContaining([[REVENUE, "VAT14"], [REVENUE, "VAT14B"], [TAX, "VAT14"], [TAX, "VAT14B"]]));
    expect(tags).toHaveLength(4);
  });

  it("never re-points a line that names a rate, and writes nothing when it refuses or answers a retry", async () => {
    const { svc, repo, ledger, entry, audit } = await posted([{ ...unnamed("L1", 0), taxRateId: "EXEMPT" }]);
    const before = await journalOf(ledger, entry!.id);
    await expect(svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "EXPORT" })).rejects.toBeInstanceOf(TaxRateAlreadyClassifiedError);
    const standing = await svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "EXEMPT" });
    expect([standing.plan.lineRefs, standing.plan.after.taxRateId, standing.journalLinesNamed]).toEqual([["L1"], "EXEMPT", 0]);
    expect((await repo.findById("inv-1"))?.lines[0]?.taxRateId).toBe("EXEMPT");
    expect(await journalOf(ledger, entry!.id)).toEqual(before);
    expect(audit.events.filter((e) => e.action === "CLASSIFY_LINE_TAX")).toEqual([]);
  });

  it("refuses a rate at another percent", async () => {
    const { svc } = await posted([unnamed("L1", 14)]);
    await expect(svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "EXEMPT" })).rejects.toBeInstanceOf(TaxRateClassificationPercentError);
  });

  it("classifies the unnamed lines at one percent together, only once every one of them is named in the request", async () => {
    const { svc, repo } = await posted([unnamed("L1", 0), unnamed("L2", 0), unnamed("L3", 14)]);
    await expect(svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "EXEMPT" })).rejects.toBeInstanceOf(TaxClassificationSharedPostingError);
    expect((await repo.findById("inv-1"))?.lines.map((l) => l.taxRateId)).toEqual([null, null, null]);
    const result = await svc.classifyLineTax("inv-1", { lineRef: "L1", withLineRefs: ["L2"], taxRateId: "EXEMPT" });
    expect(result.journalLinesNamed).toBe(1);
    expect((await repo.findById("inv-1"))?.lines.map((l) => l.taxRateId)).toEqual(["EXEMPT", "EXEMPT", null]);
  });

  it("is refused on a draft and on a cancelled invoice — only a posted line is classified", async () => {
    const { svc } = await baseDeps({ taxRates });
    await svc.createDraft(draftCmd({ lines: [unnamed("L1", 0)] }));
    await expect(svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "EXEMPT" })).rejects.toBeInstanceOf(TaxClassificationNotPostedError);
    await svc.cancel("inv-1");
    await expect(svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "EXEMPT" })).rejects.toBeInstanceOf(TaxClassificationNotPostedError);
  });

  it("is refused once the VAT return covering the entry's date is filed, and the invoice line is left unnamed", async () => {
    const filings = { filed: false, async findCovering() { return this.filed ? [{ id: "VF-1", status: "filed" }] : []; } };
    const { svc, repo } = await posted([unnamed("L1", 0)], {}, { vatFilings: filings });
    filings.filed = true;
    await expect(svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "EXEMPT" })).rejects.toBeInstanceOf(VatPeriodAlreadyFiledError);
    expect((await repo.findById("inv-1"))?.lines[0]?.taxRateId).toBeNull();
  });

  it("is refused when the filed e-document contradicts it, inside the transaction and before anything is audited", async () => {
    let seen: (string | null | undefined)[] = [];
    const { svc, audit } = await posted([unnamed("L1", 0)], {
      taxFiling: {
        reconcile: async ({ before, after }) => {
          seen = [...before.lines, ...after.lines].map((l) => l.taxRateId);
          throw new TaxClassificationAlreadyFiledError(after.docNo ?? after.id);
        },
      },
    });
    await expect(svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "EXEMPT" })).rejects.toBeInstanceOf(TaxClassificationAlreadyFiledError);
    expect(seen).toEqual([null, "EXEMPT"]);
    expect(audit.events.filter((e) => e.action === "CLASSIFY_LINE_TAX")).toEqual([]);
  });

  it("records who classified what, with the line's tax before and after", async () => {
    const { svc, audit, entry } = await posted([unnamed("L1", 0)], { taxFiling: { reconcile: async () => TaxClassificationFilingOutcome.Requeued } });
    await svc.classifyLineTax("inv-1", { lineRef: "L1", taxRateId: "EXPORT" });
    const events = audit.events.filter((e) => e.action === "CLASSIFY_LINE_TAX");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", entityId: "inv-1", actor: "u1", severity: "WARNING",
      details: {
        lineIds: ["L1"],
        before: { taxRateId: null, taxRatePercent: 0 },
        after: { taxRateId: "EXPORT", taxRatePercent: 0 },
        taxRateName: "ضريبة EXPORT",
        journalEntryId: entry!.id,
        journalLinesNamed: 1,
        filing: "requeued",
      },
    });
  });
});
